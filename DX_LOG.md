# DX log: Privy + XRPL testnet

Running notes on the developer experience of building the Payout Agent with Privy server wallets on the XRP Ledger testnet. Times are BST on 2026-10-22. The SDK versions are `@privy-io/node` 0.36.0, `@privy-io/react-auth` 3.51.0, `xrpl` 5.3.0 and Next.js 15.5.

## Headline metrics

| Metric | Result |
| --- | --- |
| Empty folder → first signed testnet tx | **~3 min** (16:00 → 16:03). That includes installing pnpm and the deps and reading the XRPL guide. The first attempt worked. |
| Empty folder → first policy denial | **~4 min**. The first attempt worked, and the denial came back as a clean `policy_violation` 400. |
| Empty folder → full agent flow on testnet (plan → approve → pay → policy deny) | **~8 min** (e2e test green at 16:08) |
| Empty folder → first login | The Privy email modal rendered at ~16:11 with zero config beyond the app ID. **The OTP login itself has not been tested yet**, because it needs a code sent to Danilo's inbox. |
| Lines of code: sign + submit an XRPL payment via Privy | ~25 (the guide example, nearly verbatim) |
| Lines of code: policy (Payment only + allowlist + per-payment cap) | ~25 (one rule, 3 conditions) |
| Lines of code: whole v1 app (lib + routes + UI) | ~560 excluding scripts/tests (UI is ~300 of that) |
| Times we left the official docs to get unstuck | **0**. We used Privy's own `llms.txt` index once to find a page the nav didn't link (see #2). The SDK's `.d.ts` files filled the remaining gaps. |

## Entries

### 1. First signed tx from the XRPL guide (positive)
- **Goal:** create a wallet, fund it from the faucet, sign a Payment with `xrpl_signTransaction` and submit it.
- **What happened:** the Node example on the XRPL page ran almost verbatim and the first attempt returned `tesSUCCESS` (12.6 s end to end, most of it faucet + ledger close). The `rpc()` call is fully typed: `method: 'xrpl_signTransaction'` narrows `params` and the response, so `data.signed_transaction` autocompletes. The faucet and `actNotFound`-until-funded behaviour were exactly as documented.
- **Time:** ~3 min, 1 attempt.
- **Compared to expectations:** better than expected for a non-EVM chain. The only things you bring yourself are xrpl.js `autofill`, adding `SigningPubKey`, and `encodeForSigning`, all in the example.

### 2. Finding the XRPL policy docs (friction)
- **Goal:** write a policy with Payment only, an allowlist of destinations and a max amount.
- **What happened:** the "Create a policy" page only shows `chain_type: 'ethereum'` (the REST section lists ethereum as the only chain type) and doesn't link to XRPL. The XRPL guide mentions that policies exist but links to no XRPL field reference. I found "XRPL examples" (`/controls/policies/example-policies/xrpl`) through `docs.privy.io/llms.txt`. Once found, the page is **excellent**: copy-paste rules for every case, a full field/operator table, and sharp warnings (X-addresses never match condition sets, a `Payment.Destination` denylist doesn't cover `CheckCreate`/`Batch`, and `*` is not a valid method for xrpl).
- **Also:** the XRPL guide URL in our CLAUDE.md (`/wallets/using-wallets/other-chains/xrpl`) now 307-redirects to `/wallets/using-wallets/xrpl/overview`.
- **Time:** ~5 min of searching.
- **Compared to expectations:** discoverability is the gap, not content. A link from the XRPL guide and from "Create a policy" to the XRPL examples would fix it.

### 3. Policy types in the SDK (positive)
- `XrplTransactionConditionField` is a string-literal union of every supported field (`'Payment.Amount.drops'`, …), so TypeScript catches typos in policy rules. `policies().create()` worked the first time, and so did attaching it with `wallets().create({ policy_ids: [id] })`. App-owned wallets and policies need no authorization keys, which makes for a fast start.
- **Small wart:** `policies.d.ts` imports the `Prettify` type from `viem`, so the Node SDK's types pull in an EVM library even for XRPL.

### 4. Policy denial error (mixed)
- **What happened:** the denial is a `BadRequestError` (400) with `error.code = "policy_violation"` and the message `"RPC request denied due to policy violation"`. It's easy to detect reliably, which is good.
- **Gap:** it doesn't say *which* rule or condition failed (cap vs. allowlist vs. tx type). For an agent that has to explain a denial to an operator, we had to re-derive the reason in our own code (`validatePlan` duplicates the policy logic to label items in advance). A `failed_condition` or rule name in the error would remove that duplication.

### 5. Access-token verification docs vs SDK (docs mismatch)
- **Docs:** `privy.utils().auth().verifyAccessToken({ access_token: accessToken })`.
- **SDK 0.36:** `verifyAccessToken(accessToken: string)`, a positional string. TypeScript caught it before runtime, so it cost about 1 minute. The low-level `lib/auth` export does take `{ access_token, app_id, verification_key }`, which is probably where the docs example came from.
- The same page says the token is "a standard ES256 JWT" verified with "an Ed25519 public key". ES256 is P-256 ECDSA, so one of those is wrong.

### 6. `external_id` as the user → wallet mapping (positive, with one snag)
- `wallets().create({ external_id })` plus `wallets().list({ external_id })` means we need **no database** to map an operator to their treasury. That's great for a serverless app.
- **Snag:** Privy's own user IDs (`did:privy:…`) are not valid `external_id` values (only `[a-zA-Z0-9_-]` is allowed), so you can't pass the user ID straight through. We strip the `did:privy:` prefix.
- Also, `policy_ids` accepts **up to one** policy per wallet, so all rules for a wallet must live in that one policy.

### 7. `PrivyClient` throws at construction without env (friction)
- `new PrivyClient(...)` throws immediately if `PRIVY_APP_ID` is empty. Creating the client at module scope (as every doc example does) made unit tests that import any server module fail even when they never touch Privy, and it can break `next build` in CI without secrets. The fix was a lazy getter. This is minor, but every Next.js user creating a module-level client will hit it.

### 8. React SDK weight for an email-only app (friction)
- `@privy-io/react-auth` pulls in wagmi, WalletConnect/Reown, viem and Solana kit even with `loginMethods: ['email']` and embedded wallets off.
- Install shows peer warnings (`use-sync-external-store` wants React ≤18, and `@privy-io/ethereum` pins `viem@2.56.5`).
- `next dev` and `next build` warn `Module not found: Can't resolve '@farcaster/mini-app-solana'` plus `ox` "critical dependency" warnings.
- The home page is 377 kB first-load JS for what is essentially a login button. None of it is blocking, but a newcomer sees a wall of yellow on first run and wonders if something is broken.
- **Positive:** `login()` from `usePrivy` opens a clean, branded email/OTP modal with zero UI work, and `localhost` worked without any allowed-origins setup.

### 9. No XRPL convenience layer (neutral)
- The Node SDK has `ethereum`, `solana` and `tron` service helpers but no `xrpl` one. For XRPL you call the generic `rpc()` with `xrpl_signTransaction` and broadcast yourself with xrpl.js. In practice this was ~10 lines, and it makes the Privy surface small and predictable. A `sendTransaction`-style helper that autofills and submits would still save every XRPL user the same boilerplate.

### 10. Policy ownership and mutable allowlists (production gap, not hit in v1)
- We created the policy with no `owner`. The docs say this means the app secret alone can rewrite it, so anyone with `PRIVY_APP_SECRET` could loosen the guardrail. Real use should set an owner (key quorum).
- The payee allowlist is baked into the policy rule, so adding a payee means `policies().update()`. Condition sets (`in_condition_set`) look like the right tool for a changing allowlist. The XRPL docs only show them for a denylist, but the field table says `Payment.Destination` supports `in_condition_set`. That's a good v2 item.

### 11. Tooling notes (not Privy)
- `pnpm` wasn't installed on the machine; one `npm i -g pnpm` fixed it.
- `pnpm add typescript` pulled TS 7 by default; pinned to TS 5 for Next 15.
- Vitest 5 has no `--env-file`, so we use `node --env-file=.env.local …/vitest.mjs`.
- The model for the agent is `claude-sonnet-5-5` with tool use. The planner flagged the over-cap item by itself and the executor explained the denial correctly on the first run.

## Verified end to end on testnet (by `pnpm test:e2e`)

- Treasury wallet created via Privy with an attached policy, funded with 100 XRP from the faucet.
- "Pay Ana 2 XRP for the logo and Ben 30 XRP bonus." Claude drafted a 2-item plan and flagged Ben's 30 XRP as over the 25 XRP cap.
- Executing the plan paid Ana 2 XRP (`tesSUCCESS`, e.g. tx `4E9925B6071D2A5635D5DB314E79BDF0C56615D2AFD39FFD8CB6339934C99522`). **The Privy policy denied** Ben's 30 XRP (`policy_violation`), and the agent summarised why.
- 1 XRP to a non-allowlisted address was denied by the policy.

## Open items / to verify next

- [ ] Real email OTP login in the browser (needs Danilo's inbox), then the full UI flow at localhost:3000.
- [ ] Deploy to Vercel: confirm the 60 s function limit is enough for a 3-payment execute (~20 s locally).
- [ ] Does a Privy-signed XRPL tx show up anywhere in the Privy dashboard, given that Privy signs but doesn't broadcast?
- [ ] Try `raw_sign` once on purpose to measure the extra work (DER conversion).
- [ ] Condition set for the payee allowlist; policy owner via a key quorum.
