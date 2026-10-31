"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import {
  ask,
  transcribe,
  type AskBody,
  type Clarify,
  type Final,
  type MandiRow,
  type Params,
  type Place,
  type Result,
  type TraceEvent,
} from "@/lib/api";

const MandiMap = dynamic(() => import("@/components/MandiMap"), { ssr: false });

// Must match the backend defaults (config.py); the farmer edits them below the answer.
const DEFAULT_PARAMS: Params = { rate_per_km: 30, capacity_q: 25, other_charges_per_q: 0 };

const EXAMPLES = [
  "मेरे पास 40 क्विंटल सोयाबीन है, गाँव सांवेर, इंदौर। फसल 2 से 5 नवंबर के बीच तैयार होगी। कहाँ बेचूँ?",
  "30 क्विंटल प्याज़ है, गाँव महू, इंदौर। रखने की जगह है, 5 दिन रुकूँ या अभी बेचूँ?",
];

const rupee = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const hiDay = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("hi-IN", { weekday: "short", day: "numeric", month: "long" });
const hiTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("hi-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—";
const distance = (m: MandiRow) => (m.road_km < 1 ? "उसी कस्बे में (same town)" : `${m.road_km} km सड़क से`);

const EVENT_ICON: Record<string, string> = {
  understand: "👂",
  clarify: "❓",
  plan: "🧭",
  tool_call: "📡",
  tool_result: "📥",
  audit_reject: "🚫",
  audit_flag: "⚠️",
  repair: "🔧",
  compute: "🧮",
  decision: "✅",
  explain: "🗣️",
  error: "❌",
};
const STATUS_HI: Record<string, string> = { live: "लाइव", cache: "कैश", stale_cache: "पुराना कैश", error: "विफल" };
const CONF_HI = { high: "भरोसा: ऊँचा", medium: "भरोसा: मध्यम", low: "भरोसा: कम" };
const CONF_CLS = {
  high: "bg-leaf-100 text-leaf-800",
  medium: "bg-amber-100 text-amber-900",
  low: "bg-red-100 text-red-800",
};

export default function Home() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [final, setFinal] = useState<Final | null>(null);
  const [pending, setPending] = useState<Clarify | null>(null); // question we're waiting on
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const lastText = useRef("");

  async function run(body: AskBody) {
    setBusy(true);
    setError(null);
    setTrace([]);
    try {
      await ask({ ...body, params: { ...params, ...body.params } }, (e) => {
        if (e.event === "final") {
          const f = e as Final;
          setFinal(f);
          setPending(f.clarify);
        } else {
          setTrace((t) => [...t, e as TraceEvent]);
          if (e.event === "error") setError((e as TraceEvent).hi || (e as TraceEvent).en);
        }
      });
    } catch {
      setError("सर्वर से संपर्क नहीं हो पाया। थोड़ी देर बाद फिर कोशिश करें। (backend unreachable)");
    } finally {
      setBusy(false);
    }
  }

  function submit(t = text) {
    const q = t.trim();
    if (!q || busy) return;
    const body: AskBody = { text: q };
    if (pending && !pending.unsupported) {
      // Answering our question: carry the intent forward instead of starting over.
      body.previous = pending.intent;
      const kg = parseFloat(q.replace(/[^\d.]/g, ""));
      if (pending.needs === "bori_kg" && kg > 0) body.params = { ...params, bori_kg: kg };
    } else {
      lastText.current = q;
    }
    setText("");
    run(body);
  }

  function confirmPlace(p: Place) {
    run({ text: lastText.current, previous: pending?.intent, place: p });
  }

  function recalc() {
    if (!final?.intent || !final.place) return;
    run({ text: lastText.current, previous: final.intent, place: final.place });
  }

  async function toggleMic() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setRecording(false);
        try {
          const said = await transcribe(new Blob(chunks, { type: rec.mimeType }));
          setText(said);
          submit(said);
        } catch {
          setError("आवाज़ समझ नहीं आई। कृपया फिर बोलें या लिखें। (speech-to-text failed)");
        }
      };
      rec.start();
      recorder.current = rec;
      setRecording(true);
      setTimeout(() => rec.state === "recording" && rec.stop(), 25_000); // Sarvam REST limit ~30 s
    } catch {
      setError("माइक की अनुमति नहीं मिली। आप लिखकर पूछ सकते हैं। (mic permission denied)");
    }
  }

  const r = final?.result;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <header>
        <h1 className="text-3xl font-bold text-leaf-800">हार्वेस्ट कम्पास</h1>
        <p className="mt-1 text-lg text-ink-600">कौन सी मंडी, कौन सा दिन — लाइव भाव और मौसम से</p>
      </header>

      <section className="mt-6 rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
        {pending && (
          <div className="mb-3 rounded-xl bg-amber-50 p-3 text-amber-950" role="status">
            <p className="text-lg font-semibold">{pending.hi}</p>
            {pending.options && (
              <div className="mt-2 flex flex-wrap gap-2">
                {pending.options.map((p) => (
                  <button
                    key={p.display_name}
                    onClick={() => confirmPlace(p)}
                    disabled={busy}
                    className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-left text-sm hover:bg-amber-100"
                  >
                    हाँ, {p.name}
                    <span className="block text-xs text-ink-500">{p.display_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <label htmlFor="q" className="text-sm font-medium text-ink-600">
          {pending ? "जवाब लिखें या बोलें" : "अपनी फसल के बारे में पूछें — बोलकर या लिखकर"}
        </label>
        <textarea
          id="q"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), submit())}
          rows={3}
          placeholder="जैसे: 40 क्विंटल सोयाबीन है, गाँव सांवेर, इंदौर…"
          className="mt-1 w-full resize-none rounded-xl border border-ink-200 p-3 text-lg focus:border-leaf-600 focus:outline-none"
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={toggleMic}
            disabled={busy && !recording}
            aria-pressed={recording}
            className={`flex-1 rounded-xl px-4 py-3 text-lg font-semibold text-white ${
              recording ? "animate-pulse bg-red-600" : "bg-ink-800 hover:bg-ink-700"
            } disabled:opacity-50`}
          >
            {recording ? "⏹ रोकें" : "🎤 बोलें"}
          </button>
          <button
            onClick={() => submit()}
            disabled={busy || !text.trim()}
            className="flex-1 rounded-xl bg-leaf-700 px-4 py-3 text-lg font-semibold text-white hover:bg-leaf-800 disabled:opacity-50"
          >
            {busy ? "सोच रहा हूँ…" : "पूछें"}
          </button>
        </div>
        {!final && !busy && (
          <div className="mt-3 space-y-1">
            <p className="text-xs text-ink-500">उदाहरण (टैप करें):</p>
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => setText(ex)} className="block text-left text-sm text-leaf-800 underline-offset-2 hover:underline">
                {ex}
              </button>
            ))}
          </div>
        )}
        {error && <p className="mt-3 rounded-lg bg-red-50 p-2 text-red-800">{error}</p>}
      </section>

      {trace.length > 0 && <Trace events={trace} busy={busy} />}

      {final?.answer && r && (
        <section className="mt-6 rounded-2xl border-2 border-leaf-600 bg-leaf-50 p-4" aria-live="polite">
          <p className="text-xl leading-relaxed text-ink-900">{final.answer}</p>
          {r.confidence && (
            <p className="mt-3">
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${CONF_CLS[r.confidence]}`}>
                {CONF_HI[r.confidence]}
              </span>
              {r.confidence_reasons?.length ? (
                <span className="ml-2 text-sm text-ink-600">({r.confidence_reasons.join("; ")})</span>
              ) : null}
            </p>
          )}
        </section>
      )}

      {r?.best && final?.place && (
        <ResultCard r={r} place={final.place} params={params} setParams={setParams} recalc={recalc} busy={busy} />
      )}
    </main>
  );
}

function Trace({ events, busy }: { events: TraceEvent[]; busy: boolean }) {
  return (
    <section className="mt-6 rounded-2xl border border-ink-200 bg-white p-4">
      <h2 className="font-semibold text-ink-800">
        एजेंट क्या कर रहा है <span className="text-sm font-normal text-ink-500">(live trace)</span>
        {busy && <span className="ml-2 inline-block h-2 w-2 animate-ping rounded-full bg-leaf-600" />}
      </h2>
      <ol className="mt-2 max-h-80 space-y-1 overflow-y-auto text-sm">
        {events.map((e, i) => (
          <li
            key={i}
            className={`flex gap-2 rounded-lg px-2 py-1 ${
              e.event === "repair" ? "bg-amber-50" : e.event === "audit_reject" ? "bg-red-50" : ""
            }`}
          >
            <span aria-hidden>{EVENT_ICON[e.event] ?? "•"}</span>
            <span className="min-w-0">
              {e.hi && e.hi !== e.en && <span className="block text-ink-800">{e.hi}</span>}
              <span className="block break-words text-ink-500">{e.en}</span>
              {e.status && (
                <span className="text-xs text-ink-500">
                  {STATUS_HI[e.status] ?? e.status}
                  {e.ms != null && ` · ${(e.ms / 1000).toFixed(1)} s`}
                  {e.fetched_at && ` · ${hiTime(e.fetched_at)}`}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ResultCard({
  r,
  place,
  params,
  setParams,
  recalc,
  busy,
}: {
  r: Result;
  place: Place;
  params: Params;
  setParams: (p: Params) => void;
  recalc: () => void;
  busy: boolean;
}) {
  const b = r.best!;
  return (
    <>
      <section className="mt-6 rounded-2xl border border-ink-200 bg-white p-4">
        <p className="text-sm text-ink-500">सबसे अच्छी मंडी</p>
        <h2 className="text-2xl font-bold text-leaf-800">{b.market}</h2>
        <p className="text-ink-600">
          {b.district} · {distance(b)}
          {b.road_km >= 1 && ` · लगभग ${Math.round(b.drive_min)} मिनट`}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="शुद्ध भाव / क्विंटल" value={rupee(b.net_per_quintal)} strong />
          <Stat label={`कुल शुद्ध (${r.quantity_q} क्विं.)`} value={rupee(b.net_total)} />
          <Stat
            label="बुरे दिन का भाव / क्विं."
            value={b.conservative_net_per_quintal == null ? "इतिहास कम" : rupee(b.conservative_net_per_quintal)}
          />
        </dl>
        <p className="mt-2 text-xs text-ink-500">
          मॉडल भाव {rupee(b.modal_price)} ({b.variety}) · भाव की तारीख {hiDay(b.arrival_date)}
          {b.age_days > 0 && ` (${b.age_days} दिन पुराना)`}
        </p>
        {r.runner_up && r.runner_up_gap && (
          <p className="mt-3 text-sm text-ink-700">
            दूसरे नंबर पर <b>{r.runner_up.market}</b>:{" "}
            {r.runner_up_gap.price > 0
              ? `भाव ${rupee(r.runner_up_gap.price)} कम`
              : `भाव ${rupee(-r.runner_up_gap.price)} ज़्यादा, पर भाड़ा ${rupee(r.runner_up_gap.transport_per_quintal)}/क्विं. ज़्यादा`}
            {" "}— कुल मिलाकर {rupee(r.runner_up_gap.net_per_quintal)}/क्विं. कम।
          </p>
        )}
      </section>

      {(r.harvest_days?.length || r.wait) && (
        <section className="mt-4 rounded-2xl border border-ink-200 bg-white p-4">
          {r.harvest_days && r.harvest_days.length > 0 && (
            <>
              <h3 className="font-semibold text-ink-800">कटाई / ढुलाई के लिए सुरक्षित दिन</h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {r.harvest_days.map((d) => (
                  <li
                    key={d.day}
                    className={`rounded-lg px-3 py-2 text-sm ${d.both_dry && !d.uncertain ? "bg-leaf-100 text-leaf-900" : "bg-amber-50 text-amber-900"}`}
                    title={d.reasons.join("; ")}
                  >
                    {hiDay(d.day)} {d.both_dry ? "☀️ सूखा" : "🌧 बारिश संभव"}
                    {d.uncertain && " · अनिश्चित"}
                  </li>
                ))}
              </ul>
              {r.beyond_forecast && r.beyond_forecast.length > 0 && (
                <p className="mt-2 text-xs text-ink-500">
                  {r.beyond_forecast.map(hiDay).join(", ")}: पूर्वानुमान अभी उपलब्ध नहीं (7 दिन से आगे)
                </p>
              )}
            </>
          )}
          {r.wait && (
            <p className="mt-3 text-sm text-ink-700">
              <b>{r.wait.days} दिन रुकें तो?</b>{" "}
              {r.wait.trend_change_per_quintal == null
                ? "भाव का रुझान निकालने लायक इतिहास नहीं।"
                : `पिछले 14 दिन के रुझान से भाव लगभग ${r.wait.trend_change_per_quintal >= 0 ? "+" : ""}${rupee(r.wait.trend_change_per_quintal)}/क्विं.`}
              {r.wait.max_rain_risk != null && ` · बारिश का जोखिम ${Math.round(r.wait.max_rain_risk * 100)}%`}
              <span className="block text-xs text-ink-500">यह रुझान है, पूर्वानुमान नहीं (trend, not forecast)</span>
            </p>
          )}
        </section>
      )}

      <section className="mt-4 rounded-2xl border border-ink-200 bg-white p-4">
        <h3 className="mb-2 font-semibold text-ink-800">नक्शा</h3>
        <MandiMap origin={place} mandis={r.ranking.slice(0, 5)} />
      </section>

      <section className="mt-4 rounded-2xl border border-ink-200 bg-white p-4">
        <h3 className="font-semibold text-ink-800">मंडियों की तुलना</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-500">
              <tr>
                <th className="py-1 pr-2">#</th>
                <th className="pr-2">मंडी</th>
                <th className="pr-2 text-right">भाव</th>
                <th className="pr-2 text-right">दूरी</th>
                <th className="pr-2 text-right">भाड़ा</th>
                <th className="text-right">शुद्ध/क्विं.</th>
              </tr>
            </thead>
            <tbody>
              {r.ranking.map((m, i) => (
                <tr key={m.market + m.district} className="border-t border-ink-100">
                  <td className="py-1 pr-2">{i + 1}</td>
                  <td className="pr-2">
                    {m.market}
                    {m.age_days > 0 && <span className="text-xs text-ink-500"> ({m.age_days}d)</span>}
                  </td>
                  <td className="pr-2 text-right">{rupee(m.modal_price)}</td>
                  <td className="pr-2 text-right">{m.road_km < 1 ? "उसी कस्बे" : `${Math.round(m.road_km)} km`}</td>
                  <td className="pr-2 text-right">{rupee(m.transport_total)}</td>
                  <td className="text-right font-semibold">{rupee(m.net_per_quintal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-ink-200 bg-white p-4">
        <h3 className="font-semibold text-ink-800">खर्च का हिसाब ({b.market})</h3>
        <ul className="mt-2 space-y-1 text-sm text-ink-700">
          <li>
            भाव: {rupee(b.modal_price)} × {r.quantity_q} क्विं. = {rupee(b.modal_price * r.quantity_q)}
          </li>
          <li>
            भाड़ा: {b.trips} चक्कर × 2 (आना-जाना) × {b.road_km} km × {rupee(r.costs.rate_per_km)}/km = −
            {rupee(b.transport_total)}
          </li>
          <li>
            अन्य खर्च (हम्माली/तुलाई): {rupee(r.costs.other_charges_per_q)}/क्विं. = −{rupee(b.mandi_charges)}
          </li>
          <li className="text-xs text-ink-500">
            मंडी शुल्क खरीदार देता है, किसान से नहीं कटता (म.प्र. कृषि उपज मंडी अधिनियम 1972, धारा 19(2))।
          </li>
          <li className="font-semibold">शुद्ध: {rupee(b.net_total)}</li>
        </ul>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <NumField label="भाड़ा ₹/km" value={params.rate_per_km} onChange={(v) => setParams({ ...params, rate_per_km: v })} />
          <NumField label="गाड़ी में क्विंटल" value={params.capacity_q} onChange={(v) => setParams({ ...params, capacity_q: v })} />
          <NumField
            label="अन्य खर्च ₹/क्विं."
            value={params.other_charges_per_q}
            min={0}
            onChange={(v) => setParams({ ...params, other_charges_per_q: v })}
          />
        </div>
        <button
          onClick={recalc}
          disabled={busy}
          className="mt-3 rounded-xl bg-ink-800 px-4 py-2 font-semibold text-white hover:bg-ink-700 disabled:opacity-50"
        >
          दोबारा हिसाब करें
        </button>
        {r.notes.length > 0 && <p className="mt-2 text-xs text-ink-500">{r.notes.join(" · ")}</p>}
      </section>

      {r.excluded.length > 0 && (
        <details className="mt-4 rounded-2xl border border-ink-200 bg-white p-4">
          <summary className="cursor-pointer font-semibold text-ink-800">
            छोड़ी गई मंडियाँ ({r.excluded.length}) — क्यों?
          </summary>
          <ul className="mt-2 space-y-1 text-sm">
            {r.excluded.map((x) => (
              <li key={x.market + x.district}>
                <b>{x.market}</b> ({x.district}): {(x.reasons_hi.length ? x.reasons_hi : x.reasons).join("; ")}
              </li>
            ))}
          </ul>
        </details>
      )}

      {r.sources && (
        <section className="mt-4 rounded-2xl border border-ink-200 bg-white p-4 text-sm text-ink-700">
          <h3 className="font-semibold text-ink-800">डेटा के स्रोत</h3>
          <ul className="mt-2 space-y-1">
            {r.sources.prices_today && (
              <li>
                आज के भाव: <a className="underline" href={r.sources.prices_today.url} target="_blank" rel="noreferrer">data.gov.in</a>{" "}
                · {STATUS_HI[r.sources.prices_today.status] ?? r.sources.prices_today.status} ·{" "}
                {hiTime(r.sources.prices_today.fetched_at)}
              </li>
            )}
            <li>भाव का इतिहास: {r.sources.history}</li>
            {r.sources.weather && (
              <li>
                मौसम: <a className="underline" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo.com</a>{" "}
                (<a className="underline" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>) ·{" "}
                {STATUS_HI[r.sources.weather.status] ?? r.sources.weather.status} · {hiTime(r.sources.weather.fetched_at)}
              </li>
            )}
            <li>सड़क की दूरी: {r.sources.routing}</li>
          </ul>
        </section>
      )}
    </>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-ink-50 p-3">
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className={strong ? "text-2xl font-bold text-leaf-800" : "text-xl font-semibold text-ink-900"}>{value}</dd>
    </div>
  );
}

function NumField({ label, value, onChange, min = 1 }: { label: string; value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <label className="text-xs text-ink-600">
      {label}
      <input
        type="number"
        inputMode="decimal"
        min={min}
        value={value}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value)))}
        className="mt-1 block w-full rounded-lg border border-ink-200 p-2 text-base text-ink-900"
      />
    </label>
  );
}
