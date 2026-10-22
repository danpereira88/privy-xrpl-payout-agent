import { PrivyClient } from "@privy-io/node";
import { createHmac, timingSafeEqual } from "node:crypto";
import { MAX_XRP_PER_PAYMENT, PAYEES } from "./config";
import {
  fundFromFaucet,
  getBalanceXrp,
  preparePayment,
  submitSigned,
  withXrpl,
} from "./xrpl";

// Lazy so importing this module (tests, next build) doesn't require secrets.
let client: PrivyClient | undefined;
export const privy = () =>
  (client ??= new PrivyClient({
    appId: process.env.PRIVY_APP_ID!,
    appSecret: process.env.PRIVY_APP_SECRET!,
  }));

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

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Treasury = {
  walletId: string;
  address: string;
  publicKey: string;
  policyId: string | null;
};

// Privy user ids look like "did:privy:abc", but external_id only allows [a-zA-Z0-9_-].
const externalIdFor = (userId: string) =>
  `treasury_${userId.replace(/^did:privy:/, "")}`;

/** The payout policy: Payment only, allowlisted payees only, capped per payment. Default deny otherwise. */
export function payoutPolicyRules() {
  return [
    {
      name: `Payments up to ${MAX_XRP_PER_PAYMENT} XRP to allowlisted payees`,
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
          operator: "in" as const,
          value: PAYEES.map((p) => p.address),
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

/** Find the operator's treasury wallet by external_id, or create it (with its policy) and fund it. */
export async function getOrCreateTreasury(
  userId: string,
): Promise<Treasury & { created: boolean }> {
  const external_id = externalIdFor(userId);
  for await (const w of privy()
    .wallets()
    .list({ external_id, chain_type: "xrpl" })) {
    return { ...toTreasury(w), created: false };
  }
  const policy = await privy()
    .policies()
    .create({
      version: "1.0",
      name: `Payout policy ${external_id}`.slice(0, 50),
      chain_type: "xrpl",
      rules: payoutPolicyRules(),
    });
  const wallet = await privy()
    .wallets()
    .create({ chain_type: "xrpl", external_id, policy_ids: [policy.id] });
  const treasury = toTreasury(wallet);
  await withXrpl((c) => fundFromFaucet(c, treasury.address));
  return { ...treasury, created: true };
}

function toTreasury(w: {
  id: string;
  address: string;
  public_key?: string | null;
  policy_ids?: string[];
}): Treasury {
  return {
    walletId: w.id,
    address: w.address,
    publicKey: w.public_key ?? "",
    policyId: w.policy_ids?.[0] ?? null,
  };
}

export async function treasuryBalance(t: Treasury) {
  return withXrpl((c) => getBalanceXrp(c, t.address));
}

export type PaymentOutcome =
  | { ok: true; hash: string; result: string }
  | {
      ok: false;
      denied: boolean;
      error: string;
      hash?: string;
      result?: string;
    };

/**
 * Sign a Payment through Privy (policy is enforced here) and submit it to testnet.
 * Pass submit=false to only ask Privy to sign (used by the "break it" demo).
 */
export async function signAndSubmitPayment(
  t: Treasury,
  destination: string,
  amountXrp: number,
  { submit = true } = {},
): Promise<PaymentOutcome> {
  return withXrpl(async (client) => {
    const hex = await preparePayment(
      client,
      { address: t.address, publicKey: t.publicKey },
      destination,
      amountXrp,
    );
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
      return {
        ok: false,
        denied: code === "policy_violation",
        error: `${msg}${code ? ` (${code})` : ""}`,
      };
    }
    if (!submit)
      return {
        ok: false,
        denied: false,
        error: "Privy signed the transaction (not submitted)",
      };
    const { hash, result } = await submitSigned(client, signed);
    return result === "tesSUCCESS"
      ? { ok: true, hash, result }
      : { ok: false, denied: false, error: result, hash, result };
  });
}

// Approved plans round-trip through the browser, so we MAC them to stop tampering between approve and execute.
export function signPlan(userId: string, planJson: string) {
  return createHmac("sha256", process.env.PRIVY_APP_SECRET!)
    .update(`${userId}\n${planJson}`)
    .digest("hex");
}
export function verifyPlan(userId: string, planJson: string, mac: string) {
  const expected = Buffer.from(signPlan(userId, planJson), "hex");
  const given = Buffer.from(mac, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
