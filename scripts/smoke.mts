// Minimal end-to-end check, straight from the Privy XRPL guide:
// create wallet -> faucet fund -> sign Payment with xrpl_signTransaction -> submit.
import { PrivyClient } from "@privy-io/node";
import { Client as XrplClient, encodeForSigning, xrpToDrops } from "xrpl";

const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!,
});

const t0 = Date.now();
const wallet = await privy.wallets().create({ chain_type: "xrpl" });
console.log("wallet", wallet.id, wallet.address, `${Date.now() - t0}ms`);

const res = await fetch("https://faucet.altnet.rippletest.net/accounts", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ destination: wallet.address }),
});
console.log(
  "faucet",
  res.status,
  JSON.stringify(await res.json()).slice(0, 200),
);

const xrpl = new XrplClient("wss://s.altnet.rippletest.net:51233");
await xrpl.connect();
// Faucet funding takes a ledger close or two.
for (let i = 0; i < 20; i++) {
  try {
    const info = await xrpl.request({
      command: "account_info",
      account: wallet.address,
      ledger_index: "validated",
    });
    console.log("balance drops", info.result.account_data.Balance);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
  }
}

const prepared = await xrpl.autofill({
  TransactionType: "Payment",
  Account: wallet.address,
  Destination: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe", // genesis-ish testnet address used in Privy docs
  Amount: xrpToDrops("1"),
});
const forSigning = { ...prepared, SigningPubKey: wallet.public_key! };
const { data } = await privy.wallets().rpc(wallet.id, {
  method: "xrpl_signTransaction",
  params: { transaction: encodeForSigning(forSigning), encoding: "hex" },
});
const result = await xrpl.submitAndWait(data.signed_transaction);
console.log(
  "result",
  (result.result.meta as any)?.TransactionResult,
  result.result.hash,
  `${Date.now() - t0}ms total`,
);
await xrpl.disconnect();
