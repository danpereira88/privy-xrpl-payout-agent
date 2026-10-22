import { route } from "@/lib/http";
import {
  HttpError,
  addPayee,
  getOrCreateTreasury,
  listPayees,
  removePayee,
  requireUser,
} from "@/lib/privy";
import { faucet } from "@/lib/xrpl";

export const maxDuration = 30;

export const GET = route(async (req) =>
  listPayees(await getOrCreateTreasury(await requireUser(req))),
);

/** Add a payee to the treasury's Privy condition set (the policy allowlist). */
export const POST = route(async (req) => {
  const t = await getOrCreateTreasury(await requireUser(req));
  const { name, role, address, createTestAccount } = await req.json();
  if (typeof name !== "string" || !name.trim())
    throw new HttpError(400, "Name is required.");
  // Testnet convenience: give a new contractor a fresh faucet-funded account.
  const addr = createTestAccount
    ? await faucet()
    : String(address ?? "").trim();
  await addPayee(t, {
    name: name.trim().slice(0, 60),
    role: String(role ?? "")
      .trim()
      .slice(0, 60),
    address: addr,
  });
  return listPayees(t);
});

export const DELETE = route(async (req) => {
  const t = await getOrCreateTreasury(await requireUser(req));
  const address = new URL(req.url).searchParams.get("address");
  if (!address) throw new HttpError(400, "address is required");
  await removePayee(t, address);
  return listPayees(t);
});
