"use client";

// Home page results strip. Every number is read from the backend's stored backtest, never typed in.
import Link from "next/link";
import { fmt, useLang } from "@/lib/i18n";
import { signed, useBacktest } from "./BacktestCard";

export default function LiveNumbers() {
  const runs = useBacktest();
  const { d } = useLang();
  const crop = d.backtest.crop as Record<string, string>;
  const rows = (runs ?? []).flatMap((run) => {
    const s = run.summaries.find((x) => x.strategy === "median7_near" && x.transport_per_q_km === 1);
    return s?.mean_gain != null ? [{ crop: run.crop, gain: s.mean_gain, n: s.decisions, villages: run.villages.length }] : [];
  });
  if (!rows.length)
    return (
      <p className="text-ink-600">
        {runs === undefined ? d.live.loading : d.live.fallback}{" "}
        <Link href="/results" className="font-semibold text-leaf-800 underline">
          {d.live.open_results}
        </Link>
      </p>
    );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.crop} className="glass p-6">
          <p className="text-sm text-ink-600">{crop[r.crop] ?? r.crop}</p>
          <p className="font-display text-5xl font-extrabold text-ink-900">{signed(r.gain)}</p>
          <p className="mt-1 text-sm text-ink-600">
            {fmt(d.live.gain_note, { n: r.n.toLocaleString("en-IN"), v: r.villages })}
          </p>
        </div>
      ))}
    </div>
  );
}
