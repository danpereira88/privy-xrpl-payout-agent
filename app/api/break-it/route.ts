import { Wallet } from "xrpl";
import { MAX_XRP_PER_PAYMENT } from "@/lib/config";
import { route } from "@/lib/http";
import {
  getOrCreateTreasury,
  listPayees,
  requireUser,
  signAndSubmitPayment,
} from "@/lib/privy";

export const maxDuration = 60;

/**
 * Guardrail test: skip the agent and every app-side check and ask Privy to sign a payment
 * the policy should refuse. Never submitted, even if Privy were to sign it.
 */
export const POST = route(async (req) => {
  const t = await getOrCreateTreasury(await requireUser(req));
  const { kind } = await req.json();
  const [payee] = await listPayees(t);
  const attempt =
    kind === "stranger" || !payee
      ? {
          destination: Wallet.generate().address,
          amountXrp: 1,
          label: "1 XRP to an address that isn't an approved payee",
        }
      : {
          destination: payee.address,
          amountXrp: MAX_XRP_PER_PAYMENT * 4,
          label: `${MAX_XRP_PER_PAYMENT * 4} XRP to ${payee.name} (limit is ${MAX_XRP_PER_PAYMENT} XRP)`,
        };
  const outcome = await signAndSubmitPayment(
    t,
    attempt.destination,
    attempt.amountXrp,
    { submit: false },
  );
  return { attempt: attempt.label, ...outcome };
});
