import { describe, expect, it } from "vitest";
import { validatePlan } from "@/lib/agent";
import { MAX_XRP_PER_PAYMENT, PAYEES } from "@/lib/config";

describe("validatePlan", () => {
  it("flags unknown payees, over-cap amounts and overspend", () => {
    const plan = validatePlan(
      {
        summary: "s",
        concerns: [],
        items: [
          { payee_address: PAYEES[0].address, amount_xrp: 5, memo: "ok" },
          {
            payee_address: PAYEES[1].address,
            amount_xrp: MAX_XRP_PER_PAYMENT + 1,
            memo: "big",
          },
          {
            payee_address: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
            amount_xrp: 1,
            memo: "stranger",
          },
        ],
      },
      10,
    );
    expect(plan.items[0].flags).toEqual([]);
    expect(plan.items[0].name).toBe(PAYEES[0].name);
    expect(plan.items[1].flags.join()).toMatch(/cap/);
    expect(plan.items[2].flags.join()).toMatch(/allowlisted/);
    expect(plan.flags.join()).toMatch(/exceeds the spendable balance/);
  });
});
