import { PrivyClient } from "@privy-io/node";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isValidClassicAddress } from "xrpl";
import { DEFAULT_PAYEES, MAX_XRP_PER_PAYMENT, type Payee } from "./config";
import { getPayeeMeta, setPayeeMeta } from "./store";
import {
  fundFromFaucet,
  getBalanceXrp,
  preparePayment,
  submitSigned,
  withXrpl,
  type Submitted,
} from "./xrpl";

// Lazy so importing this module (tests, next build) doesn't require secrets.
let client: PrivyClient | undefined;
export const privy = () =>
  (client ??= new PrivyClient({
    appId: process.env.PRIVY_APP_ID!,
    appSecret: process.env.PRIVY_APP_SECRET!,
  }));

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Verify the Privy access token from the Authorization header and return the user id. */
export async function requireUser(req: Request): Promise<string> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw new HttpError(401, "Missing access token");
  try {
    const claims = await privy().utils().auth().verifyAccessToken(token);
    return claims.user_id;
  } catch {
    throw new HttpError(401, "Invalid access token");
  }
}

// ---------------------------------------------------------------------------
// Condition sets. @privy-io/node 0.36 only exposes conditionSets.list(), so create/items go over REST.
// (See DX_LOG: the docs also say an owner + authorization signature is required; the API accepts neither.)

async function privyRest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const appId = process.env.PRIVY_APP_ID!;
  const res = await fetch(`https://api.privy.io/v1${path}`, {
    method,
    headers: {
      authorization:
        "Basic " +
        Buffer.from(`${appId}:${process.env.PRIVY_APP_SECRET}`).toString(
          "base64",
        ),
      "privy-app-id": appId,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      `Privy ${method} ${path} failed (${res.status}): ${JSON.stringify(json)}`,
    );
  return json as T;
}

type SetItem = { id: string; value: string };
const createConditionSet = (name: string) =>
  privyRest<{ id: string }>("POST", "/condition_sets", { name });
const addSetItems = (setId: string, values: string[]) =>
  privyRest<SetItem[]>(
    "POST",
    `/condition_sets/${setId}/condition_set_items`,
    values.map((value) => ({ value })),
  );
const listSetItems = async (setId: string) =>
  (
    await privyRest<{ items: SetItem[] }>(
      "GET",
      `/condition_sets/${setId}/condition_set_items`,
    )
  ).items;
const deleteSetItem = (setId: string, itemId: string) =>
  privyRest("DELETE", `/condition_sets/${setId}/condition_set_items/${itemId}`);

// ---------------------------------------------------------------------------
// Treasury = one Privy server wallet per operator, found by external_id, guarded by one policy.

export type Treasury = {
  walletId: string;
  address: string;
  publicKey: string;
  policyId: string;
  payeeSetId: string;
};

// Privy user ids look like "did:privy:abc", but external_id only allows [a-zA-Z0-9_-].
const externalIdFor = (userId: string) =>
  `treasury_${userId.replace(/^did:privy:/, "")}`;

/** Payment only, destination in the operator's payee condition set, capped per payment. Everything else: default deny. */
export function payoutPolicyRules(payeeSetId: string) {
  return [
    {
      name: `Payments up to ${MAX_XRP_PER_PAYMENT} XRP to approved payees`,
      method: "xrpl_signTransaction" as const,
      action: "ALLOW" as const,
      conditions: [
        {
          field_source: "xrpl_transaction" as const,
          field: "TransactionType" as const,
          operator: "eq" as const,
          value: "Payment",
        },
        {
          field_source: "xrpl_transaction" as const,
          field: "Payment.Destination" as const,
          operator: "in_condition_set" as const,
          value: payeeSetId,
        },
        {
          field_source: "xrpl_transaction" as const,
          field: "Payment.Amount.drops" as const,
          operator: "lte" as const,
          value: String(MAX_XRP_PER_PAYMENT * 1_000_000),
        },
      ],
    },
  ];
}

async function newPayeeSet(externalId: string) {
  const set = await createConditionSet(`Payees ${externalId}`.slice(0, 50));
  await addSetItems(
    set.id,
    DEFAULT_PAYEES.map((p) => p.address),
  );
  return set.id;
}

// Per-process cache; wallet + policy lookups are 2 round trips we'd otherwise repeat on every request.
const cache = new Map<string, Treasury>();

const inflight = new Map<string, Promise<Treasury & { created: boolean }>>();

/** Find (or create) the operator's treasury, migrating wallets made before payees moved to a condition set. */
export async function getOrCreateTreasury(
  userId: string,
): Promise<Treasury & { created: boolean }> {
  const hit = cache.get(userId);
  if (hit) return { ...hit, created: false };
  // Parallel first requests must not create two wallets.
  let p = inflight.get(userId);
  if (!p) {
    p = loadOrCreate(userId).finally(() => inflight.delete(userId));
    inflight.set(userId, p);
  }
  return p;
}

async function loadOrCreate(
  userId: string,
): Promise<Treasury & { created: boolean }> {
  const external_id = externalIdFor(userId);

  for await (const w of privy()
    .wallets()
    .list({ external_id, chain_type: "xrpl" })) {
    const policyId = w.policy_ids?.[0];
    if (!policyId) throw new Error("Treasury wallet has no policy attached");
    const policy = await privy().policies().get(policyId);
    let payeeSetId = policy.rules
      .flatMap((r) => r.conditions)
      .find(
        (c: any) =>
          c.operator === "in_condition_set" &&
          c.field === "Payment.Destination",
      )?.value as string | undefined;
    if (!payeeSetId) {
      // v1 treasuries had the allowlist inline. Move it into a condition set so payees can change.
      payeeSetId = await newPayeeSet(external_id);
      await privy()
        .policies()
        .update(policyId, { rules: payoutPolicyRules(payeeSetId) });
    }
    const t = {
      walletId: w.id,
      address: w.address,
      publicKey: w.public_key ?? "",
      policyId,
      payeeSetId,
    };
    cache.set(userId, t);
    return { ...t, created: false };
  }

  const payeeSetId = await newPayeeSet(external_id);
  const policy = await privy()
    .policies()
    .create({
      version: "1.0",
      name: `Payout policy ${external_id}`.slice(0, 50),
      chain_type: "xrpl",
      rules: payoutPolicyRules(payeeSetId),
    });
  const wallet = await privy()
    .wallets()
    .create({ chain_type: "xrpl", external_id, policy_ids: [policy.id] });
  const t = {
    walletId: wallet.id,
    address: wallet.address,
    publicKey: wallet.public_key ?? "",
    policyId: policy.id,
    payeeSetId,
  };
  cache.set(userId, t);
  return { ...t, created: true };
}

/** Balance, funding from the faucet if the account doesn't exist on-ledger yet (idempotent). */
export async function treasuryBalance(
  t: Treasury,
  { fundIfMissing = false } = {},
) {
  return withXrpl(async (c) => {
    const bal = await getBalanceXrp(c, t.address);
    return bal === null && fundIfMissing ? fundFromFaucet(c, t.address) : bal;
  });
}

// ---------------------------------------------------------------------------
// Payees: the condition set is the source of truth for who can be paid; names are display-only.

export type PayeeEntry = Payee & { itemId: string };

export async function listPayees(t: Treasury): Promise<PayeeEntry[]> {
  const meta = getPayeeMeta(t.walletId);
  const items = await listSetItems(t.payeeSetId);
  return items.map((i) => {
    const m =
      meta[i.value] ?? DEFAULT_PAYEES.find((p) => p.address === i.value);
    return {
      itemId: i.id,
      address: i.value,
      name: m?.name ?? "Unnamed payee",
      role: m?.role ?? "",
    };
  });
}

export async function addPayee(t: Treasury, p: Payee) {
  if (!isValidClassicAddress(p.address))
    throw new HttpError(400, "That isn't a valid XRPL classic address (r…).");
  const existing = await listSetItems(t.payeeSetId);
  if (!existing.some((i) => i.value === p.address))
    await addSetItems(t.payeeSetId, [p.address]);
  setPayeeMeta(t.walletId, p.address, { name: p.name, role: p.role });
}

export async function removePayee(t: Treasury, address: string) {
  const items = await listSetItems(t.payeeSetId);
  for (const i of items.filter((i) => i.value === address))
    await deleteSetItem(t.payeeSetId, i.id);
  setPayeeMeta(t.walletId, address, null);
}

// ---------------------------------------------------------------------------
// Signing. The Privy policy is evaluated inside wallets().rpc(); a denial never reaches the ledger.

export type PaymentOutcome =
  | ({ status: "paid" } & Submitted)
  | ({ status: "pending" } & Submitted)
  | { status: "blocked"; error: string }
  | { status: "failed"; error: string; hash?: string }
  | { status: "signed_not_submitted" };

export async function signAndSubmitPayment(
  t: Treasury,
  destination: string,
  amountXrp: number,
  {
    submit = true,
    memo,
  }: { submit?: boolean; memo?: { ref: string; text: string } } = {},
): Promise<PaymentOutcome> {
  return withXrpl(async (client) => {
    const hex = await preparePayment(client, t, destination, amountXrp, memo);
    let signed: string;
    try {
      const { data } = await privy()
        .wallets()
        .rpc(t.walletId, {
          method: "xrpl_signTransaction",
          params: { transaction: hex, encoding: "hex" },
        });
      signed = data.signed_transaction;
    } catch (e: any) {
      const code = e?.error?.code;
      const msg = e?.error?.error ?? e?.message ?? String(e);
      return code === "policy_violation"
        ? { status: "blocked", error: `${msg} (${code})` }
        : { status: "failed", error: `${msg}${code ? ` (${code})` : ""}` };
    }
    if (!submit) return { status: "signed_not_submitted" };
    const s = await submitSigned(client, signed);
    if (s.pending) return { status: "pending", ...s };
    return s.result === "tesSUCCESS"
      ? { status: "paid", ...s }
      : { status: "failed", error: s.result, hash: s.hash };
  });
}

// ---------------------------------------------------------------------------
// Approved plans round-trip through the browser, so we MAC them to stop tampering between approve and execute.

const planKey = () =>
  process.env.PLAN_SECRET || `plan:${process.env.PRIVY_APP_SECRET}`;

export function signPlan(userId: string, planJson: string) {
  return createHmac("sha256", planKey())
    .update(`${userId}\n${planJson}`)
    .digest("hex");
}
export function verifyPlan(userId: string, planJson: string, mac: string) {
  if (!/^[0-9a-f]{64}$/.test(mac)) return false;
  return timingSafeEqual(
    Buffer.from(signPlan(userId, planJson), "hex"),
    Buffer.from(mac, "hex"),
  );
}
