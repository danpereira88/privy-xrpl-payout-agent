import { describe, expect, it } from "vitest";
import { validatePlan } from "@/lib/agent";
import { DEFAULT_PAYEES, MAX_XRP_PER_PAYMENT } from "@/lib/config";

const payees = DEFAULT_PAYEES.map((p, i) => ({ ...p, itemId: String(i) }));
const item = (payee_address: string, amount_xrp: number) => ({
  payee_address,
  amount_xrp,
  memo: "m",
  source_text: "s",
  match_note: "n",
});

describe("validatePlan", () => {
  it("pre-checks the policy, flags duplicates from ledger history and overspend", () => {
    const now = Date.parse("2026-10-22T12:00:00Z");
    const plan = validatePlan(
      {
        summary: "s",
        notes: ["agent note"],
        items: [
          item(payees[0].address, 5),
          item(payees[1].address, MAX_XRP_PER_PAYMENT + 1),
          item("rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe", 1),
          item(payees[2].address, 6),
        ],
      },
      {
        payees,
        balanceXrp: 10,
        now,
        history: [
          {
            hash: "H",
            direction: "out",
            counterparty: payees[2].address,
            amountXrp: 6,
            result: "tesSUCCESS",
            time: "2026-10-20T09:00:00Z",
            ref: "x:0",
            memo: "Launch copy",
          },
        ],
      },
    );
    expect(plan.items.map((i) => i.policy)).toEqual([
      "allowed",
      "over_cap",
      "not_allowlisted",
      "allowed",
    ]);
    expect(plan.items[0].name).toBe(payees[0].name);
    expect(plan.items[3].checks.join()).toMatch(
      /already paid.*2026-10-20.*Launch copy/,
    );
    expect(plan.total_xrp).toBe(11); // only payments the policy will allow
    expect(plan.checks.join()).toMatch(/more than the spendable balance/);
    expect(plan.agent_notes).toEqual(["agent note"]);
  });
});
