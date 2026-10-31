"use client";

// Measured backtest results (stored by backend/app/backtest/run_backtest.py). Shows what was
// measured, including where we don't beat the simple "nearest mandi" choice.
import { useEffect, useState } from "react";
import { API } from "@/lib/api";

type Summary = {
  strategy: string;
  transport_per_q_km: number;
  decisions: number;
  unrealisable?: number;
  mean_gain?: number;
  median_gain?: number;
  pct_positive?: number;
  mean_regret?: number;
};
export type Run = { crop: string; run_at: string; window: [string, string]; villages: string[]; summaries: Summary[] };

export const CROP: Record<string, string> = { Soyabean: "सोयाबीन · Soybean", Onion: "प्याज़ · Onion" };
const STRAT: Record<string, { hi: string; en: string }> = {
  today: { hi: "आज के भाव से", en: "Rank on today's price" },
  median7: { hi: "7 दिन के median से", en: "Rank on 7-day median" },
  median7_near: { hi: "median + बराबरी पर पास वाली", en: "7-day median, nearer on close calls (live)" },
};
const RATES = [0.5, 1, 2];

export function useBacktest(): Run[] | null | undefined {
  const [runs, setRuns] = useState<Run[] | null | undefined>(undefined); // undefined = loading, null = failed
  useEffect(() => {
    fetch(`${API}/backtest`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setRuns)
      .catch(() => setRuns(null));
  }, []);
  return runs;
}

export const signed = (n: number) => `${n >= 0 ? "+" : "−"}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;

export default function BacktestCard() {
  const runs = useBacktest();
  const [rate, setRate] = useState(1);

  if (runs === undefined) return <p className="text-ink-500">Loading the stored backtest…</p>;
  if (!runs?.length)
    return <p className="text-ink-600">The backend didn&apos;t answer. It may be waking up; reload in a minute.</p>;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink-600">Transport cost (assumed, ₹ per quintal per km):</span>
        <div role="radiogroup" aria-label="Transport cost" className="glass flex rounded-full p-1">
          {RATES.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={rate === c}
              onClick={() => setRate(c)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                rate === c ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-white/70"
              }`}
            >
              ₹{c}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {runs.map((run) => (
          <section key={run.crop} className="glass p-5">
            <h3 className="font-display text-2xl font-bold">{CROP[run.crop] ?? run.crop}</h3>
            <p className="text-xs text-ink-500">
              {run.villages.length} villages, {run.window[0]} to {run.window[1]}
            </p>
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs text-ink-500">
                <tr>
                  <th className="pb-1 font-normal">How the mandi is picked</th>
                  <th className="pb-1 text-right font-normal">Mean gain / q</th>
                  <th className="pb-1 text-right font-normal">Beat nearest</th>
                  <th className="pb-1 text-right font-normal">Regret / q</th>
                </tr>
              </thead>
              <tbody>
                {run.summaries
                  .filter((s) => s.transport_per_q_km === rate && s.mean_gain != null)
                  .map((s) => (
                    <tr key={s.strategy} className={`border-t border-white ${s.strategy === "median7_near" ? "font-semibold" : ""}`}>
                      <td className="py-2 pr-2">
                        {STRAT[s.strategy]?.en ?? s.strategy}
                        <span className="block text-xs font-normal text-ink-500">{STRAT[s.strategy]?.hi}</span>
                      </td>
                      <td className={`text-right ${s.mean_gain! >= 0 ? "text-leaf-800" : "text-red-700"}`}>
                        {signed(s.mean_gain!)}
                      </td>
                      <td className="text-right">{s.pct_positive}%</td>
                      <td className="text-right text-ink-600">₹{Math.round(s.mean_regret ?? 0)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}
