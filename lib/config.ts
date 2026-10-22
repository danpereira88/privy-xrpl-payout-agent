import payeesJson from "@/data/payees.json";

export const XRPL_WS = "wss://s.altnet.rippletest.net:51233";
export const FAUCET_URL = "https://faucet.altnet.rippletest.net/accounts";
export const EXPLORER = "https://testnet.xrpl.org";
export const MAX_XRP_PER_PAYMENT = Number(
  process.env.MAX_XRP_PER_PAYMENT ?? 25,
);
/** An approved plan can be executed for this long. */
export const PLAN_TTL_MS = 30 * 60 * 1000;
/** Same payee + same amount inside this window is flagged as a possible duplicate. */
export const DUPLICATE_WINDOW_DAYS = 30;

export type Payee = { name: string; role: string; address: string };
/** The starter contractors every new treasury's allowlist is seeded with. */
export const DEFAULT_PAYEES: Payee[] = payeesJson;

export const txUrl = (hash: string) => `${EXPLORER}/transactions/${hash}`;
export const accountUrl = (address: string) =>
  `${EXPLORER}/accounts/${address}`;
