// Real testnet run of the server pieces (no browser login). Run with: E2E=1 pnpm test
import { describe, expect, it } from "vitest";
import { draftPlan, executePlan } from "@/lib/agent";
import { PAYEES } from "@/lib/config";
import { getOrCreateTreasury, signAndSubmitPayment } from "@/lib/privy";

describe.skipIf(!process.env.E2E)("e2e on XRPL testnet", () => {
  const user = "did:privy:e2e-smoke-user";

  it("drafts, executes and gets denied by policy", async () => {
    const t = await getOrCreateTreasury(user);
    console.log("treasury", t.address, "created", t.created);

    const { plan } = await draftPlan(
      "Pay Ana 2 XRP for the logo and Ben 30 XRP bonus.",
      t,
    );
    console.log(JSON.stringify(plan, null, 2));
    expect(plan.items.length).toBe(2);

    const { results, summary } = await executePlan(plan, t);
    console.log(
      summary,
      JSON.stringify(
        results.map((r) => [r.name, r.amount_xrp, r.outcome]),
        null,
        2,
      ),
    );
    expect(results.find((r) => r.amount_xrp === 2)?.outcome.ok).toBe(true);
    const big = results.find((r) => r.amount_xrp === 30);
    expect(big?.outcome.ok).toBe(false);
    expect(big && !big.outcome.ok && big.outcome.denied).toBe(true);

    const stranger = await signAndSubmitPayment(
      t,
      "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
      1,
      { submit: false },
    );
    expect(!stranger.ok && stranger.denied).toBe(true);
    expect(PAYEES.length).toBe(3);
  });
});
