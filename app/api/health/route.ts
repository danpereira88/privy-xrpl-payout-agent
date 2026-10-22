import { route } from "@/lib/http";
import { withXrpl } from "@/lib/xrpl";

export const dynamic = "force-dynamic";

/** Public, read-only: proves the deployment can reach XRPL testnet (no secrets touched). */
export const GET = route(async () => {
  const ledger = await withXrpl((c) => c.getLedgerIndex());
  return { ok: true, network: "xrpl-testnet", ledger };
});
