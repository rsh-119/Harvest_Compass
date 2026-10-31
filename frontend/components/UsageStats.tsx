"use client";

import { useEffect, useState } from "react";
import { stats, type Stats } from "@/lib/api";

export default function UsageStats() {
  const [s, setS] = useState<Stats | null | undefined>(undefined);
  useEffect(() => {
    stats().then(setS).catch(() => setS(null));
  }, []);

  if (s === undefined) return <p className="text-ink-500">Loading…</p>;
  if (s === null) return <p className="text-ink-600">The backend didn&apos;t answer. It may be waking up; reload in a minute.</p>;
  if (!s.requests) return <p className="text-ink-600">No questions logged in the last 7 days yet.</p>;
  const items = [
    ["Questions", s.requests.toLocaleString("en-IN")],
    ["Median time", `${((s.p50_ms ?? 0) / 1000).toFixed(1)} s`],
    ["95th percentile", `${((s.p95_ms ?? 0) / 1000).toFixed(1)} s`],
    ["Needed a repair", `${Math.round((s.fallback_rate ?? 0) * 100)}%`],
    ["Invented numbers caught", String(s.invented_numbers ?? 0)],
  ];
  return (
    <dl className="glass grid grid-cols-2 gap-6 p-6 sm:grid-cols-5">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-sm text-ink-600">{k}</dt>
          <dd className="font-display text-3xl font-bold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
