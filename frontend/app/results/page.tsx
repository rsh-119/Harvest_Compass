"use client";

import BacktestCard from "@/components/BacktestCard";
import UsageStats from "@/components/UsageStats";
import { useLang } from "@/lib/i18n";

// Measured on 31 Oct 2026 with backend/scripts/grounding.py (20 varied questions). Model names
// and counts here; the words around them come from the language files.
const MODELS = [
  { model: "deepseek-v4.1-flash", invented: "0", inUse: true },
  { model: "openai/gpt-5.6-terra", invented: "0", inUse: false },
  { model: "anthropic/claude-sonnet-5.5", invented: "—", inUse: false },
];

export default function Results() {
  const { d } = useLang();
  const r = d.results;
  return (
    <main className="mx-auto max-w-6xl px-4 pt-16">
      <h1 className="max-w-3xl font-display text-5xl leading-tight font-extrabold sm:text-6xl">{r.title}</h1>
      <p className="mt-5 max-w-2xl text-xl text-ink-700">{r.sub}</p>

      <section className="mt-14">
        <h2 className="font-display text-3xl font-bold">{r.bt_title}</h2>
        <p className="mt-2 max-w-3xl text-lg text-ink-700">{r.bt_body}</p>
        <div className="mt-6">
          <BacktestCard />
        </div>
      </section>

      <section className="mt-20">
        <h2 className="font-display text-3xl font-bold">{r.ground_title}</h2>
        <p className="mt-2 max-w-3xl text-lg text-ink-700">{r.ground_body}</p>
        <div className="glass mt-6 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left">
            <thead className="text-sm text-ink-500">
              <tr>
                <th className="px-5 py-3 font-normal">{r.cols.model}</th>
                <th className="px-5 py-3 font-normal">{r.cols.answered}</th>
                <th className="px-5 py-3 font-normal">{r.cols.invented}</th>
                <th className="px-5 py-3 font-normal">{r.cols.time}</th>
                <th className="px-5 py-3 font-normal">{r.cols.note}</th>
              </tr>
            </thead>
            <tbody>
              {MODELS.map((m, i) => (
                <tr key={m.model} className="border-t border-white">
                  <th className="px-5 py-3 font-semibold">
                    {m.model}
                    {m.inUse && <span className="block text-xs font-normal text-ink-500">{r.in_use}</span>}
                  </th>
                  <td className="px-5 py-3">{r.ground_rows[i].answered}</td>
                  <td className="px-5 py-3">{m.invented}</td>
                  <td className="px-5 py-3">{r.ground_rows[i].time}</td>
                  <td className="px-5 py-3 text-ink-600">{r.ground_rows[i].note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-20">
        <h2 className="font-display text-3xl font-bold">{r.usage_title}</h2>
        <p className="mt-2 max-w-3xl text-lg text-ink-700">{r.usage_body}</p>
        <div className="mt-6">
          <UsageStats />
        </div>
      </section>

      <section className="mt-20">
        <h2 className="font-display text-3xl font-bold">{r.limits_title}</h2>
        <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-6 text-lg text-ink-700">
          {r.limits.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
