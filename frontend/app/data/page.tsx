import type { Metadata } from "next";

export const metadata: Metadata = { title: "Data & sources" };

const SOURCES = [
  {
    name: "data.gov.in",
    href: "https://data.gov.in",
    use: "Today's mandi prices (resource 9ef84268-…) and variety-wise price history (35985678-…)",
    licence: "Government Open Data License – India",
  },
  {
    name: "Open-Meteo",
    href: "https://open-meteo.com",
    use: "Daily rain forecast from two models, ECMWF IFS 0.25° and GFS",
    licence: "CC BY 4.0. Weather data by Open-Meteo.com",
  },
  {
    name: "OSRM",
    href: "https://project-osrm.org",
    use: "Road distance and drive time from the village to each mandi",
    licence: "OpenStreetMap data, ODbL",
  },
  {
    name: "Nominatim",
    href: "https://nominatim.org",
    use: "Coordinates for villages and mandi towns",
    licence: "OpenStreetMap data, ODbL. At most 1 request a second, results cached",
  },
  {
    name: "OpenStreetMap tiles",
    href: "https://www.openstreetmap.org/copyright",
    use: "The map on each answer",
    licence: "ODbL, attribution on the map",
  },
  {
    name: "Sarvam AI",
    href: "https://www.sarvam.ai",
    use: "Speech to text in 22 Indian languages and English (saaras:v4); spoken replies in 9 (bulbul:v4-flash)",
    licence: "API terms",
  },
  {
    name: "OpenRouter",
    href: "https://openrouter.ai",
    use: "Language model access, for reading the question and phrasing the answer only",
    licence: "API terms",
  },
];

export default function Data() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-16">
      <h1 className="max-w-3xl font-display text-5xl leading-tight font-extrabold sm:text-6xl">Where every number comes from</h1>
      <p className="mt-5 max-w-2xl text-xl text-ink-700">
        No sample data, no placeholders. Each price, forecast and distance comes from a live public API, or from a stored
        copy of a real response kept with its source URL and fetch time. Answers show both.
      </p>

      <div className="glass mt-12 overflow-x-auto">
        <table className="w-full min-w-[42rem] text-left">
          <thead className="text-sm text-ink-500">
            <tr>
              <th className="px-5 py-3 font-normal">Source</th>
              <th className="px-5 py-3 font-normal">Used for</th>
              <th className="px-5 py-3 font-normal">Licence and terms</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((s) => (
              <tr key={s.name} className="border-t border-white align-top">
                <th className="px-5 py-4 font-semibold">
                  <a href={s.href} className="text-leaf-800 underline underline-offset-2" target="_blank" rel="noreferrer">
                    {s.name}
                  </a>
                </th>
                <td className="px-5 py-4 text-ink-700">{s.use}</td>
                <td className="px-5 py-4 text-ink-600">{s.licence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-20 grid gap-12 md:grid-cols-2">
        <div>
          <h2 className="font-display text-3xl font-bold">Mandi fee</h2>
          <p className="mt-3 text-lg text-ink-700">
            In Madhya Pradesh, under the Krishi Upaj Mandi Adhiniyam 1972, section 19(2), the buyer pays the market fee
            and it can&apos;t be deducted from the farmer&apos;s price, so the seller&apos;s fee is zero. Other states
            have their own rules, which we haven&apos;t verified, so there the answer says the fee isn&apos;t included. Hammali and weighing
            charges are set by each mandi committee, so the farmer enters them if they pay them; nothing is assumed.
          </p>
        </div>
        <div>
          <h2 className="font-display text-3xl font-bold">Vehicle rate</h2>
          <p className="mt-3 text-lg text-ink-700">
            There&apos;s no public source for local truck and tractor hire, so the agent asks the farmer for their rate
            per km and how many quintals one trip carries. Both can be edited on the answer to recalculate.
          </p>
        </div>
        <div>
          <h2 className="font-display text-3xl font-bold">When a source fails</h2>
          <p className="mt-3 text-lg text-ink-700">
            The agent falls back to the latest real stored data and states its age, or to the other weather model, and
            lowers its confidence. It never fills a gap with a made-up value.
          </p>
        </div>
        <div>
          <h2 className="font-display text-3xl font-bold">Privacy</h2>
          <p className="mt-3 text-lg text-ink-700">
            No login and no accounts. Questions and the agent&apos;s steps are logged to measure speed and reliability;
            IP addresses and identities are not stored.
          </p>
        </div>
      </section>
    </main>
  );
}
