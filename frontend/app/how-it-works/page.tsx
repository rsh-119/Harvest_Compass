"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n";

export default function HowItWorks() {
  const { d } = useLang();
  const h = d.how;
  return (
    <main className="mx-auto max-w-6xl px-4 pt-16">
      <h1 className="max-w-3xl font-display text-5xl leading-tight font-extrabold sm:text-6xl">{h.title}</h1>
      <p className="mt-5 max-w-2xl text-xl text-ink-700">{h.sub}</p>

      <ol className="mt-14 space-y-4">
        {h.loop.map((s, i) => (
          <li key={i} className="glass grid gap-2 p-5 sm:grid-cols-[3rem_12rem_1fr] sm:items-baseline sm:gap-6 sm:p-6">
            <span className="font-display text-3xl font-extrabold text-marigold-600">{i + 1}</span>
            <h2 className="font-display text-2xl font-bold">{s.name}</h2>
            <p className="text-lg text-ink-700">{s.body}</p>
          </li>
        ))}
      </ol>

      <section className="mt-24 grid gap-10 lg:grid-cols-[1fr_1.3fr]">
        <div>
          <h2 className="font-display text-4xl font-bold">{h.rules_title}</h2>
          <p className="mt-3 text-lg text-ink-700">{h.rules_body}</p>
        </div>
        <table className="glass w-full overflow-hidden text-left">
          <tbody>
            {h.rules.map((r, i) => (
              <tr key={i} className="border-b border-white last:border-0">
                <th className="px-5 py-3 align-top font-semibold whitespace-nowrap">{r.k}</th>
                <td className="px-5 py-3 text-ink-700">{r.v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-24 grid gap-10 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-4xl font-bold">{h.switches_title}</h2>
          <p className="mt-3 text-lg text-ink-700">{h.switches_body}</p>
        </div>
        <div>
          <h2 className="font-display text-4xl font-bold">{h.voice_title}</h2>
          <p className="mt-3 text-lg text-ink-700">{h.voice_body}</p>
        </div>
      </section>

      <div className="mt-20">
        <Link href="/ask" className="btn-primary px-7 py-3.5 text-lg">
          {h.try_btn}
        </Link>
      </div>
    </main>
  );
}
