"use client";

// Measured backtest results (stored by backend/app/backtest/run_backtest.py). One plain number per
// crop: the live ranking rule at ₹1 per quintal per km, against simply going to the nearest mandi.
import { useEffect, useState } from "react";
import { API } from "@/lib/api";
import { fmt, useLang } from "@/lib/i18n";

type Summary = {
  strategy: string;
  transport_per_q_km: number;
  decisions: number;
  mean_gain?: number;
  pct_positive?: number;
};
type Run = { crop: string; window: [string, string]; villages: string[]; summaries: Summary[] };

const signed = (n: number) => `${n >= 0 ? "+" : "−"}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;

export default function BacktestCard() {
  const [runs, setRuns] = useState<Run[] | null | undefined>(undefined); // undefined = loading, null = failed
  const { d } = useLang();
  const b = d.backtest;
  const crop = b.crop as Record<string, string>;
  useEffect(() => {
    fetch(`${API}/backtest`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setRuns)
      .catch(() => setRuns(null));
  }, []);

  if (runs === undefined) return <p className="text-ink-500">{b.loading}</p>;
  if (!runs?.length) return <p className="text-ink-600">{d.common.backend_down}</p>;
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {runs.map((run) => {
        const s = run.summaries.find((x) => x.strategy === "median7_near" && x.transport_per_q_km === 1);
        if (s?.mean_gain == null) return null;
        return (
          <section key={run.crop} className="glass p-6">
            <h3 className="font-display text-2xl font-bold">{crop[run.crop] ?? run.crop}</h3>
            <p className={`mt-2 font-display text-5xl font-extrabold ${s.mean_gain >= 0 ? "text-leaf-800" : "text-red-700"}`}>
              {signed(s.mean_gain)}
            </p>
            <p className="mt-1 text-ink-700">{b.simple_gain}</p>
            <p className="mt-3 text-sm text-ink-600">
              {fmt(b.simple_detail, { pct: Math.round(s.pct_positive ?? 0), n: s.decisions.toLocaleString("en-IN") })}
            </p>
          </section>
        );
      })}
    </div>
  );
}
