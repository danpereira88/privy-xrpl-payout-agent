# Payout Agent

A small app for evaluating Privy's developer experience on the XRP Ledger **testnet**. An operator logs in with email and gets a treasury, which is a Privy server wallet on XRPL testnet funded from the faucet. They describe payouts in plain English, Claude drafts a plan, and after the operator approves it the payments are signed through Privy and submitted to testnet. A Privy policy enforces Payment-only transactions, allowlisted payees and a per-payment cap, and the "Break it" panel shows the policy refusing.

The DX notes live in [DX_LOG.md](DX_LOG.md). Project rules are in [CLAUDE.md](CLAUDE.md).

## Run locally

1. Install the dependencies:

   ```
   pnpm install
   ```

2. Copy `.env.example` to `.env.local` and fill in `PRIVY_APP_ID`, `PRIVY_APP_SECRET` and `ANTHROPIC_API_KEY`. The Privy app needs **Email** login enabled in the dashboard.

3. Start the dev server and open http://localhost:3000:

   ```
   pnpm dev
   ```

4. Log in with your email. The first load creates your treasury wallet and its policy and funds the wallet from the faucet, which takes about 5 seconds.

The payees in [data/payees.json](data/payees.json) are three faucet-funded testnet accounts. To regenerate them, run `node scripts/seed-payees.mts`. New payees only take effect in policies created afterwards.

## Tests

```
pnpm test        # unit tests
pnpm test:e2e    # real run on XRPL testnet: Privy wallet + policy, Claude plan, payment, policy denial
```

## Deploy to Vercel

1. Push the repo to GitHub and import it in Vercel. The framework preset is Next.js and the install command is `pnpm install`.
2. In the project's Environment Variables, add `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `ANTHROPIC_API_KEY` and, optionally, `MAX_XRP_PER_PAYMENT`.
3. In the Privy dashboard, add the Vercel domain to the app's allowed origins.
4. The API routes set `maxDuration = 60`. Keep payout requests to a handful of payments so they finish within that limit.

## How it works

- `lib/privy.ts` verifies the access token and finds or creates the treasury, looking it up by `external_id` so no database is needed. It also builds the policy, and signs with `xrpl_signTransaction` before submitting.
- `lib/xrpl.ts` handles the xrpl.js client, faucet funding, balances, autofill + `encodeForSigning`, and submit.
- `lib/agent.ts` holds the Claude tool-use loops. Planning uses `list_payees`, `get_balances` and `propose_plan`. Execution uses `execute_payment` and `get_tx_status`, and code only lets it run items from the operator-approved, MAC-checked plan, each once.
- `app/api/*` contains the routes `treasury`, `plan`, `execute` and `break-it`, and `app/page.tsx` is the UI.

The model does the fuzzy parts. Transactions are built, signed and submitted by deterministic code, and the Privy policy is the hard limit.

Testnet only. Never point this at mainnet.
