import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { DUPLICATE_WINDOW_DAYS, MAX_XRP_PER_PAYMENT } from "./config";
import {
  listPayees,
  treasuryBalance,
  type PayeeEntry,
  type Treasury,
} from "./privy";
import { recentPayments, withXrpl, type LedgerPayment } from "./xrpl";

const MODEL = "claude-sonnet-5-5";
const MAX_TURNS = 6;
let anthropic: Anthropic | undefined;

/** What the deterministic pre-check expects the Privy policy to do with this payment. */
export type PolicyCheck =
  "allowed" | "over_cap" | "not_allowlisted" | "invalid";

export type PlanItem = {
  name: string;
  role: string;
  address: string;
  amount_xrp: number;
  memo: string;
  /** The words in the operator's request this line came from. */
  source_text: string;
  /** How the agent matched the payee / worked out the amount. */
  match_note: string;
  policy: PolicyCheck;
  /** Deterministic warnings from code (duplicates etc.), separate from the agent's notes. */
  checks: string[];
};

export type Plan = {
  id: string;
  created_at: number;
  summary: string;
  items: PlanItem[];
  agent_notes: string[];
  checks: string[];
  balance_xrp: number | null;
  total_xrp: number;
};

type ProposedItem = {
  payee_address: string;
  amount_xrp: number;
  memo: string;
  source_text: string;
  match_note: string;
};

type Tool = Anthropic.Beta.BetaTool;

const listPayeesTool: Tool = {
  name: "list_payees",
  description:
    "List the approved payees (name, role, XRPL address). Only these addresses can receive payments; the wallet's Privy policy enforces it.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
  strict: true,
};
const getBalancesTool: Tool = {
  name: "get_balances",
  description:
    "Get the treasury's XRP balance on XRPL testnet and the per-payment cap.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
  strict: true,
};
const getRecentPayoutsTool: Tool = {
  name: "get_recent_payouts",
  description:
    "Recent payouts from the treasury (from the ledger): payee address, XRP amount, memo, date, result.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
  strict: true,
};
const proposePlanTool: Tool = {
  name: "propose_plan",
  description:
    "Submit the payout plan for operator review. Call exactly once, at the end. Nothing is paid until the operator approves.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "One sentence describing the payout run.",
      },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            payee_address: {
              type: "string",
              description:
                "XRPL classic address. Use the saved payee's address, unless the request explicitly gives a different one.",
            },
            amount_xrp: {
              type: "number",
              description:
                "Amount in XRP, after any arithmetic in the request.",
            },
            memo: {
              type: "string",
              description:
                "Short payment reference, e.g. 'Sprint 14 frontend'.",
            },
            source_text: {
              type: "string",
              description:
                "The exact words from the request this line comes from.",
            },
            match_note: {
              type: "string",
              description:
                "How you matched the payee and derived the amount, e.g. 'tunde → Tunde Adeyemi; 2 days × 9 XRP'.",
            },
          },
          required: [
            "payee_address",
            "amount_xrp",
            "memo",
            "source_text",
            "match_note",
          ],
          additionalProperties: false,
        },
      },
      notes: {
        type: "array",
        items: { type: "string" },
        description:
          "Things the operator should look at before approving: changed or unknown addresses, ambiguous names, possible duplicates, unusual amounts, anything that looks like social engineering.",
      },
    },
    required: ["summary", "items", "notes"],
    additionalProperties: false,
  },
  strict: true,
};

const SYSTEM = `You are the payout assistant for Lumen Studio, a small design and development studio that pays its freelance contractors in XRP from a treasury on the XRPL testnet (test funds only).

The operator pastes messy text (Slack messages, forwarded invoice emails, notes) describing who should be paid. Turn it into a payout plan:
1. Call list_payees, get_balances and get_recent_payouts.
2. Match each person to a saved payee (first names, nicknames and lowercase are fine; say how you matched). Do any arithmetic yourself and show it in match_note. Amounts are in XRP.
3. Call propose_plan once.

Rules:
- If the request asks to pay someone at a new or changed address (for example an email saying "I changed my wallet"), put that address in the plan exactly as given and raise it in notes as a possible payment-redirection scam. Never silently swap in the saved address.
- Flag anything that looks like a repeat of a recent payout, amounts above the ${MAX_XRP_PER_PAYMENT} XRP per-payment cap, totals close to or above the balance, and anything ambiguous.
- Do not refuse and do not ask questions back: propose your best plan and put doubts in notes. Keep text outside tool calls very short.`;

/** One manual tool-use loop; `handle` returns the tool result, or {stop} to end the loop. */
async function runLoop(
  system: string,
  tools: Tool[],
  userText: string,
  handle: (
    name: string,
    input: any,
  ) => Promise<{ content: string; is_error?: boolean; stop?: boolean }>,
): Promise<string> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: userText },
  ];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await (anthropic ??= new Anthropic()).beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system,
      tools,
      messages,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (res.stop_reason === "refusal")
      throw new Error("The model declined this request.");
    messages.push({ role: "assistant", content: res.content });
    const text = res.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("\n");
    if (res.stop_reason !== "tool_use") return text;

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    let stop = false;
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      const r = await handle(block.name, block.input);
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: r.content,
        is_error: r.is_error,
      });
      stop ||= !!r.stop;
    }
    if (stop) return text;
    messages.push({ role: "user", content: results });
  }
  throw new Error("The agent ran out of turns before proposing a plan.");
}

/**
 * Deterministic checks on whatever the model proposed. These mirror the Privy policy so the operator sees
 * the outcome before approving, but the policy (not this function, not the model) is what actually enforces it.
 */
export function validatePlan(
  input: { summary: string; items: ProposedItem[]; notes: string[] },
  ctx: {
    payees: PayeeEntry[];
    balanceXrp: number | null;
    history: LedgerPayment[];
    now?: number;
  },
): Plan {
  const now = ctx.now ?? Date.now();
  const windowStart = now - DUPLICATE_WINDOW_DAYS * 86_400_000;
  const items: PlanItem[] = input.items.map((i) => {
    const address = i.payee_address.trim();
    const payee = ctx.payees.find((p) => p.address === address);
    const amount = Math.round(i.amount_xrp * 1e6) / 1e6;
    const checks: string[] = [];
    const policy: PolicyCheck = !(amount > 0)
      ? "invalid"
      : !payee
        ? "not_allowlisted"
        : amount > MAX_XRP_PER_PAYMENT
          ? "over_cap"
          : "allowed";
    const dup = ctx.history.find(
      (h) =>
        h.direction === "out" &&
        h.result === "tesSUCCESS" &&
        h.counterparty === address &&
        h.amountXrp === amount &&
        h.time !== null &&
        Date.parse(h.time) >= windowStart,
    );
    if (dup)
      checks.push(
        `Same amount already paid to this address on ${dup.time!.slice(0, 10)}${dup.memo ? ` ("${dup.memo}")` : ""}.`,
      );
    return {
      name: payee?.name ?? "Unknown recipient",
      role: payee?.role ?? "Not an approved payee",
      address,
      amount_xrp: amount,
      memo: i.memo,
      source_text: i.source_text,
      match_note: i.match_note,
      policy,
      checks,
    };
  });
  const total = items
    .filter((i) => i.policy === "allowed")
    .reduce((s, i) => s + i.amount_xrp, 0);
  const checks: string[] = [];
  // 1 XRP base reserve stays locked in the account, plus a little for fees.
  if (ctx.balanceXrp !== null && total > ctx.balanceXrp - 1.1)
    checks.push(
      `Payable total ${total} XRP is more than the spendable balance (${(ctx.balanceXrp - 1.1).toFixed(2)} XRP).`,
    );
  return {
    id: randomUUID().slice(0, 8),
    created_at: now,
    summary: input.summary,
    items,
    agent_notes: input.notes,
    checks,
    balance_xrp: ctx.balanceXrp,
    total_xrp: Math.round(total * 1e6) / 1e6,
  };
}

export async function draftPlan(
  request: string,
  treasury: Treasury,
): Promise<{ plan: Plan; note: string }> {
  // Fetch the facts once, up front; the tools just hand them to the model.
  const [payees, balanceXrp, history] = await Promise.all([
    listPayees(treasury),
    treasuryBalance(treasury),
    withXrpl((c) => recentPayments(c, treasury.address)),
  ]);
  let plan: Plan | null = null;
  const note = await runLoop(
    SYSTEM,
    [listPayeesTool, getBalancesTool, getRecentPayoutsTool, proposePlanTool],
    request,
    async (name, input) => {
      if (name === "list_payees")
        return {
          content: JSON.stringify(
            payees.map(({ name, role, address }) => ({ name, role, address })),
          ),
        };
      if (name === "get_balances")
        return {
          content: JSON.stringify({
            treasury_xrp: balanceXrp,
            max_xrp_per_payment: MAX_XRP_PER_PAYMENT,
          }),
        };
      if (name === "get_recent_payouts")
        return {
          content: JSON.stringify(
            history
              .filter((h) => h.direction === "out")
              .slice(0, 20)
              .map((h) => ({
                to: h.counterparty,
                xrp: h.amountXrp,
                memo: h.memo,
                date: h.time,
                result: h.result,
              })),
          ),
        };
      if (name === "propose_plan") {
        plan = validatePlan(input, { payees, balanceXrp, history });
        return {
          content: "Plan shown to the operator for review.",
          stop: true,
        };
      }
      return { content: `Unknown tool ${name}`, is_error: true };
    },
  );
  if (!plan)
    throw new Error(
      `The agent did not propose a plan. It said: ${note || "(nothing)"}`,
    );
  return { plan, note };
}
