"use client";

import { useLang } from "@/lib/i18n";

// Names and links stay as they are; what each is used for comes from the language files.
const SOURCES = [
  { name: "data.gov.in", href: "https://data.gov.in" },
  { name: "Open-Meteo", href: "https://open-meteo.com" },
  { name: "OSRM", href: "https://project-osrm.org" },
  { name: "Nominatim", href: "https://nominatim.org" },
  { name: "OpenStreetMap tiles", href: "https://www.openstreetmap.org/copyright" },
  { name: "Sarvam AI", href: "https://www.sarvam.ai" },
  { name: "OpenRouter", href: "https://openrouter.ai" },
];

export default function Data() {
  const { d } = useLang();
  const t = d.data;
  return (
    <main className="mx-auto max-w-6xl px-4 pt-16">
      <h1 className="max-w-3xl font-display text-5xl leading-tight font-extrabold sm:text-6xl">{t.title}</h1>
      <p className="mt-5 max-w-2xl text-xl text-ink-700">{t.sub}</p>

      <div className="glass mt-12 overflow-x-auto">
        <table className="w-full min-w-[42rem] text-left">
          <thead className="text-sm text-ink-500">
            <tr>
              <th className="px-5 py-3 font-normal">{t.cols.source}</th>
              <th className="px-5 py-3 font-normal">{t.cols.use}</th>
              <th className="px-5 py-3 font-normal">{t.cols.licence}</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((s, i) => (
              <tr key={s.name} className="border-t border-white align-top">
                <th className="px-5 py-4 font-semibold">
                  <a href={s.href} className="text-leaf-800 underline underline-offset-2" target="_blank" rel="noreferrer">
                    {s.name}
                  </a>
                </th>
                <td className="px-5 py-4 text-ink-700">{t.sources[i].use}</td>
                <td className="px-5 py-4 text-ink-600">{t.sources[i].licence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-20 grid gap-12 md:grid-cols-2">
        {[
          [t.fee_title, t.fee_body],
          [t.vehicle_title, t.vehicle_body],
          [t.fail_title, t.fail_body],
          [t.privacy_title, t.privacy_body],
        ].map(([title, body]) => (
          <div key={title}>
            <h2 className="font-display text-3xl font-bold">{title}</h2>
            <p className="mt-3 text-lg text-ink-700">{body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
