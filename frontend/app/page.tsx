"use client";

import Link from "next/link";
import LiveNumbers from "@/components/LiveNumbers";
import { useLang } from "@/lib/i18n";

// Real lines from the agent's log, run on 31 Oct 2026 for 40 q soybean near Ujjain. Quoted as
// logged (English), in every language.
const AUDIT_LINES = [
  "Badnagar APMC: Price is 25 days old (limit 3)",
  "Badnagar APMC: Modal 5985 is far from usual (median 6900); treated as suspect",
  "Maksi APMC: Yellow/FAQ is not directly comparable with Soyabeen/FAQ",
  "Chhapiheda APMC: Could not find Chhapiheda APMC on the map; excluded",
];

export default function Home() {
  const { d } = useLang();
  const h = d.home;
  return (
    <main className="px-4">
      <section className="mx-auto grid max-w-6xl items-center gap-12 pt-14 pb-20 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
        <div>
          <h1 className="font-display text-6xl leading-[1.05] font-extrabold text-ink-900 sm:text-7xl">
            {h.hero_l1}
            <br />
            {h.hero_l2}
          </h1>
          <p className="mt-6 max-w-xl text-xl leading-relaxed text-ink-700">{h.hero_sub}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/ask" className="btn-primary px-7 py-3.5 text-lg">
              {h.cta_ask}
            </Link>
            <Link href="/how-it-works" className="btn-ghost px-7 py-3.5 text-lg">
              {h.cta_how}
            </Link>
          </div>
        </div>

        <figure className="glass-strong p-5 sm:p-7" aria-label={h.figure_label}>
          <p className="ml-auto max-w-[85%] rounded-3xl rounded-br-md bg-ink-900 px-5 py-3 text-lg text-white">
            {h.demo_question}
          </p>
          <ol className="mt-6 space-y-2.5">
            {h.steps.map((s, i) => (
              <li key={i} className="step-reveal flex items-start gap-3" style={{ animationDelay: `${0.25 + i * 0.35}s` }}>
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-marigold-300 to-leaf-600 text-sm font-bold text-white">
                  {i + 1}
                </span>
                <span>
                  <span className="block font-semibold text-ink-900">{s.t}</span>
                  <span className="block text-sm text-ink-600">{s.d}</span>
                </span>
              </li>
            ))}
          </ol>
          <figcaption className="mt-5 border-t border-white pt-4 text-sm text-ink-600">{h.figcaption}</figcaption>
        </figure>
      </section>

      <section className="mx-auto max-w-4xl py-10">
        <h2 className="font-display text-4xl font-bold sm:text-5xl">{h.video_title}</h2>
        <p className="mt-4 max-w-2xl text-lg text-ink-700">{h.video_sub}</p>
        <video
          src="/demo.mp4"
          controls
          playsInline
          preload="metadata"
          aria-label={h.video_title}
          className="glass-strong mt-6 aspect-video w-full rounded-3xl"
        />
      </section>

      <section className="mx-auto max-w-6xl py-16">
        <h2 className="max-w-3xl font-display text-4xl leading-tight font-bold sm:text-5xl">{h.problem_title}</h2>
        <div className="mt-8 grid max-w-5xl gap-8 text-lg text-ink-700 sm:grid-cols-3">
          {h.problems.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl py-16">
        <h2 className="font-display text-4xl font-bold sm:text-5xl">{h.gets_title}</h2>
        <dl className="mt-10 grid gap-x-12 gap-y-10 md:grid-cols-2">
          {h.gets.map((g, i) => (
            <div key={i}>
              <dt className="font-display text-2xl font-bold text-ink-900">{g.t}</dt>
              <dd className="mt-2 text-lg text-ink-700">{g.d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mx-auto grid max-w-6xl items-center gap-10 py-16 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-4xl font-bold sm:text-5xl">{h.audit_title}</h2>
          <p className="mt-4 text-lg text-ink-700">{h.audit_body}</p>
          <Link href="/how-it-works" className="mt-6 inline-block font-semibold text-leaf-800 underline underline-offset-4">
            {h.audit_link}
          </Link>
        </div>
        <figure className="glass p-5">
          <ul className="space-y-2 text-sm" lang="en">
            {AUDIT_LINES.map((l) => (
              <li key={l} className="rounded-xl bg-white/70 px-3 py-2 text-ink-800">
                {l}
              </li>
            ))}
          </ul>
          <figcaption className="mt-3 text-xs text-ink-500">{h.audit_caption}</figcaption>
        </figure>
      </section>

      <section className="mx-auto max-w-6xl py-16">
        <h2 className="font-display text-4xl font-bold sm:text-5xl">{h.measured_title}</h2>
        <p className="mt-4 max-w-3xl text-lg text-ink-700">{h.measured_body}</p>
        <div className="mt-8">
          <LiveNumbers />
        </div>
        <p className="mt-4 text-sm text-ink-600">
          <Link href="/results" className="font-semibold text-leaf-800 underline">
            {h.measured_link}
          </Link>
        </p>
      </section>

      <section className="mx-auto max-w-6xl py-10">
        <p className="text-sm text-ink-600">{h.sources_intro}</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {h.sources.map((s, i) => (
            <li key={i} className="glass rounded-full px-4 py-2 text-sm font-semibold text-ink-800">
              {s}
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-6xl py-16">
        <div className="glass-strong flex flex-col items-start gap-6 p-8 sm:flex-row sm:items-center sm:justify-between sm:p-12">
          <div>
            <h2 className="font-display text-4xl font-bold">{h.cta_title}</h2>
            <p className="mt-2 text-lg text-ink-700">{h.cta_body}</p>
          </div>
          <Link href="/ask" className="btn-primary shrink-0 px-8 py-4 text-lg">
            {h.cta_btn}
          </Link>
        </div>
      </section>
    </main>
  );
}
