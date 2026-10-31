"use client";

import { useEffect, useState } from "react";
import { stats, type Stats } from "@/lib/api";
import { useLang } from "@/lib/i18n";

export default function UsageStats() {
  const [s, setS] = useState<Stats | null | undefined>(undefined);
  const { d } = useLang();
  const u = d.usage;
  useEffect(() => {
    stats().then(setS).catch(() => setS(null));
  }, []);

  if (s === undefined) return <p className="text-ink-500">{d.common.loading}</p>;
  if (s === null) return <p className="text-ink-600">{u.failed}</p>;
  if (!s.requests) return <p className="text-ink-600">{u.none}</p>;
  const items = [
    [u.questions, s.requests.toLocaleString("en-IN")],
    [u.median, `${((s.p50_ms ?? 0) / 1000).toFixed(1)} s`],
    [u.p95, `${((s.p95_ms ?? 0) / 1000).toFixed(1)} s`],
    [u.repair, `${Math.round((s.fallback_rate ?? 0) * 100)}%`],
    [u.invented, String(s.invented_numbers ?? 0)],
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
