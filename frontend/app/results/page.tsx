import type { Metadata } from "next";
import BacktestCard from "@/components/BacktestCard";
import UsageStats from "@/components/UsageStats";

export const metadata: Metadata = { title: "Results" };

// Measured on 31 Oct 2026 with backend/scripts/grounding.py (20 varied Hindi/Hinglish questions).
const GROUNDING = [
  { model: "deepseek-v4.1-flash (in use)", answered: "19 of 20", invented: "0", time: "11.4 s / 15.3 s", note: "The 20th correctly asked to confirm a tahsil" },
  { model: "openai/gpt-5.6-terra", answered: "19 of 20", invented: "0", time: "11.6 s median", note: "Wrote Badnagar as a different town" },
  { model: "anthropic/claude-sonnet-5.5", answered: "—", invented: "—", time: "—", note: "Doesn't support the forced tool call we use" },
];

const LIMITS = [
  "Transport in the backtest is an assumed range, not a measured local rate. Live answers use the farmer's own rate.",
  "data.gov.in history lags a day and many mandis skip days; about 30–40% of replayed decisions couldn't be scored.",
  "The ₹50 per quintal close-call margin is a judgement call.",
  "Weather beyond 7 days isn't forecast; those days are shown as having no forecast yet.",
  "Voice accuracy on real farmer recordings is still being measured.",
];

export default function Results() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-16">
      <h1 className="max-w-3xl font-display text-5xl leading-tight font-extrabold sm:text-6xl">What we measured</h1>
      <p className="mt-5 max-w-2xl text-xl text-ink-700">
        Numbers here are read from the backend&apos;s stored runs. Where the agent doesn&apos;t beat the simple choice, it
        says so.
      </p>

      <section className="mt-14">
        <h2 className="font-display text-3xl font-bold">Backtest: 60 days, 30 villages</h2>
        <p className="mt-2 max-w-3xl text-lg text-ink-700">
          Each day, the agent chose a mandi using only data up to that day, with its own audit and ranking. We scored the
          choice on the next day&apos;s real price at that mandi, against the nearest reporting mandi. Regret is how far
          behind the best mandi in hindsight it was.
        </p>
        <div className="mt-6">
          <BacktestCard />
        </div>
      </section>

      <section className="mt-20">
        <h2 className="font-display text-3xl font-bold">Grounding: does the model invent numbers?</h2>
        <p className="mt-2 max-w-3xl text-lg text-ink-700">
          20 varied questions through the whole agent, on 31 Oct 2026. Every number in each Hindi answer was checked
          against the computed facts.
        </p>
        <div className="glass mt-6 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left">
            <thead className="text-sm text-ink-500">
              <tr>
                <th className="px-5 py-3 font-normal">Model</th>
                <th className="px-5 py-3 font-normal">Answered</th>
                <th className="px-5 py-3 font-normal">Invented numbers</th>
                <th className="px-5 py-3 font-normal">Median / p95 time</th>
                <th className="px-5 py-3 font-normal">Note</th>
              </tr>
            </thead>
            <tbody>
              {GROUNDING.map((g) => (
                <tr key={g.model} className="border-t border-white">
                  <th className="px-5 py-3 font-semibold">{g.model}</th>
                  <td className="px-5 py-3">{g.answered}</td>
                  <td className="px-5 py-3">{g.invented}</td>
                  <td className="px-5 py-3">{g.time}</td>
                  <td className="px-5 py-3 text-ink-600">{g.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-20">
        <h2 className="font-display text-3xl font-bold">Live usage, last 7 days</h2>
        <p className="mt-2 max-w-3xl text-lg text-ink-700">Logged for every question asked on this site. No IP or identity is stored.</p>
        <div className="mt-6">
          <UsageStats />
        </div>
      </section>

      <section className="mt-20">
        <h2 className="font-display text-3xl font-bold">Limits</h2>
        <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-6 text-lg text-ink-700">
          {LIMITS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
