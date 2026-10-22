import {
  Client,
  dropsToXrp,
  encodeForSigning,
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

export async function fundFromFaucet(
  client: Client,
  address: string,
): Promise<number | null> {
  const res = await fetch(FAUCET_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ destination: address }),
  });
  if (!res.ok) throw new Error(`Faucet returned ${res.status}`);
  // The faucet payment needs a ledger close or two before account_info sees it.
  for (let i = 0; i < 15; i++) {
    const bal = await getBalanceXrp(client, address);
    if (bal !== null) return bal;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

/** Build + autofill a Payment and return the hex Privy expects for xrpl_signTransaction. */
export async function preparePayment(
  client: Client,
  from: { address: string; publicKey: string },
  destination: string,
  amountXrp: number,
): Promise<string> {
  const prepared = await client.autofill<Payment>({
    TransactionType: "Payment",
    Account: from.address,
    Destination: destination,
    Amount: xrpToDrops(amountXrp),
  });
  return encodeForSigning({ ...prepared, SigningPubKey: from.publicKey });
}

export async function submitSigned(client: Client, signedBlob: string) {
  const res = await client.submitAndWait(signedBlob);
  const meta = res.result.meta;
  const code =
    typeof meta === "object" && meta ? meta.TransactionResult : "unknown";
  return { hash: res.result.hash, result: code };
}
