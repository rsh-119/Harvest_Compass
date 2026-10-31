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
type Run = { crop: string; run_at: string; window: [string, string]; villages: string[]; summaries: Summary[] };

const CROP_HI: Record<string, string> = { Soyabean: "सोयाबीन", Onion: "प्याज़" };
const STRAT_HI: Record<string, string> = {
  today: "आज के भाव से",
  median7: "7 दिन के median से",
  median7_near: "7 दिन का median + बराबरी पर पास वाली (अभी यही)",
};

export default function BacktestCard() {
  const [runs, setRuns] = useState<Run[] | null>(null);

  useEffect(() => {
    fetch(`${API}/backtest`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setRuns)
      .catch(() => setRuns([]));
  }, []);

  if (!runs?.length) return null;
  return (
    <details className="rounded-2xl border border-ink-200 bg-white p-4">
      <summary className="cursor-pointer font-semibold text-ink-800">
        पिछले 60 दिन की जाँच <span className="font-normal text-ink-500">(backtest on real prices)</span>
      </summary>
      <p className="mt-2 text-xs text-ink-500">
        {runs[0].villages.length} असली गाँव, हर दिन उसी दिन तक के डेटा से फ़ैसला, अगले दिन के असली भाव से हिसाब। तुलना: सबसे पास वाली मंडी।
        भाड़ा ₹1 प्रति क्विंटल प्रति km मान कर (मापा हुआ नहीं)।
      </p>
      {runs.map((run) => (
        <div key={run.crop} className="mt-3">
          <h4 className="font-semibold text-ink-800">
            {CROP_HI[run.crop] ?? run.crop}{" "}
            <span className="text-xs font-normal text-ink-500">
              ({run.window[0]} – {run.window[1]})
            </span>
          </h4>
          <table className="mt-1 w-full text-sm">
            <thead className="text-left text-xs text-ink-500">
              <tr>
                <th className="pr-2">मंडी चुनने का तरीका</th>
                <th className="pr-2 text-right">औसत फ़ायदा/क्विं.</th>
                <th className="pr-2 text-right">फ़ायदे वाले दिन</th>
                <th className="text-right">फ़ैसले</th>
              </tr>
            </thead>
            <tbody>
              {run.summaries
                .filter((s) => s.transport_per_q_km === 1 && s.mean_gain != null)
                .map((s) => (
                  <tr key={s.strategy} className="border-t border-ink-100">
                    <td className="py-1 pr-2">{STRAT_HI[s.strategy] ?? s.strategy}</td>
                    <td className={`pr-2 text-right font-semibold ${s.mean_gain! >= 0 ? "text-leaf-800" : "text-red-700"}`}>
                      {s.mean_gain! >= 0 ? "+" : "−"}₹{Math.abs(Math.round(s.mean_gain!))}
                    </td>
                    <td className="pr-2 text-right">{s.pct_positive}%</td>
                    <td className="text-right">{s.decisions}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="mt-2 text-xs text-ink-500">
        सोयाबीन के भाव पूरे म.प्र. में लगभग एक जैसे हैं, इसलिए पास की मंडी भी लगभग उतनी ही अच्छी है; प्याज़ में मंडी चुनने से असली फ़र्क पड़ता है।
      </p>
    </details>
  );
}
