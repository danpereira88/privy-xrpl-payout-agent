// Creates three funded testnet payee accounts via the faucet and writes data/payees.json.
// Seeds are discarded: payees only ever receive.
import { writeFileSync } from "node:fs";

const names = [
  { name: "Ana Souza", role: "Design contractor" },
  { name: "Ben Okafor", role: "Backend contractor" },
  { name: "Chen Li", role: "Copywriter" },
];
const payees = [];
for (const p of names) {
  const res = await fetch("https://faucet.altnet.rippletest.net/accounts", {
    method: "POST",
  });
  const body = await res.json();
  payees.push({ ...p, address: body.account.classicAddress });
  console.log(p.name, body.account.classicAddress);
}
writeFileSync("data/payees.json", JSON.stringify(payees, null, 2) + "\n");
