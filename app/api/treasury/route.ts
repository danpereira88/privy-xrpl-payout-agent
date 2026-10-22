import { MAX_XRP_PER_PAYMENT, PAYEES, accountUrl } from "@/lib/config";
import { route } from "@/lib/http";
import { getOrCreateTreasury, requireUser, treasuryBalance } from "@/lib/privy";
import { fundFromFaucet, withXrpl } from "@/lib/xrpl";

export const maxDuration = 60;

/** Get (or lazily create + fund) the operator's treasury. */
export const GET = route(async (req) => {
  const userId = await requireUser(req);
  const t = await getOrCreateTreasury(userId);
  const balance = await treasuryBalance(t);
  return {
    address: t.address,
    walletId: t.walletId,
    policyId: t.policyId,
    created: t.created,
    balanceXrp: balance,
    explorer: accountUrl(t.address),
    maxXrpPerPayment: MAX_XRP_PER_PAYMENT,
    payees: PAYEES,
  };
});

/** Top up from the testnet faucet. */
export const POST = route(async (req) => {
  const userId = await requireUser(req);
  const t = await getOrCreateTreasury(userId);
  const balanceXrp = await withXrpl((c) => fundFromFaucet(c, t.address));
  return { balanceXrp };
});
