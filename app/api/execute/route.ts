import { executePlan, type Plan } from "@/lib/agent";
import { route } from "@/lib/http";
import {
  HttpError,
  getOrCreateTreasury,
  requireUser,
  verifyPlan,
} from "@/lib/privy";

export const maxDuration = 60;

/** Runs only a plan this server drafted for this user and the operator approved (MAC-checked). */
export const POST = route(async (req) => {
  const userId = await requireUser(req);
  const { planJson, mac } = await req.json();
  if (
    typeof planJson !== "string" ||
    typeof mac !== "string" ||
    !verifyPlan(userId, planJson, mac)
  )
    throw new HttpError(400, "Plan was not approved or was modified.");
  const plan: Plan = JSON.parse(planJson);
  const t = await getOrCreateTreasury(userId);
  return executePlan(plan, t);
});
