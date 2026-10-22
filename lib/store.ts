import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Payee names/roles are the only app-side state. The allowlist itself lives in a Privy condition set
// and payment history comes from the ledger, so losing this file (e.g. Vercel's ephemeral /tmp) only
// loses display names.
const FILE = process.env.VERCEL
  ? "/tmp/payout-agent-store.json"
  : join(process.cwd(), "data/.store.json");

type Store = Record<string, Record<string, { name: string; role: string }>>; // walletId -> address -> meta

function read(): Store {
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

export function getPayeeMeta(walletId: string) {
  return read()[walletId] ?? {};
}

export function setPayeeMeta(
  walletId: string,
  address: string,
  meta: { name: string; role: string } | null,
) {
  const s = read();
  const forWallet = (s[walletId] ??= {});
  if (meta) forWallet[address] = meta;
  else delete forWallet[address];
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(s, null, 2));
}
