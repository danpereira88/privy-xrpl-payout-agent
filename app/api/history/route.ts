import { txUrl } from "@/lib/config";
import { route } from "@/lib/http";
import { getOrCreateTreasury, listPayees, requireUser } from "@/lib/privy";
import { recentPayments, withXrpl } from "@/lib/xrpl";

/** Payment history straight from the ledger (no app database). */
export const GET = route(async (req) => {
  const t = await getOrCreateTreasury(await requireUser(req));
  const [payments, payees] = await Promise.all([
    withXrpl((c) => recentPayments(c, t.address)),
    listPayees(t),
  ]);
  return payments.map((p) => ({
    ...p,
    name:
      payees.find((x) => x.address === p.counterparty)?.name ??
      (p.direction === "in" ? "Testnet faucet" : "Unknown recipient"),
    explorer: txUrl(p.hash),
  }));
});
