import payeesJson from "@/data/payees.json";

export const XRPL_WS = "wss://s.altnet.rippletest.net:51233";
export const FAUCET_URL = "https://faucet.altnet.rippletest.net/accounts";
export const EXPLORER = "https://testnet.xrpl.org";
export const MAX_XRP_PER_PAYMENT = Number(
  process.env.MAX_XRP_PER_PAYMENT ?? 25,
);

export type Payee = { name: string; role: string; address: string };
export const PAYEES: Payee[] = payeesJson;

export const txUrl = (hash: string) => `${EXPLORER}/transactions/${hash}`;
export const accountUrl = (address: string) =>
  `${EXPLORER}/accounts/${address}`;
