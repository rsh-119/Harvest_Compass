import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "How it works" };

const LOOP = [
  {
    name: "Understand",
    hi: "समझना",
    body: "A language model turns the question, in English, Hindi or any of 21 other Indian languages, into a strict form: crop, quantity, village, harvest window, vehicle rate. Sacks need a stated weight. If the village matches two places, or a value is missing, it asks one short question.",
  },
  {
    name: "Plan",
    hi: "योजना",
    body: "Plain rules decide which sources to call and why: today's prices, 30 days of history, two weather models, road routes. A question about waiting adds the trend step.",
  },
  {
    name: "Execute",
    hi: "डेटा लाना",
    body: "Calls run in parallel with timeouts and one retry. Every response is cached in Postgres with its source URL and fetch time, so a later failure can fall back to real older data and say how old it is.",
  },
  {
    name: "Audit",
    hi: "जाँच",
    body: "Pure rules, no model: prices older than 3 days, min above max, outliers against the mandi's own month and the region, and mismatched variety or grade are excluded. Each rejection is shown with its reason.",
  },
  {
    name: "Repair",
    hi: "रास्ता बदलना",
    body: "If too few mandis survive, the search radius widens. If today's price feed is down, each mandi's latest report is used with its age. If one weather model is down, the other is used and days are marked uncertain.",
  },
  {
    name: "Compute",
    hi: "हिसाब",
    body: "Each mandi's 7-day median price minus round-trip transport (trips × 2 × km × the farmer's rate) gives net ₹ per quintal. A farther mandi has to win by more than ₹50 a quintal to beat a nearer one.",
  },
  {
    name: "Explain",
    hi: "जवाब",
    body: "The model writes two or three sentences in the farmer's language from the computed facts only. A checker rejects any number or mandi name not in the facts, retries once, then falls back to a fixed template. Sarvam reads it aloud.",
  },
];

const RULES = [
  ["Stale", "Price reported more than 3 days ago"],
  ["Inconsistent", "Minimum above maximum, or the modal price outside the min–max range"],
  ["Outlier", "Unusual against both the mandi's own last 30 days and today's regional prices (robust z-score)"],
  ["Not comparable", "Different variety or grade from the most common lot in the region"],
  ["Unmapped", "Mandi town not found on OpenStreetMap, so no honest road distance"],
];

export default function HowItWorks() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-16">
      <h1 className="max-w-3xl font-display text-5xl leading-tight font-extrabold sm:text-6xl">
        One question, seven steps, all on screen.
      </h1>
      <p className="mt-5 max-w-2xl text-xl text-ink-700">
        Harvest Compass is a LangGraph agent. The language model reads the question and phrases the answer. Everything
        between, including every rupee, is plain code you can check.
      </p>

      <ol className="mt-14 space-y-4">
        {LOOP.map((s, i) => (
          <li key={s.name} className="glass grid gap-2 p-5 sm:grid-cols-[3rem_12rem_1fr] sm:items-baseline sm:gap-6 sm:p-6">
            <span className="font-display text-3xl font-extrabold text-marigold-600">{i + 1}</span>
            <h2 className="font-display text-2xl font-bold">
              {s.name}
              <span className="block text-base font-semibold text-ink-500">{s.hi}</span>
            </h2>
            <p className="text-lg text-ink-700">{s.body}</p>
          </li>
        ))}
      </ol>

      <section className="mt-24 grid gap-10 lg:grid-cols-[1fr_1.3fr]">
        <div>
          <h2 className="font-display text-4xl font-bold">Audit rules</h2>
          <p className="mt-3 text-lg text-ink-700">
            A rejected mandi is never silently dropped. The farmer sees it under “Mandis left out” with the
            reason.
          </p>
        </div>
        <table className="glass w-full overflow-hidden text-left">
          <tbody>
            {RULES.map(([k, v]) => (
              <tr key={k} className="border-b border-white last:border-0">
                <th className="px-5 py-3 align-top font-semibold whitespace-nowrap">{k}</th>
                <td className="px-5 py-3 text-ink-700">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-24 grid gap-10 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-4xl font-bold">Test switches</h2>
          <p className="mt-3 text-lg text-ink-700">
            On the ask page, the “टेस्ट स्विच” panel lets anyone switch a source off for the next question: today&apos;s
            prices, one weather model, routing. The agent skips it and the trace shows how it recovers. Nothing fake is
            filled in.
          </p>
        </div>
        <div>
          <h2 className="font-display text-4xl font-bold">Voice</h2>
          <p className="mt-3 text-lg text-ink-700">
            Sarvam speech-to-text turns the recording into text in the chosen language (all 22 scheduled languages and English), which lands in the box so the farmer can fix a
            misheard word. The reply is spoken by Sarvam text-to-speech in the 9 languages it has voices for; the rest get text. If the mic is blocked or speech fails, typing
            and reading still work.
          </p>
        </div>
      </section>

      <div className="mt-20">
        <Link href="/ask" className="btn-primary px-7 py-3.5 text-lg">
          Try a question
        </Link>
      </div>
    </main>
  );
}
