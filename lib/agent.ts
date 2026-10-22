import Anthropic from "@anthropic-ai/sdk";
import { MAX_XRP_PER_PAYMENT, PAYEES, txUrl } from "./config";
import {
  signAndSubmitPayment,
  treasuryBalance,
  type PaymentOutcome,
  type Treasury,
} from "./privy";
import { withXrpl } from "./xrpl";

const MODEL = "claude-sonnet-5-5";
const MAX_TURNS = 8;
let anthropic: Anthropic | undefined;

export type PlanItem = {
  name: string;
  address: string;
  amount_xrp: number;
  memo: string;
  flags: string[];
};
export type Plan = {
  summary: string;
  items: PlanItem[];
  flags: string[];
  total_xrp: number;
};
export type ExecutedItem = PlanItem & { outcome: PaymentOutcome };

type Tool = Anthropic.Beta.BetaTool;

const listPayees: Tool = {
  name: "list_payees",
  description:
    "List the operator's saved payees (name, role, XRPL address). Only these addresses are allowlisted.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
  strict: true,
};
const getBalances: Tool = {
  name: "get_balances",
  description:
    "Get the treasury's current XRP balance on XRPL testnet and the per-payment cap.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
  strict: true,
};
const proposePlan: Tool = {
  name: "propose_plan",
  description:
    "Submit the payout plan for operator approval. Call this exactly once, at the end. Nothing is paid until the operator approves.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "One or two sentences describing the plan.",
      },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            payee_address: {
              type: "string",
              description:
                "XRPL classic address from list_payees, or the address the operator gave.",
            },
            amount_xrp: { type: "number" },
            memo: {
              type: "string",
              description: "Short reason for the payment.",
            },
          },
          required: ["payee_address", "amount_xrp", "memo"],
          additionalProperties: false,
        },
      },
      concerns: {
        type: "array",
        items: { type: "string" },
        description:
          "Anything odd the operator should look at: ambiguous names, unusual amounts, duplicates, unknown payees.",
      },
    },
    required: ["summary", "items", "concerns"],
    additionalProperties: false,
  },
  strict: true,
};
const executePayment: Tool = {
  name: "execute_payment",
  description:
    "Execute one item of the operator-approved plan by its zero-based index. Each item can run once.",
  input_schema: {
    type: "object",
    properties: { item_index: { type: "integer" } },
    required: ["item_index"],
    additionalProperties: false,
  },
  strict: true,
};
const getTxStatus: Tool = {
  name: "get_tx_status",
  description: "Look up a transaction on XRPL testnet by hash.",
  input_schema: {
    type: "object",
    properties: { hash: { type: "string" } },
    required: ["hash"],
    additionalProperties: false,
  },
  strict: true,
};

const PLAN_SYSTEM = `You are a payout assistant for a small business operator. The treasury is an XRP wallet on the XRPL testnet (test funds only).
Turn the operator's plain-English request into a payout plan:
1. Call list_payees and get_balances.
2. Match each person to a saved payee. Amounts are in XRP.
3. Call propose_plan once with the items and any concerns (unknown or ambiguous payees, amounts above the ${MAX_XRP_PER_PAYMENT} XRP per-payment cap, totals near or above the balance, duplicates, anything unusual).
If something is unclear, still propose your best plan and explain the doubt in concerns. Do not refuse or ask questions back. Keep text replies short.`;

const EXEC_SYSTEM = `You are executing a payout plan the operator has already approved. Call execute_payment once for each item index in order.
If a payment is denied or fails, do not retry it; move on. When done, reply with a short plain-English summary of what was paid and what was blocked and why.`;

/** One manual tool-use loop. `handle` returns the tool result, or {stop} to end the loop early. */
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
  throw new Error("Agent ran out of turns");
}

/** Deterministic checks layered on top of whatever the model proposed. The Privy policy is still the hard guardrail. */
export function validatePlan(
  input: {
    summary: string;
    items: { payee_address: string; amount_xrp: number; memo: string }[];
    concerns: string[];
  },
  balanceXrp: number | null,
): Plan {
  const items = input.items.map((i) => {
    const payee = PAYEES.find((p) => p.address === i.payee_address.trim());
    const flags: string[] = [];
    if (!payee)
      flags.push(
        "Not an allowlisted payee: the Privy policy will deny this payment.",
      );
    if (!(i.amount_xrp > 0)) flags.push("Amount must be positive.");
    if (i.amount_xrp > MAX_XRP_PER_PAYMENT)
      flags.push(
        `Above the ${MAX_XRP_PER_PAYMENT} XRP per-payment cap: the Privy policy will deny this payment.`,
      );
    return {
      name: payee?.name ?? "Unknown",
      address: i.payee_address.trim(),
      amount_xrp: i.amount_xrp,
      memo: i.memo,
      flags,
    };
  });
  const total = items.reduce((s, i) => s + i.amount_xrp, 0);
  const flags = [...input.concerns];
  // 1 XRP base reserve stays locked in the account.
  if (balanceXrp !== null && total > balanceXrp - 1)
    flags.push(
      `Total ${total} XRP exceeds the spendable balance (${(balanceXrp - 1).toFixed(2)} XRP).`,
    );
  return { summary: input.summary, items, flags, total_xrp: total };
}

export async function draftPlan(
  request: string,
  treasury: Treasury,
): Promise<{ plan: Plan; note: string }> {
  let plan: Plan | null = null;
  let balance: number | null = null;
  const note = await runLoop(
    PLAN_SYSTEM,
    [listPayees, getBalances, proposePlan],
    request,
    async (name, input) => {
      if (name === "list_payees") return { content: JSON.stringify(PAYEES) };
      if (name === "get_balances") {
        balance = await treasuryBalance(treasury);
        return {
          content: JSON.stringify({
            treasury_xrp: balance,
            max_xrp_per_payment: MAX_XRP_PER_PAYMENT,
          }),
        };
      }
      if (name === "propose_plan") {
        plan = validatePlan(
          input,
          balance ?? (await treasuryBalance(treasury)),
        );
        return {
          content: "Plan shown to the operator for approval.",
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

export async function executePlan(
  plan: Plan,
  treasury: Treasury,
): Promise<{ results: ExecutedItem[]; summary: string }> {
  const results: (ExecutedItem | undefined)[] = [];
  const summary = await runLoop(
    EXEC_SYSTEM,
    [executePayment, getTxStatus],
    `Approved plan:\n${JSON.stringify(
      plan.items.map((i, idx) => ({ index: idx, ...i })),
      null,
      2,
    )}`,
    async (name, input) => {
      if (name === "execute_payment") {
        const idx = input.item_index;
        const item = plan.items[idx];
        // Code, not the model, decides what may run: only approved items, each at most once.
        if (!item)
          return {
            content: `No item ${idx} in the approved plan.`,
            is_error: true,
          };
        if (results[idx])
          return { content: `Item ${idx} already executed.`, is_error: true };
        const outcome = await signAndSubmitPayment(
          treasury,
          item.address,
          item.amount_xrp,
        );
        results[idx] = { ...item, outcome };
        return {
          content: JSON.stringify(
            outcome.ok
              ? { ...outcome, explorer: txUrl(outcome.hash) }
              : outcome,
          ),
          is_error: !outcome.ok,
        };
      }
      if (name === "get_tx_status") {
        const r = await withXrpl((c) =>
          c.request({ command: "tx", transaction: input.hash }),
        );
        const meta = r.result.meta;
        return {
          content: JSON.stringify({
            validated: r.result.validated,
            result:
              typeof meta === "object" && meta ? meta.TransactionResult : null,
          }),
        };
      }
      return { content: `Unknown tool ${name}`, is_error: true };
    },
  );
  return { results: results.filter((r): r is ExecutedItem => !!r), summary };
}
