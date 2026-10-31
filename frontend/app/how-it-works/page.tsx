"use client";

import Link from "next/link";
import { STEP_AI as AI, STEP_ICONS as ICONS } from "@/components/brand";
import FlowMap from "@/components/FlowMap";
import { useLang, type Dict } from "@/lib/i18n";

const RULE_ICONS = ["⏳", "⚖️", "📈", "🌾", "🗺️"];

function Badge({ ai, h }: { ai: boolean; h: Dict["how"] }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wide ${
        ai ? "bg-marigold-300/70 text-ink-900" : "bg-leaf-100 text-leaf-800"
      }`}
    >
      {ai ? h.legend_ai : h.legend_code}
    </span>
  );
}

// What the question looks like after each step, drawn differently per step.
function Output({ i, out }: { i: number; out: string[] }) {
  const chip = "rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-ink-800 shadow-sm";
  switch (i) {
    case 0:
      return (
        <div className="flex flex-wrap gap-2">
          {out.map((o, k) => (
            <span key={k} className={k === out.length - 1 ? `${chip} border border-dashed border-marigold-500 bg-marigold-300/30` : chip}>
              {o}
            </span>
          ))}
        </div>
      );
    case 1:
      return (
        <ul className="space-y-1.5">
          {out.map((o, k) => (
            <li key={k} className="flex items-center gap-2 text-ink-800">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-leaf-600 text-xs text-white">✓</span>
              {o}
            </li>
          ))}
        </ul>
      );
    case 2:
      return (
        <div className="grid grid-cols-3 gap-2 text-center">
          {out.map((o, k) => (
            <div key={k} className="rounded-xl bg-white p-2 shadow-sm">
              <div className="flow-pulse mx-auto mb-1 h-1.5 w-8 rounded-full bg-leaf-600" style={{ animationDelay: `${k * 0.3}s` }} />
              <span className="text-sm font-semibold text-ink-800">{o}</span>
            </div>
          ))}
        </div>
      );
    case 3:
      return (
        <ul className="space-y-1.5">
          {out.map((o, k) => (
            <li key={k} className="flex items-center gap-2 rounded-lg bg-white/80 px-3 py-1.5 text-sm">
              <span className="font-bold text-red-700">✕</span>
              <span className="text-ink-800">{o}</span>
            </li>
          ))}
        </ul>
      );
    case 4:
      return (
        <ul className="space-y-2">
          {[0, 2].map((k) => (
            <li key={k} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-lg bg-red-50 px-2.5 py-1 text-red-800 line-through decoration-red-400">{out[k]}</span>
              <span aria-hidden className="text-ink-500">→</span>
              <span className="rounded-lg bg-leaf-50 px-2.5 py-1 font-semibold text-leaf-800">{out[k + 1]}</span>
            </li>
          ))}
        </ul>
      );
    case 5:
      return (
        <div className="flex flex-wrap items-center gap-2 font-display text-lg font-bold">
          <span className={chip}>{out[0]}</span>
          <span aria-hidden>−</span>
          <span className={chip}>{out[1]}</span>
          <span aria-hidden>=</span>
          <span className="rounded-full bg-leaf-700 px-3 py-1.5 text-sm text-white shadow-sm">₹ {out[2]}</span>
        </div>
      );
    default:
      return (
        <div>
          <p className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-ink-900 px-4 py-2.5 text-white">
            <span aria-hidden className="flex items-end gap-0.5">
              {[3, 6, 4, 7, 3].map((hgt, k) => (
                <span key={k} className="flow-wave w-1 rounded-full bg-marigold-300" style={{ height: hgt * 2, animationDelay: `${k * 0.12}s` }} />
              ))}
            </span>
            {out[0]}
          </p>
          <p className="mt-2 flex items-center gap-2 text-sm text-leaf-800">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-leaf-600 text-xs text-white">✓</span>
            {out[1]}
          </p>
        </div>
      );
  }
}

export default function HowItWorks() {
  const { d } = useLang();
  const h = d.how;
  return (
    <main className="mx-auto max-w-6xl px-4 pt-16">
      {/* Intro: the question that travels down the page */}
      <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <h1 className="font-display text-5xl leading-tight font-extrabold sm:text-6xl">{h.title}</h1>
          <p className="mt-5 max-w-2xl text-xl text-ink-700">{h.sub}</p>
        </div>
        <figure className="glass-strong p-6 sm:p-8">
          <figcaption className="text-sm font-semibold text-ink-500">{h.ask_label}</figcaption>
          <p className="mt-3 rounded-3xl rounded-bl-md bg-ink-900 px-5 py-4 text-lg text-white">🎤 {h.question}</p>
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-700">
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-marigold-400" /> {h.legend_ai_long}
            </span>
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-leaf-600" /> {h.legend_code_long}
            </span>
          </div>
        </figure>
      </section>

      <FlowMap />

      {/* The journey: each step with what the question looks like afterwards */}
      <ol className="relative mt-12 space-y-6">
        <span
          aria-hidden
          className="absolute top-6 bottom-6 left-[1.4rem] w-1 rounded-full bg-gradient-to-b from-marigold-400 via-leaf-600 to-marigold-400 sm:left-[1.9rem]"
        />
        <span aria-hidden className="flow-dot absolute left-[1.4rem] h-4 w-4 -translate-x-1/2 rounded-full bg-marigold-400 ring-4 ring-white sm:left-[1.9rem]" style={{ marginLeft: 2 }} />
        {h.flow.map((s, i) => (
          <li key={i} id={`step-${i + 1}`} className="relative grid scroll-mt-24 grid-cols-[3rem_1fr] gap-3 sm:grid-cols-[4rem_1fr] sm:gap-5">
            <span
              className={`relative z-10 grid h-12 w-12 place-items-center rounded-full font-display text-xl font-extrabold ring-4 ring-white sm:h-16 sm:w-16 sm:text-2xl ${
                AI[i] ? "bg-gradient-to-br from-marigold-300 to-marigold-500 text-ink-900" : "bg-gradient-to-br from-leaf-600 to-leaf-800 text-white"
              }`}
            >
              {i + 1}
            </span>
            <div className="glass grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_1.05fr] lg:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <span aria-hidden className="text-2xl">
                    {ICONS[i]}
                  </span>
                  <h2 className="font-display text-2xl font-bold">{s.name}</h2>
                  <Badge ai={AI[i]} h={h} />
                </div>
                <p className="mt-2 text-lg text-ink-700">{s.plain}</p>
              </div>
              <div className="rounded-2xl border border-dashed border-ink-200 bg-ink-50/70 p-4">
                <p className="mb-2.5 text-xs font-semibold tracking-wide text-ink-500 uppercase">{h.out_label}</p>
                <Output i={i} out={s.out} />
              </div>
            </div>
          </li>
        ))}
      </ol>

      {/* The checks */}
      <section className="mt-24">
        <h2 className="max-w-3xl font-display text-4xl font-bold">{h.rules_title}</h2>
        <p className="mt-3 max-w-3xl text-lg text-ink-700">{h.rules_body}</p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {h.rules.map((r, i) => (
            <li key={i} className="glass p-5">
              <span aria-hidden className="text-3xl">
                {RULE_ICONS[i]}
              </span>
              <p className="mt-3 font-display text-xl font-bold">{r.k}</p>
              <p className="mt-1 text-ink-700">{r.v}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-20 grid gap-4 lg:grid-cols-2">
        <div className="glass p-6 sm:p-8">
          <span aria-hidden className="text-3xl">🎙️</span>
          <h2 className="mt-3 font-display text-3xl font-bold">{h.voice_title}</h2>
          <p className="mt-2 text-lg text-ink-700">{h.voice_body}</p>
        </div>
        <div className="glass p-6 sm:p-8">
          <span aria-hidden className="text-3xl">🔌</span>
          <h2 className="mt-3 font-display text-3xl font-bold">{h.switches_title}</h2>
          <p className="mt-2 text-lg text-ink-700">{h.switches_body}</p>
        </div>
      </section>

      <div className="mt-16">
        <Link href="/ask" className="btn-primary px-7 py-3.5 text-lg">
          {h.try_btn}
        </Link>
      </div>
    </main>
  );
}
