// Policy check: cap 5 XRP, allowlist one destination, Payment only. Then try 10 XRP.
import { PrivyClient } from "@privy-io/node";
import { Client as XrplClient, encodeForSigning, xrpToDrops } from "xrpl";

const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!,
});
const dest = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";
const policy = await privy.policies().create({
  version: "1.0",
  name: "smoke cap",
  chain_type: "xrpl",
  rules: [
    {
      name: "small payments to allowlist",
      method: "xrpl_signTransaction",
      action: "ALLOW",
      conditions: [
        {
          field_source: "xrpl_transaction",
          field: "TransactionType",
          operator: "eq",
          value: "Payment",
        },
        {
          field_source: "xrpl_transaction",
          field: "Payment.Destination",
          operator: "in",
          value: [dest],
        },
        {
          field_source: "xrpl_transaction",
          field: "Payment.Amount.drops",
          operator: "lte",
          value: xrpToDrops("5"),
        },
      ],
    },
  ],
});
console.log("policy", policy.id);
const wallet = await privy
  .wallets()
  .create({ chain_type: "xrpl", policy_ids: [policy.id] });
console.log("wallet", wallet.id, wallet.address, wallet.policy_ids);
await fetch("https://faucet.altnet.rippletest.net/accounts", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ destination: wallet.address }),
});
const xrpl = new XrplClient("wss://s.altnet.rippletest.net:51233");
await xrpl.connect();
for (let i = 0; i < 20; i++) {
  try {
    await xrpl.request({
      command: "account_info",
      account: wallet.address,
      ledger_index: "validated",
    });
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
  }
}
for (const xrp of ["2", "10"]) {
  const prepared = await xrpl.autofill({
    TransactionType: "Payment",
    Account: wallet.address,
    Destination: dest,
    Amount: xrpToDrops(xrp),
  });
  try {
    const { data } = await privy.wallets().rpc(wallet.id, {
      method: "xrpl_signTransaction",
      params: {
        transaction: encodeForSigning({
          ...prepared,
          SigningPubKey: wallet.public_key!,
        }),
        encoding: "hex",
      },
    });
    const r = await xrpl.submitAndWait(data.signed_transaction);
    console.log(xrp, "XRP ->", (r.result.meta as any)?.TransactionResult);
  } catch (e: any) {
    console.log(
      xrp,
      "XRP -> ERROR",
      e?.constructor?.name,
      e?.status,
      JSON.stringify(e?.error ?? e?.message),
    );
  }
}
await xrpl.disconnect();
