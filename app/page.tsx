"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import type { ExecutedItem, Plan } from "@/lib/agent";
import type { Payee } from "@/lib/config";

type TreasuryInfo = {
  address: string;
  walletId: string;
  policyId: string | null;
  balanceXrp: number | null;
  explorer: string;
  maxXrpPerPayment: number;
  payees: Payee[];
};
type Drafted = { plan: Plan; note: string; planJson: string; mac: string };
type BreakResult = {
  attempt: string;
  ok: boolean;
  denied?: boolean;
  error?: string;
};

const EXPLORER = "https://testnet.xrpl.org";
const EXAMPLE =
  "Pay Ana 12 XRP for the logo work, Ben 8 XRP for the API fixes and Chen 5 XRP for the landing page copy.";

export default function Home() {
  const { ready, authenticated, user, login, logout, getAccessToken } =
    usePrivy();
  const [treasury, setTreasury] = useState<TreasuryInfo | null>(null);
  const [request, setRequest] = useState(EXAMPLE);
  const [drafted, setDrafted] = useState<Drafted | null>(null);
  const [executed, setExecuted] = useState<{
    results: ExecutedItem[];
    summary: string;
  } | null>(null);
  const [breaks, setBreaks] = useState<BreakResult[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const api = useCallback(
    async <T,>(path: string, body?: unknown): Promise<T> => {
      const token = await getAccessToken();
      const res = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      return json;
    },
    [getAccessToken],
  );

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const loadTreasury = useCallback(
    () =>
      run(
        "Setting up your treasury (first time: create wallet + policy, fund from faucet)…",
        async () => {
          setTreasury(await api<TreasuryInfo>("/api/treasury"));
        },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api],
  );

  useEffect(() => {
    if (authenticated) loadTreasury();
  }, [authenticated, loadTreasury]);

  if (!ready) return <main className="muted">Loading…</main>;

  if (!authenticated)
    return (
      <main>
        <h1>Payout Agent</h1>
        <p className="muted">
          Describe payouts in plain English. Claude drafts the plan, you approve
          it, and a Privy server wallet pays on the XRP Ledger <b>testnet</b>. A
          Privy policy enforces the limits.
        </p>
        <button className="primary" onClick={login}>
          Log in with email
        </button>
      </main>
    );

  return (
    <main>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Payout Agent</h1>
          <div className="muted">{user?.email?.address} · XRPL testnet</div>
        </div>
        <button onClick={logout}>Log out</button>
      </div>

      {busy && <div className="card muted">{busy}</div>}
      {error && <div className="card bad">{error}</div>}

      {treasury && (
        <div className="card">
          <h2>Treasury</h2>
          <div>
            <a href={treasury.explorer} target="_blank" rel="noreferrer">
              <code>{treasury.address}</code>
            </a>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <b>
              {treasury.balanceXrp === null
                ? "Not funded yet"
                : `${treasury.balanceXrp} XRP`}
            </b>
            <button disabled={!!busy} onClick={loadTreasury}>
              Refresh
            </button>
            <button
              disabled={!!busy}
              onClick={() =>
                run("Requesting testnet XRP from the faucet…", async () => {
                  await api("/api/treasury", {});
                  await loadTreasury();
                })
              }
            >
              Top up from faucet
            </button>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            Policy <code>{treasury.policyId}</code>: Payment only, max{" "}
            {treasury.maxXrpPerPayment} XRP per payment, only to these payees:
          </p>
          <table>
            <tbody>
              {treasury.payees.map((p) => (
                <tr key={p.address}>
                  <td>{p.name}</td>
                  <td className="muted">{p.role}</td>
                  <td>
                    <code>{p.address}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {treasury && (
        <div className="card">
          <h2>New payout</h2>
          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="primary"
              disabled={!!busy || !request.trim()}
              onClick={() =>
                run("Claude is drafting a plan…", async () => {
                  setDrafted(null);
                  setExecuted(null);
                  setDrafted(await api<Drafted>("/api/plan", { request }));
                })
              }
            >
              Draft plan
            </button>
            <button
              disabled={!!busy}
              onClick={() =>
                setRequest(
                  "Pay Ana 100 XRP as a bonus, and send 5 XRP to rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe.",
                )
              }
            >
              Use a risky example
            </button>
          </div>
        </div>
      )}

      {drafted && (
        <div className="card">
          <h2>Plan for approval</h2>
          <p>{drafted.plan.summary}</p>
          <table>
            <thead>
              <tr>
                <th>Payee</th>
                <th>XRP</th>
                <th>Memo</th>
              </tr>
            </thead>
            <tbody>
              {drafted.plan.items.map((i, idx) => (
                <tr key={idx}>
                  <td>
                    {i.name}
                    <br />
                    <code className="muted">{i.address}</code>
                  </td>
                  <td>{i.amount_xrp}</td>
                  <td>
                    {i.memo}
                    {i.flags.length > 0 && (
                      <ul className="flags warn">
                        {i.flags.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <b>Total: {drafted.plan.total_xrp} XRP</b>
          </p>
          {drafted.plan.flags.length > 0 && (
            <ul className="flags warn">
              {drafted.plan.flags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          {!executed && (
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="primary"
                disabled={!!busy}
                onClick={() =>
                  run(
                    "Executing approved plan (signing via Privy, submitting to testnet)…",
                    async () => {
                      setExecuted(
                        await api("/api/execute", {
                          planJson: drafted.planJson,
                          mac: drafted.mac,
                        }),
                      );
                      await loadTreasury();
                    },
                  )
                }
              >
                Approve and pay
              </button>
              <button disabled={!!busy} onClick={() => setDrafted(null)}>
                Reject
              </button>
            </div>
          )}
        </div>
      )}

      {executed && (
        <div className="card">
          <h2>Results</h2>
          <p>{executed.summary}</p>
          <table>
            <tbody>
              {executed.results.map((r, idx) => (
                <tr key={idx}>
                  <td>{r.name}</td>
                  <td>{r.amount_xrp} XRP</td>
                  <td>
                    {r.outcome.ok ? (
                      <a
                        className="ok"
                        href={`${EXPLORER}/transactions/${r.outcome.hash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {r.outcome.result} ↗
                      </a>
                    ) : (
                      <span className="bad">
                        {r.outcome.denied ? "Denied by Privy policy" : "Failed"}
                        : {r.outcome.error}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {treasury && (
        <div className="card">
          <h2>Break it</h2>
          <p className="muted">
            These skip the agent and every app-side check and ask Privy to sign
            directly. The policy should refuse. Nothing is ever submitted.
          </p>
          <div className="row">
            <button
              disabled={!!busy}
              onClick={() =>
                run(
                  "Asking Privy to sign an over-budget payment…",
                  async () => {
                    const r = await api<BreakResult>("/api/break-it", {
                      kind: "over_cap",
                    });
                    setBreaks((b) => [r, ...b]);
                  },
                )
              }
            >
              Over-budget payment
            </button>
            <button
              disabled={!!busy}
              onClick={() =>
                run(
                  "Asking Privy to sign a payment to a stranger…",
                  async () => {
                    const r = await api<BreakResult>("/api/break-it", {
                      kind: "stranger",
                    });
                    setBreaks((b) => [r, ...b]);
                  },
                )
              }
            >
              Pay a non-allowlisted address
            </button>
          </div>
          {breaks.map((b, i) => (
            <p key={i}>
              {b.attempt}:{" "}
              {b.denied ? (
                <b className="ok">blocked by policy ({b.error})</b>
              ) : (
                <b className="bad">NOT blocked: {b.error}</b>
              )}
            </p>
          ))}
        </div>
      )}
    </main>
  );
}
