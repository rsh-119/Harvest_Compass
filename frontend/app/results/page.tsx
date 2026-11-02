"use client";

import BacktestCard from "@/components/BacktestCard";
import UsageStats from "@/components/UsageStats";
import { useLang } from "@/lib/i18n";

export default function Results() {
  const { d } = useLang();
  const r = d.results;
  return (
    <main className="mx-auto max-w-5xl px-4 pt-16">
      <h1 className="max-w-3xl font-display text-5xl leading-tight font-extrabold sm:text-6xl">{r.title}</h1>
      <p className="mt-5 max-w-2xl text-xl text-ink-700">{r.simple_sub}</p>

      <section className="mt-14">
        <h2 className="font-display text-3xl font-bold">{r.simple_bt_title}</h2>
        <p className="mt-2 max-w-3xl text-lg text-ink-700">{r.simple_bt_body}</p>
        <div className="mt-6">
          <BacktestCard />
        </div>
        <p className="mt-4 max-w-3xl text-ink-700">{r.simple_bt_why}</p>
      </section>

      <section className="mt-16">
        <h2 className="font-display text-3xl font-bold">{r.usage_title}</h2>
        <p className="mt-2 max-w-3xl text-lg text-ink-700">{r.simple_usage_body}</p>
        <div className="mt-6">
          <UsageStats />
        </div>
      </section>

      <section className="mt-16">
        <h2 className="font-display text-3xl font-bold">{r.simple_limits_title}</h2>
        <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-6 text-lg text-ink-700">
          {r.simple_limits.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
