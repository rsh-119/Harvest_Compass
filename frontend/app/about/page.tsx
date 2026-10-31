"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n";

// Fill in to show the team section.
const TEAM: { name: string; role: string }[] = [];

export default function About() {
  const { d } = useLang();
  const a = d.about;
  return (
    <main className="mx-auto max-w-6xl px-4 pt-16">
      <h1 className="max-w-3xl font-display text-5xl leading-tight font-extrabold sm:text-6xl">{a.title}</h1>
      <div className="mt-8 grid max-w-5xl gap-8 text-lg text-ink-700 md:grid-cols-2">
        <p>{a.p1}</p>
        <p>{a.p2}</p>
      </div>

      {TEAM.length > 0 && (
        <section className="mt-20">
          <h2 className="font-display text-3xl font-bold">{a.team_title}</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TEAM.map((t) => (
              <li key={t.name} className="glass p-5">
                <p className="font-display text-xl font-bold">{t.name}</p>
                <p className="text-ink-600">{t.role}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-20">
        <h2 className="font-display text-3xl font-bold">{a.next_title}</h2>
        <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-6 text-lg text-ink-700">
          {a.next.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </section>

      <section className="mt-20">
        <h2 className="font-display text-3xl font-bold">{a.os_title}</h2>
        <p className="mt-3 max-w-3xl text-lg text-ink-700">
          {a.os_body}{" "}
          <a className="font-semibold text-leaf-800 underline" href="https://github.com/rsh-119/Harvest_Compass">
            GitHub
          </a>
        </p>
        <Link href="/ask" className="btn-primary mt-8 px-7 py-3.5 text-lg">
          {a.os_btn}
        </Link>
      </section>
    </main>
  );
}
