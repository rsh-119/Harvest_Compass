"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Health = { status: string; sources: Record<string, boolean>; llm_model: string };

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/health`)
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setError("सर्वर से संपर्क नहीं हो पाया (backend unreachable)"));
  }, []);

  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="text-2xl font-bold">हार्वेस्ट कम्पास</h1>
      <p className="text-gray-600">कौन सी मंडी, कौन सा दिन — Harvest Compass</p>
      <section className="mt-6">
        <h2 className="font-semibold">स्रोत स्थिति (Source health)</h2>
        {error && <p className="text-red-600">{error}</p>}
        {!health && !error && <p>जाँच हो रही है…</p>}
        {health && (
          <ul className="mt-2">
            {Object.entries(health.sources).map(([name, ok]) => (
              <li key={name}>
                {ok ? "✅" : "❌"} {name}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
