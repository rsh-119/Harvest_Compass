// Talks to the FastAPI backend. Types mirror backend/app/agent/nodes/compute.py.

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Place = { name: string; display_name: string; lat: number; lon: number };
// Vehicle hire has no default: the agent asks the farmer (see understand.py).
export type Params = { rate_per_km?: number; capacity_q?: number; other_charges_per_q: number; bori_kg?: number; qty_confirmed?: boolean };

export type TraceEvent = {
  event: string;
  en: string;
  hi: string;
  t?: number;
  status?: string;
  source_url?: string;
  fetched_at?: string | null;
  ms?: number;
  [k: string]: unknown;
};

export type MandiRow = {
  market: string;
  district: string;
  variety: string;
  modal_price: number;
  price_used: number; // 7-day median of this mandi's modal (3+ reports), else the latest modal
  price_days: number;
  min_price: number;
  max_price: number;
  arrival_date: string;
  age_days: number;
  price_source: string;
  road_km: number;
  drive_min: number;
  lat: number | null;
  lon: number | null;
  trips: number;
  transport_total: number;
  mandi_charges: number;
  net_per_quintal: number;
  net_total: number;
  conservative_net_per_quintal: number | null;
  info: string[];
};

export type Source = { url: string; status: string; fetched_at: string | null; attribution?: string };

export type Result = {
  crop: string;
  quantity_q: number;
  best: MandiRow | null;
  runner_up?: MandiRow;
  runner_up_gap?: { net_per_quintal: number; price: number; transport_per_quintal: number };
  nearer_pick?: { skipped: string; extra_per_quintal: number; extra_km: number };
  ranking: MandiRow[];
  excluded: { market: string; district: string; reasons: string[]; reasons_hi: string[] }[];
  radius_km: number;
  notes: string[];
  costs: { rate_per_km: number; capacity_q: number; other_charges_per_q: number; seller_fee_rate: number };
  trend_per_day?: number | null;
  harvest_days?: { day: string; both_dry: boolean; uncertain: boolean; reasons: string[] }[];
  beyond_forecast?: string[];
  wait?: { days: number; trend_change_per_quintal: number | null; max_rain_risk: number | null; label: string };
  confidence?: "high" | "medium" | "low";
  confidence_reasons?: string[];
  sources?: { prices_today: Source | null; weather: Source | null; routing: string; history: string };
};

export type Clarify = {
  hi: string;
  en: string;
  intent: Record<string, unknown>;
  options?: Place[];
  place?: Place; // already-confirmed village, sent back with the answer
  needs?: string;
  unsupported?: boolean;
};

export type Final = {
  event: "final";
  clarify: Clarify | null;
  answer: string | null;
  result: Result | null;
  intent: Record<string, unknown> | null;
  place: Place | null;
};

export type AskBody = {
  text: string;
  previous?: Record<string, unknown> | null;
  question?: string;
  place?: Place | null;
  params?: Params;
  faults?: string[];
  speak?: boolean;
};

export type Health = {
  status: "ok" | "degraded";
  sources: Record<string, { ok: boolean; ms?: number; error?: string; note?: string }>;
  test_switches: Record<string, string>;
};

export type Stats = {
  days?: number;
  requests: number;
  p50_ms?: number;
  p95_ms?: number;
  fallback_rate?: number;
  errors?: number;
  invented_numbers?: number;
};

export async function stats(): Promise<Stats> {
  const res = await fetch(`${API}/stats`);
  if (!res.ok) throw new Error(`stats ${res.status}`);
  return res.json();
}

/** Also wakes a sleeping free-tier backend. */
export async function health(): Promise<Health> {
  const res = await fetch(`${API}/health`);
  if (!res.ok) throw new Error(`health ${res.status}`);
  return res.json();
}

/** POST /ask and read the SSE stream (EventSource can't POST, so we parse it ourselves). */
export async function ask(body: AskBody, onEvent: (e: TraceEvent | Final) => void): Promise<void> {
  const res = await fetch(`${API}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new Error((await res.json()).detail);
  if (!res.ok || !res.body) throw new Error(`server returned ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const p of parts) if (p.startsWith("data: ")) onEvent(JSON.parse(p.slice(6)));
  }
}

export async function transcribe(audio: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", audio, "speech.webm");
  const res = await fetch(`${API}/transcribe`, { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? `error ${res.status}`);
  return (await res.json()).text;
}
