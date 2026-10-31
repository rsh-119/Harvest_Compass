import Link from "next/link";
import LiveNumbers from "@/components/LiveNumbers";

// What the agent does for one question, in order. Labels only: no example numbers.
const STEPS = [
  { hi: "सवाल समझा", en: "Understands crop, quantity, village" },
  { hi: "योजना बनाई", en: "Plans which sources to call" },
  { hi: "भाव, मौसम, दूरी लाया", en: "Fetches prices, two weather models, road km in parallel" },
  { hi: "डेटा जाँचा", en: "Rejects stale, odd and mismatched prices" },
  { hi: "ज़रूरत हो तो रास्ता बदला", en: "Repairs the plan if a source fails" },
  { hi: "खर्च काटकर हिसाब", en: "Ranks mandis by net ₹ per quintal" },
  { hi: "आपकी भाषा में जवाब, आवाज़ में", en: "Answers in the farmer's language, spoken" },
];

const GETS = [
  {
    title: "खर्च काटकर आपके हाथ में",
    en: "The mandi that pays most after round-trip transport at the farmer's own vehicle rate, not the one with the highest headline price.",
  },
  {
    title: "कटाई के सुरक्षित दिन",
    en: "Days inside the harvest window when ECMWF and GFS both expect it to stay dry, and the transport day after.",
  },
  {
    title: "रुकूँ या बेचूँ?",
    en: "What waiting three days might do, from the real 14-day price trend and rain risk, labelled as a trend, not a forecast.",
  },
  {
    title: "पूछता है, अंदाज़ा नहीं लगाता",
    en: "Which Rampur? How many kg in a sack? What does the vehicle cost? One short question instead of a made-up value.",
  },
];

// Real lines from the agent's trace, run on 31 Oct 2026 for 40 q soybean near Ujjain.
const AUDIT_LINES = [
  "Badnagar APMC: Price is 25 days old (limit 3)",
  "Badnagar APMC: Modal 5985 is far from usual (median 6900); treated as suspect",
  "Maksi APMC: Yellow/FAQ is not directly comparable with Soyabeen/FAQ",
  "Chhapiheda APMC: Could not find Chhapiheda APMC on the map; excluded",
];

const SOURCES = ["data.gov.in mandi prices", "Open-Meteo · ECMWF + GFS", "OSRM road routing", "OpenStreetMap Nominatim", "Sarvam speech"];

export default function Home() {
  return (
    <main className="px-4">
      <section className="mx-auto grid max-w-6xl items-center gap-12 pt-14 pb-20 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
        <div>
          <h1 className="font-display text-6xl leading-[1.05] font-extrabold text-ink-900 sm:text-7xl">
            कौन सी मंडी,
            <br />
            कौन सा दिन।
          </h1>
          <p className="mt-6 max-w-xl text-xl leading-relaxed text-ink-700">
            Harvest Compass tells a soybean or onion farmer which mandi pays the most once transport is paid for, and
            which days are dry enough to harvest. Ask in English, Hindi or 21 other Indian languages, by voice or text.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/ask" className="btn-primary px-7 py-3.5 text-lg">
              Ask a question
            </Link>
            <Link href="/how-it-works" className="btn-ghost px-7 py-3.5 text-lg">
              See how it works
            </Link>
          </div>
          <p className="mt-6 text-sm text-ink-600">
            Indore, Ujjain and Dewas mandis, within 150 km. No login, nothing to install.
          </p>
        </div>

        <figure className="glass-strong p-5 sm:p-7" aria-label="What the agent does with one question">
          <p className="ml-auto max-w-[85%] rounded-3xl rounded-br-md bg-ink-900 px-5 py-3 text-lg text-white">
            मेरे पास 40 क्विंटल सोयाबीन है, गाँव सांवेर। कहाँ बेचूँ?
          </p>
          <ol className="mt-6 space-y-2.5">
            {STEPS.map((s, i) => (
              <li key={s.hi} className="step-reveal flex items-start gap-3" style={{ animationDelay: `${0.25 + i * 0.35}s` }}>
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-marigold-300 to-leaf-600 text-sm font-bold text-white">
                  {i + 1}
                </span>
                <span>
                  <span className="block font-semibold text-ink-900">{s.hi}</span>
                  <span className="block text-sm text-ink-600">{s.en}</span>
                </span>
              </li>
            ))}
          </ol>
          <figcaption className="mt-5 border-t border-white pt-4 text-sm text-ink-600">
            Every step streams live on screen while the farmer waits, about 12 seconds end to end.
          </figcaption>
        </figure>
      </section>

      <section className="mx-auto max-w-6xl py-16">
        <h2 className="max-w-3xl font-display text-4xl leading-tight font-bold sm:text-5xl">
          Most farmers sell at the nearest mandi, or wherever a trader says.
        </h2>
        <div className="mt-8 grid max-w-5xl gap-8 text-lg text-ink-700 sm:grid-cols-3">
          <p>Prices differ from mandi to mandi, and the trip to reach a better one costs money.</p>
          <p>Published prices can be days old, or come from one odd lot that doesn&apos;t represent the market.</p>
          <p>Rain on harvest or transport day spoils the crop. Forecasts exist, but in English and in millimetres.</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl py-16">
        <h2 className="font-display text-4xl font-bold sm:text-5xl">What the farmer gets</h2>
        <dl className="mt-10 grid gap-x-12 gap-y-10 md:grid-cols-2">
          {GETS.map((g) => (
            <div key={g.title} className="border-l-4 border-marigold-400 pl-5">
              <dt className="font-display text-2xl font-bold text-ink-900">{g.title}</dt>
              <dd className="mt-2 text-lg text-ink-700">{g.en}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mx-auto grid max-w-6xl items-center gap-10 py-16 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-4xl font-bold sm:text-5xl">Checked before it&apos;s trusted</h2>
          <p className="mt-4 text-lg text-ink-700">
            Public price data is messy. Before ranking, the agent rejects prices that are stale, inconsistent, far from
            the mandi&apos;s own recent history, or for a different variety, and names each mandi it dropped with the
            reason. The language model only phrases numbers the agent computed; a checker throws out any number or mandi
            name it can&apos;t find in the facts.
          </p>
          <Link href="/how-it-works" className="mt-6 inline-block font-semibold text-leaf-800 underline underline-offset-4">
            How the audit and repair work
          </Link>
        </div>
        <figure className="glass p-5">
          <ul className="space-y-2 text-sm">
            {AUDIT_LINES.map((l) => (
              <li key={l} className="rounded-xl bg-white/70 px-3 py-2 text-ink-800">
                {l}
              </li>
            ))}
          </ul>
          <figcaption className="mt-3 text-xs text-ink-500">From a real run on 31 Oct 2026: 40 quintals of soybean near Ujjain.</figcaption>
        </figure>
      </section>

      <section className="mx-auto max-w-6xl py-16">
        <h2 className="font-display text-4xl font-bold sm:text-5xl">Measured, not promised</h2>
        <p className="mt-4 max-w-3xl text-lg text-ink-700">
          We replayed 60 days of real prices for 30 real villages. Each day the agent chose using only what it would have
          known that day; we then scored it on the next day&apos;s real price against simply going to the nearest mandi.
          Transport assumed at ₹1 per quintal per km.
        </p>
        <div className="mt-8">
          <LiveNumbers />
        </div>
        <p className="mt-4 text-sm text-ink-600">
          Soybean prices are nearly the same across Madhya Pradesh, so the nearest mandi is usually about as good. Onion is
          where choosing pays.{" "}
          <Link href="/results" className="font-semibold text-leaf-800 underline">
            Full results and limits
          </Link>
        </p>
      </section>

      <section className="mx-auto max-w-6xl py-10">
        <p className="text-sm text-ink-600">Every number comes from a live public source, shown with its fetch time:</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {SOURCES.map((s) => (
            <li key={s} className="glass rounded-full px-4 py-2 text-sm font-semibold text-ink-800">
              {s}
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-6xl py-16">
        <div className="glass-strong flex flex-col items-start gap-6 p-8 sm:flex-row sm:items-center sm:justify-between sm:p-12">
          <div>
            <h2 className="font-display text-4xl font-bold">Ask about your crop</h2>
            <p className="mt-2 text-lg text-ink-700">Pick your language, then tap the mic and speak, or type. The answer comes back in the same language.</p>
          </div>
          <Link href="/ask" className="btn-primary shrink-0 px-8 py-4 text-lg">
            Ask now
          </Link>
        </div>
      </section>
    </main>
  );
}
