"use client";

import { useEffect, useState } from "react";

const xrpFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export const fmtXrp = (n: number | null | undefined) =>
  n == null ? "–" : xrpFmt.format(n);

export const short = (s: string, head = 6, tail = 4) =>
  s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;

export function timeAgo(iso: string | null) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const paths = {
  copy: "M8 8h10v12H8zM6 16H4V4h12v2",
  check: "M5 12l5 5 9-10",
  x: "M6 6l12 12M18 6L6 18",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z",
  spark:
    "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18",
  ext: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  alert: "M12 4l9 16H3zM12 10v4M12 17v.5",
  plus: "M12 5v14M5 12h14",
  arrowIn: "M19 5L5 19M5 9v10h10",
  arrowOut: "M5 19L19 5M9 5h10v10",
  wallet: "M3 7h15a3 3 0 013 3v7a3 3 0 01-3 3H3zM3 7l12-4v4M16 13.5h.01",
  refresh: "M20 11a8 8 0 10-2.3 5.7M20 4v7h-7",
};

export function Icon({
  name,
  size = 16,
}: {
  name: keyof typeof paths;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden />;
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return <span className="avatar">{initials || "?"}</span>;
}

/** Middle-truncated, monospace, click to copy. */
export function Address({
  value,
  head = 6,
  tail = 4,
}: {
  value: string;
  head?: number;
  tail?: number;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="addr"
      title={value}
      onClick={() =>
        navigator.clipboard?.writeText(value).then(() => setCopied(true))
      }
    >
      <span className="mono">{short(value, head, tail)}</span>
      <Icon name={copied ? "check" : "copy"} size={12} />
    </button>
  );
}

export type Tone = "ok" | "bad" | "warn" | "neutral" | "accent";
export function Pill({
  tone,
  children,
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}
