import { draftPlan } from "@/lib/agent";
import { route } from "@/lib/http";
import {
  HttpError,
  getOrCreateTreasury,
  requireUser,
  signPlan,
} from "@/lib/privy";

export const maxDuration = 60;

export const POST = route(async (req) => {
  const userId = await requireUser(req);
  const { request } = await req.json();
  if (typeof request !== "string" || !request.trim())
    throw new HttpError(400, "Write a payout request first.");
  const t = await getOrCreateTreasury(userId);
  const { plan, note } = await draftPlan(request.slice(0, 2000), t);
  const planJson = JSON.stringify(plan);
  return { plan, note, planJson, mac: signPlan(userId, planJson) };
});
