import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "About" };

// Fill in to show the team section.
const TEAM: { name: string; role: string }[] = [];

const NEXT = [
  "Real transport quotes per district, so first answers need one question fewer",
  "More crops and more states, chosen by how many mandis report each day",
  "An SMS or phone-call channel for farmers without smartphones",
  "Mandi arrival volumes, to warn when a glut is likely to push prices down",
  "A per-district village list for better speech matching",
];

export default function About() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-16">
      <h1 className="max-w-3xl font-display text-5xl leading-tight font-extrabold sm:text-6xl">
        Public data, put to work for the person who grows the crop.
      </h1>
      <div className="mt-8 grid max-w-5xl gap-8 text-lg text-ink-700 md:grid-cols-2">
        <p>
          India publishes daily prices from mandis across the country, and global weather models are free to use. But this data
          is scattered, in English, unchecked, and shaped for analysts. A farmer with 40 quintals still decides with a
          phone call to a trader.
        </p>
        <p>
          Harvest Compass brings that data to one question asked in the farmer&apos;s own language, checks it before trusting it, and shows its
          working. It covers soybean and onion for any village in India, using the mandis that report in the farmer&apos;s
          state. Built for FORGE &apos;26.
        </p>
      </div>

      {TEAM.length > 0 && (
        <section className="mt-20">
          <h2 className="font-display text-3xl font-bold">Team</h2>
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
        <h2 className="font-display text-3xl font-bold">What&apos;s next</h2>
        <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-6 text-lg text-ink-700">
          {NEXT.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>

      <section className="mt-20">
        <h2 className="font-display text-3xl font-bold">Open source</h2>
        <p className="mt-3 max-w-3xl text-lg text-ink-700">
          The code, the build log and every data-source note are public on{" "}
          <a className="font-semibold text-leaf-800 underline" href="https://github.com/rsh-119/Harvest_Compass">
            GitHub
          </a>
          .
        </p>
        <Link href="/ask" className="btn-primary mt-8 px-7 py-3.5 text-lg">
          Ask a question
        </Link>
      </section>
    </main>
  );
}
