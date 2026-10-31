"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Compass, NAV } from "./brand";


export default function SiteHeader() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-[1100] px-4 pt-3">
      <nav
        className="glass mx-auto flex max-w-6xl items-center gap-2 rounded-full py-2 pr-2 pl-4 sm:gap-4 sm:pl-5"
        aria-label="Main"
      >
        <Link href="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
          <Compass />
          <span className="font-display text-lg font-bold whitespace-nowrap text-ink-900">Harvest Compass</span>
        </Link>
        <ul className="ml-auto hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <li key={n.href}>
              <Link
                href={n.href}
                aria-current={path === n.href ? "page" : undefined}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  path === n.href ? "bg-white/80 text-ink-900" : "text-ink-700 hover:bg-white/60"
                }`}
              >
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/ask" className="btn-primary ml-auto px-4 py-2 text-sm whitespace-nowrap md:ml-2" onClick={() => setOpen(false)}>
          पूछें<span className="hidden sm:inline"> · Ask</span>
        </Link>
        <button
          className="rounded-full p-2 text-ink-800 hover:bg-white/60 md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label="Menu"
          onClick={() => setOpen(!open)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </nav>
      {open && (
        <ul id="mobile-nav" className="glass mx-auto mt-2 max-w-6xl space-y-1 p-2 md:hidden">
          {NAV.map((n) => (
            <li key={n.href}>
              <Link
                href={n.href}
                onClick={() => setOpen(false)}
                className="block rounded-xl px-4 py-3 font-semibold text-ink-800 hover:bg-white/70"
              >
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}
