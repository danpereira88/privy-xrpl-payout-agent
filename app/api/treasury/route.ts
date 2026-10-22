import { MAX_XRP_PER_PAYMENT, accountUrl } from "@/lib/config";
import { route } from "@/lib/http";
import { getOrCreateTreasury, requireUser, treasuryBalance } from "@/lib/privy";
import { fundFromFaucet, withXrpl } from "@/lib/xrpl";

export const maxDuration = 60;

/** Get (or lazily create + fund) the operator's treasury. */
export const GET = route(async (req) => {
  const t = await getOrCreateTreasury(await requireUser(req));
  const balanceXrp = await treasuryBalance(t, { fundIfMissing: true });
  return {
    address: t.address,
    walletId: t.walletId,
    policyId: t.policyId,
    payeeSetId: t.payeeSetId,
    created: t.created,
    balanceXrp,
    explorer: accountUrl(t.address),
    maxXrpPerPayment: MAX_XRP_PER_PAYMENT,
  };
});

/** Top up from the testnet faucet. */
export const POST = route(async (req) => {
  const t = await getOrCreateTreasury(await requireUser(req));
  return { balanceXrp: await withXrpl((c) => fundFromFaucet(c, t.address)) };
});
