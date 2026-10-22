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

[data/payees.json](data/payees.json) holds the starter contractors seeded into every new treasury's allowlist. All three are faucet-funded testnet accounts. Add more in the app.

## Tests

```
pnpm test        # unit tests
pnpm test:e2e    # real run on XRPL testnet: Privy wallet + policy, Claude plan, payment, policy denial
```

## Deploy to Vercel

1. Push the repo to GitHub and import it in Vercel. The framework preset is Next.js and the install command is `pnpm install`.
2. In the project's Environment Variables, add `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `ANTHROPIC_API_KEY` and, optionally, `MAX_XRP_PER_PAYMENT` and `PLAN_SECRET`.
3. In the Privy dashboard, add the Vercel domain to the app's allowed origins.
4. The API routes set `maxDuration = 60`. Keep payout requests to a handful of payments so they finish within that limit.

## Demo scenario

The operator runs payouts for **Lumen Studio**, a small design and development studio. Its approved contractors are Marisol Vega (brand designer), Tunde Adeyemi (frontend developer) and Priya Nair (copywriter). The treasury starts with 100 test XRP, and the policy caps each payment at 25 XRP.

Try the three example chips in the composer:

1. **Slack: October contractors** is a messy Slack message with some arithmetic ("2 days at 9 xrp/day"). The plan is clean and pays out.
2. **Forwarded invoice** has a "please pay my new wallet" request. Claude flags it as a possible redirection scam, the pre-check marks the address as not approved, and if you tick it anyway Privy refuses to sign.
3. **Bonus + repeat** asks for a repeat payment and a 60 XRP bonus. The repeat is flagged as a duplicate from ledger history, and the bonus is over the cap and refused by the policy.

To add a contractor, use **Approved payees → Add** (for example "Kofi Mensah, Video editor" with "Create a funded testnet account"). The address goes into the treasury's Privy condition set, and the policy allows payments to it immediately. **Test the guardrails** asks Privy to sign bad payments directly, bypassing the AI and the app.

## How it works

- `lib/privy.ts` covers login verification and the treasury. It finds or creates the operator's server wallet by `external_id`, together with its policy and payee condition set (the condition set goes over REST because the SDK has no methods for it). It also handles adding and removing payees, and signs with `xrpl_signTransaction`.
- `lib/xrpl.ts` contains the xrpl.js helpers: faucet, balances, autofill + `encodeForSigning`, a memo per payment, submit, and history from `account_tx`.
- `lib/agent.ts` is the Claude tool-use loop (`list_payees`, `get_balances`, `get_recent_payouts`, `propose_plan`), plus `validatePlan`. That function holds the deterministic checks: a policy pre-check, duplicates from the ledger, and the balance.
- `app/api/*` holds the routes `treasury`, `payees`, `history`, `plan`, `execute` (one approved payment per call, idempotent via the ledger memo) and `break-it`.
- `app/payout-app.tsx` is the UI. `/dev` renders it with fixture data in development, without a login.

The model only parses and plans. Building, signing and submitting transactions is deterministic code, and the Privy policy is the hard limit. App state is minimal: the allowlist lives in Privy, history lives on the ledger, and only payee display names are kept in `data/.store.json` (in `/tmp` on Vercel).

Testnet only. Never point this at mainnet.
