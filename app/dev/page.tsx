"use client";

// Dev-only visual fixture of the logged-in screens (no Privy login, no network). 404s in production builds.
import { notFound } from "next/navigation";
import { useState } from "react";
import type { Plan } from "@/lib/agent";
import {
  ActivityCard,
  Composer,
  GuardrailCard,
  PayeesCard,
  PlanReview,
  RunView,
  TreasuryCard,
  type HistoryRow,
  type PayeeEntry,
  type RunRow,
} from "../payout-app";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const payees: PayeeEntry[] = [
  {
    itemId: "1",
    name: "Marisol Vega",
    role: "Brand designer",
    address: "rNxoxW81xsTxYNfAmUZErkfm1D7PioRsRc",
  },
  {
    itemId: "2",
    name: "Tunde Adeyemi",
    role: "Frontend developer",
    address: "rvsoHRbjNMFk4kZWqxKX7YB1F1HxAVEXS",
  },
  {
    itemId: "3",
    name: "Priya Nair",
    role: "Copywriter",
    address: "rJ8rXtvXnorZ3iQaDLP5NHwz16tQSSLheE",
  },
];
const treasury = {
  address: "rwBZP4ziSN9XGyzNNvUq1sGRELVF5qqaWe",
  policyId: "v7nrgneicw8mua4917ikrqin",
  payeeSetId: "iy9jnqe0hlfw7zdaiw6iwhcl",
  balanceXrp: 92.99,
  explorer: "#",
  maxXrpPerPayment: 25,
};
const plan: Plan = {
  id: "4fda9698",
  created_at: NOW,
  summary:
    "Pay Priya Nair 9 XRP (at the new address she gave) and Marisol Vega 12 XRP.",
  items: [
    {
      name: "Unknown recipient",
      role: "Not an approved payee",
      address: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
      amount_xrp: 9,
      memo: "Invoice #204 launch copy",
      source_text:
        "Invoice for the launch page copy: 9 XRP. NOTE: I've changed my wallet, please pay rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe instead of the old one.",
      match_note:
        "Priya → Priya Nair; 9 XRP as invoiced. Address is the NEW one from the email, not her saved one.",
      policy: "not_allowlisted",
      checks: [],
    },
    {
      name: "Marisol Vega",
      role: "Brand designer",
      address: "rNxoxW81xsTxYNfAmUZErkfm1D7PioRsRc",
      amount_xrp: 12,
      memo: "Icon set",
      source_text:
        "can you pay Marisol 12 XRP for the icon set while you're at it",
      match_note: "Marisol → Marisol Vega (saved payee); 12 XRP as stated.",
      policy: "allowed",
      checks: [
        'Same amount already paid to this address on 2026-10-20 ("Icon set").',
      ],
    },
  ],
  agent_notes: [
    "Possible payment-redirection scam: the forwarded email asks to pay Priya at a new address instead of her saved one. Verify with Priya through a separate channel before approving.",
    "Marisol was paid 12 XRP for an icon set two days ago. Confirm this isn't a repeat.",
  ],
  checks: [],
  balance_xrp: 92.99,
  total_xrp: 12,
};
const history: HistoryRow[] = [
  {
    hash: "A1",
    direction: "out",
    name: "Marisol Vega",
    amountXrp: 12,
    result: "tesSUCCESS",
    time: new Date(NOW - 2 * 86400e3).toISOString(),
    memo: "Icon set",
    explorer: "#",
  },
  {
    hash: "A2",
    direction: "out",
    name: "Tunde Adeyemi",
    amountXrp: 18,
    result: "tesSUCCESS",
    time: new Date(NOW - 3 * 86400e3).toISOString(),
    memo: "Sprint 14 frontend",
    explorer: "#",
  },
  {
    hash: "A3",
    direction: "in",
    name: "Testnet faucet",
    amountXrp: 100,
    result: "tesSUCCESS",
    time: new Date(NOW - 4 * 86400e3).toISOString(),
    memo: null,
    explorer: "#",
  },
];
const runRows: RunRow[] = [
  {
    item: plan.items[0],
    index: 0,
    status: "blocked",
    detail: "Privy refused to sign. No funds moved.",
  },
  {
    item: plan.items[1],
    index: 1,
    status: "paid",
    hash: "3B995E53737567A681FE11C3A344AD82E3C1C32D3C03BAE7E3C309005B9493C3",
    explorer: "#",
    detail: "Validated in ledger 21737789",
  },
];

const api = async () => {
  throw new Error("fixture");
};

export default function Dev() {
  if (process.env.NODE_ENV === "production") notFound();
  const [selected, setSelected] = useState([true, true]);
  const [text, setText] = useState("");
  return (
    <main className="layout">
      <section className="col-main">
        <Composer
          value={text}
          onChange={setText}
          onSubmit={() => {}}
          busy={false}
          disabled={false}
          collapsed={false}
        />
        <PlanReview
          plan={plan}
          cap={25}
          selected={selected}
          onToggle={(i) =>
            setSelected((s) => s.map((v, j) => (j === i ? !v : v)))
          }
          onApprove={() => {}}
          onDiscard={() => {}}
        />
        <RunView rows={runRows} running={false} onNew={() => {}} />
      </section>
      <aside className="col-side">
        <TreasuryCard t={treasury} onTopUp={async () => {}} />
        <GuardrailCard t={treasury} payeeCount={3} api={api} />
        <PayeesCard
          payees={payees}
          setPayees={() => {}}
          api={api}
          notify={() => {}}
        />
        <ActivityCard rows={history} onRefresh={() => {}} />
      </aside>
    </main>
  );
}
