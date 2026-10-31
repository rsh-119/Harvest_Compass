import Link from "next/link";
import { Compass, NAV } from "./brand";

export default function SiteFooter() {
  return (
    <footer className="mt-24 px-4 pb-8">
      <div className="glass mx-auto grid max-w-6xl gap-8 p-6 sm:grid-cols-[1.4fr_1fr_1.4fr] sm:p-8">
        <div>
          <div className="flex items-center gap-2">
            <Compass />
            <span className="font-display text-lg font-bold">Harvest Compass</span>
          </div>
          <p className="mt-2 max-w-xs text-sm text-ink-600">
            कौन सी मंडी, कौन सा दिन। Built for soybean and onion farmers around Indore, Ujjain and Dewas. FORGE &apos;26.
          </p>
        </div>
        <ul className="space-y-1 text-sm">
          <li>
            <Link href="/ask" className="font-semibold text-leaf-800 hover:underline">
              Ask the agent
            </Link>
          </li>
          {NAV.map((n) => (
            <li key={n.href}>
              <Link href={n.href} className="text-ink-700 hover:underline">
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-xs leading-relaxed text-ink-500">
          Mandi prices: data.gov.in, Government Open Data License – India. Weather data by{" "}
          <a className="underline" href="https://open-meteo.com/">
            Open-Meteo.com
          </a>{" "}
          (
          <a className="underline" href="https://creativecommons.org/licenses/by/4.0/">
            CC BY 4.0
          </a>
          ). Roads, places and map ©{" "}
          <a className="underline" href="https://www.openstreetmap.org/copyright">
            OpenStreetMap contributors
          </a>{" "}
          (ODbL). Speech by Sarvam AI.
        </p>
      </div>
    </footer>
  );
}
