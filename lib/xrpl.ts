import {
  Client,
  convertHexToString,
  convertStringToHex,
  dropsToXrp,
  encodeForSigning,
  hashes,
  xrpToDrops,
  type Payment,
} from "xrpl";
import { FAUCET_URL, XRPL_WS } from "./config";

export async function withXrpl<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client(XRPL_WS);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect();
  }
}

/** XRP balance, or null if the account doesn't exist on-ledger yet (actNotFound). */
export async function getBalanceXrp(
  client: Client,
  address: string,
): Promise<number | null> {
  try {
    const info = await client.request({
      command: "account_info",
      account: address,
      ledger_index: "validated",
    });
    return Number(dropsToXrp(info.result.account_data.Balance));
  } catch (e: any) {
    if (e?.data?.error === "actNotFound") return null;
    throw e;
  }
}

/** Ask the faucet for test XRP. With no address it creates and funds a brand-new account. */
export async function faucet(destination?: string): Promise<string> {
  const res = await fetch(FAUCET_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: destination ? JSON.stringify({ destination }) : undefined,
  });
  if (!res.ok)
    throw new Error(
      `The testnet faucet returned ${res.status}. Try again in a minute.`,
    );
  const body = await res.json();
  return body.account.classicAddress;
}

export async function fundFromFaucet(
  client: Client,
  address: string,
): Promise<number | null> {
  await faucet(address);
  // The faucet payment needs a ledger close or two before account_info sees it.
  for (let i = 0; i < 15; i++) {
    const bal = await getBalanceXrp(client, address);
    if (bal !== null) return bal;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

const MEMO_TYPE = convertStringToHex("payout-agent");

/** Build + autofill a Payment and return the hex Privy expects for xrpl_signTransaction. */
export async function preparePayment(
  client: Client,
  from: { address: string; publicKey: string },
  destination: string,
  amountXrp: number,
  memo?: { ref: string; text: string },
): Promise<string> {
  const prepared = await client.autofill<Payment>({
    TransactionType: "Payment",
    Account: from.address,
    Destination: destination,
    Amount: xrpToDrops(amountXrp),
    // The memo carries "<planId>:<item>|<text>" so the ledger itself is our idempotency record.
    Memos: memo
      ? [
          {
            Memo: {
              MemoType: MEMO_TYPE,
              MemoData: convertStringToHex(
                `${memo.ref}|${memo.text}`.slice(0, 200),
              ),
            },
          },
        ]
      : undefined,
  });
  return encodeForSigning({ ...prepared, SigningPubKey: from.publicKey });
}

export type Submitted = {
  hash: string;
  result: string;
  ledger?: number;
  pending?: boolean;
};

export async function submitSigned(
  client: Client,
  signedBlob: string,
): Promise<Submitted> {
  const hash = hashes.hashSignedTx(signedBlob);
  try {
    const res = await client.submitAndWait(signedBlob);
    const meta = res.result.meta;
    const code =
      typeof meta === "object" && meta ? meta.TransactionResult : "unknown";
    return { hash, result: code, ledger: res.result.ledger_index };
  } catch (e: any) {
    // Not validated in time is not the same as failed: the tx may still land. Report it as pending.
    return { hash, result: e?.message ?? "submit error", pending: true };
  }
}

export type LedgerPayment = {
  hash: string;
  direction: "out" | "in";
  counterparty: string;
  amountXrp: number;
  result: string;
  time: string | null;
  ref: string | null;
  memo: string | null;
};

/** Recent XRP payments in and out of an account, newest first, straight from the ledger. */
export async function recentPayments(
  client: Client,
  address: string,
  limit = 60,
): Promise<LedgerPayment[]> {
  let res;
  try {
    res = await client.request({
      command: "account_tx",
      account: address,
      limit,
    });
  } catch (e: any) {
    if (e?.data?.error === "actNotFound") return [];
    throw e;
  }
  const out: LedgerPayment[] = [];
  for (const t of res.result.transactions as any[]) {
    const tx = t.tx_json ?? t.tx;
    if (tx?.TransactionType !== "Payment") continue;
    const amount = tx.DeliverMax ?? tx.Amount;
    if (typeof amount !== "string") continue; // XRP only
    const raw = tx.Memos?.[0]?.Memo;
    let ref: string | null = null;
    let memo: string | null = null;
    if (raw?.MemoType === MEMO_TYPE && raw.MemoData) {
      const [r, ...rest] = convertHexToString(raw.MemoData).split("|");
      ref = r;
      memo = rest.join("|");
    }
    const outgoing = tx.Account === address;
    out.push({
      hash: t.hash ?? tx.hash,
      direction: outgoing ? "out" : "in",
      counterparty: outgoing ? tx.Destination : tx.Account,
      amountXrp: Number(dropsToXrp(amount)),
      result: t.meta?.TransactionResult ?? "unknown",
      time: t.close_time_iso ?? null,
      ref,
      memo,
    });
  }
  return out;
}
