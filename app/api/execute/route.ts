import type { Plan } from "@/lib/agent";
import { PLAN_TTL_MS, txUrl } from "@/lib/config";
import { route } from "@/lib/http";
import {
  HttpError,
  getOrCreateTreasury,
  requireUser,
  signAndSubmitPayment,
  verifyPlan,
} from "@/lib/privy";
import { recentPayments, withXrpl } from "@/lib/xrpl";

export const maxDuration = 60;

/**
 * Execute ONE item of a plan this server drafted for this user and the operator approved (MAC-checked).
 * One item per request keeps each call well inside serverless time limits and lets the UI show progress.
 * No model is involved here: code decides what runs, Privy's policy decides what gets signed.
 */
export const POST = route(async (req) => {
  const userId = await requireUser(req);
  const { planJson, mac, index } = await req.json();
  if (
    typeof planJson !== "string" ||
    typeof mac !== "string" ||
    !verifyPlan(userId, planJson, mac)
  )
    throw new HttpError(400, "Plan was not approved or was modified.");
  const plan: Plan = JSON.parse(planJson);
  if (Date.now() - plan.created_at > PLAN_TTL_MS)
    throw new HttpError(400, "This plan expired. Draft it again.");
  const item = plan.items[index];
  if (!item) throw new HttpError(400, `No item ${index} in this plan.`);

  const t = await getOrCreateTreasury(userId);
  const ref = `${plan.id}:${index}`;
  // Idempotency from the ledger itself: every payment carries its plan/item ref in a memo.
  const already = (await withXrpl((c) => recentPayments(c, t.address))).find(
    (p) => p.ref === ref && p.result === "tesSUCCESS",
  );
  if (already)
    return {
      status: "paid",
      hash: already.hash,
      result: already.result,
      explorer: txUrl(already.hash),
      replay: true,
    };

  const outcome = await signAndSubmitPayment(t, item.address, item.amount_xrp, {
    memo: { ref, text: item.memo },
  });
  return "hash" in outcome && outcome.hash
    ? { ...outcome, explorer: txUrl(outcome.hash) }
    : outcome;
});
