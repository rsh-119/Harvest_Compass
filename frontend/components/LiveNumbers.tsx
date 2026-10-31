"use client";

// Home page results strip. Every number is read from the backend's stored backtest, never typed in.
import Link from "next/link";
import { CROP, signed, useBacktest } from "./BacktestCard";

export default function LiveNumbers() {
  const runs = useBacktest();
  const rows = (runs ?? []).flatMap((run) => {
    const s = run.summaries.find((x) => x.strategy === "median7_near" && x.transport_per_q_km === 1);
    return s?.mean_gain != null ? [{ crop: run.crop, gain: s.mean_gain, n: s.decisions, villages: run.villages.length }] : [];
  });
  if (!rows.length)
    return (
      <p className="text-ink-600">
        {runs === undefined ? "Loading measured results…" : "Results load from the live backend. "}
        <Link href="/results" className="font-semibold text-leaf-800 underline">
          Open the results page
        </Link>
      </p>
    );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.crop} className="glass p-6">
          <p className="text-sm text-ink-600">{CROP[r.crop] ?? r.crop}</p>
          <p className="font-display text-5xl font-extrabold text-ink-900">{signed(r.gain)}</p>
          <p className="mt-1 text-sm text-ink-600">
            mean gain per quintal over the nearest mandi, across {r.n.toLocaleString("en-IN")} replayed decisions in {r.villages}{" "}
            villages
          </p>
        </div>
      ))}
    </div>
  );
}
