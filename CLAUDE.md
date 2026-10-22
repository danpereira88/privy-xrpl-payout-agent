# CLAUDE.md

## What this project is

A small app for evaluating the **developer experience of Privy** by building AI agents that hold wallets and transact on the **XRP Ledger (testnet)**.

The DX evaluation matters as much as the app. Every bit of friction we hit (confusing docs, missing types, extra steps, surprising errors) is data, so log it in `DX_LOG.md`. Keep the code simple and keep notes.

## The app: Payout Agent

Spec summary (from the "XRPL Payout Agent" PRD):

- An operator logs in with email through Privy and gets a treasury (a Privy server wallet on XRPL testnet, funded from the faucet).
- They write a payout request in plain English ("pay these three contractors..."). A Claude agent drafts a plan, flags anything odd, and executes it after approval.
- Payments are signed through Privy and submitted to XRPL testnet. A Privy policy (max per payment, allowed payees, Payment tx only) is the hard guardrail.
- A "break it" demo shows an over-budget request being denied by the policy.
- Stretch: RLUSD payouts, invoice extraction, daily cap, client-side embedded XRPL wallet.

AI does the fuzzy parts (parsing, planning, anomaly flags, explanations). Building, signing and submitting transactions is deterministic code. Never let the model be the only safeguard.

## Stack

- TypeScript, Next.js (App Router), pnpm. Hosted on Vercel's free tier.
- `@privy-io/react-auth` for login, `@privy-io/node` for server wallets, policies and signing.
- `xrpl` (xrpl.js) to autofill, encode, submit and confirm transactions.
- `@anthropic-ai/sdk` with tool use. Default model: `claude-sonnet-5-5`. Agent tools: `list_payees`, `get_balances`, `propose_plan`, `execute_payment`, `get_tx_status`. `execute_payment` only runs on an operator-approved plan.
- Payees and history in a JSON file or SQLite. No real database in v1.
- Vitest for the few tests worth having. Prettier with default settings.

## Layout

```
app/                # Next.js pages and API routes (all Privy/Anthropic secrets stay server-side)
lib/privy.ts        # Privy client, wallets, policies
lib/xrpl.ts         # xrpl.js client, faucet funding, balances, sign+submit helpers
lib/agent.ts        # Claude agent loop and tool definitions
DX_LOG.md           # running DX notes (see below)
.env.example
```

## Commands

```
pnpm install
pnpm dev
pnpm test
pnpm test:e2e   # real XRPL testnet run (needs .env.local)
```

Update this section if the commands change. Keep agent runs short so they fit Vercel's function time limit.

## How XRPL signing works with Privy

Follow the official guide: https://docs.privy.io/wallets/using-wallets/other-chains/xrpl

1. Create wallets with `privy.wallets().create({ chain_type: 'xrpl' })`.
2. Fund new accounts from the testnet faucet (`https://faucet.altnet.rippletest.net/accounts`). An account doesn't exist on-ledger until it holds the 1 XRP reserve, so `account_info` returns `actNotFound` before funding.
3. Build and `autofill` the tx with xrpl.js, set `SigningPubKey`, then `encodeForSigning`.
4. Sign with `privy.wallets().rpc(walletId, { method: 'xrpl_signTransaction', params: { transaction: hex, encoding: 'hex' } })`.
5. Submit `data.signed_transaction` with xrpl.js and wait for validation.

Prefer `xrpl_signTransaction`. Only use `raw_sign` if we want to test it on purpose, and log the extra work it takes in the DX log.

Testnet websocket: `wss://s.altnet.rippletest.net:51233`. Explorer: https://testnet.xrpl.org

## DX log (important)

Keep `DX_LOG.md` up to date as you work. For each entry, record:

- What we were trying to do.
- What happened: docs gaps, wrong or outdated examples, confusing errors, missing types, extra steps, things that were nicer than expected.
- Time spent or number of attempts, roughly.
- How it compares to what a developer would expect, if relevant.

Also track a few headline metrics: time from empty repo to first signed testnet tx, lines of code needed per feature, and how many times we had to leave the official docs to get unstuck.

Be honest and specific. Positive findings matter as much as negative ones.

## Rules

- **Testnet only.** Never point anything at XRPL mainnet, and never handle real funds.
- **Never commit secrets.** `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `ANTHROPIC_API_KEY` and any authorization keys live in `.env.local` (gitignored) and in Vercel environment variables. Keep `.env.example` current with placeholder values. Nothing secret goes in client code.
- Keep it simple. Prefer the most straightforward path the Privy docs suggest, because that's what we're evaluating. Don't add abstractions, frameworks or extra chains.
- When the docs and the SDK disagree, trust the SDK's behavior, note the mismatch in the DX log, and move on.
- Work on feature branches with small commits. Don't merge PRs without Danilo's OK.
