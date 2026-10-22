import { Wallet } from "xrpl";
import { MAX_XRP_PER_PAYMENT, PAYEES } from "@/lib/config";
import { route } from "@/lib/http";
import {
  getOrCreateTreasury,
  requireUser,
  signAndSubmitPayment,
} from "@/lib/privy";

export const maxDuration = 60;

/**
 * "Break it" demo: skip every app-level check and the agent, and ask Privy to sign
 * a payment the policy should refuse. Never submitted, even if Privy were to sign it.
 */
export const POST = route(async (req) => {
  const userId = await requireUser(req);
  const { kind } = await req.json();
  const t = await getOrCreateTreasury(userId);
  const attempt =
    kind === "stranger"
      ? {
          destination: Wallet.generate().address,
          amountXrp: 1,
          label: "1 XRP to an address that is not on the allowlist",
        }
      : {
          destination: PAYEES[0].address,
          amountXrp: MAX_XRP_PER_PAYMENT * 4,
          label: `${MAX_XRP_PER_PAYMENT * 4} XRP to ${PAYEES[0].name} (cap is ${MAX_XRP_PER_PAYMENT} XRP)`,
        };
  const outcome = await signAndSubmitPayment(
    t,
    attempt.destination,
    attempt.amountXrp,
    { submit: false },
  );
  return { attempt: attempt.label, ...outcome };
});
