"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  ask,
  health,
  stats,
  type Stats,
  type Health,
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

// No vehicle defaults: the agent asks. Other charges start at 0 = "none entered" (labelled so).
const DEFAULT_PARAMS: Params = { other_charges_per_q: 0 };

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

export default function AskPage() {
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
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [server, setServer] = useState<"checking" | "waking" | "up" | "down">("checking");
  const [srcHealth, setSrcHealth] = useState<Health | null>(null);
  const [faults, setFaults] = useState<string[]>([]);

  useEffect(() => {
    // Free hosting sleeps when idle: say so if the first ping is slow, instead of looking broken.
    const slow = setTimeout(() => setServer((s) => (s === "checking" ? "waking" : s)), 2500);
    health()
      .then((h) => {
        setSrcHealth(h);
        setServer("up");
      })
      .catch(() => setServer("down"))
      .finally(() => clearTimeout(slow));
    return () => clearTimeout(slow);
  }, []);

  function play(url: string) {
    new Audio(url).play().catch(() => {}); // autoplay blocked: the speaker button still works
  }

  async function run(body: AskBody) {
    setBusy(true);
    setError(null);
    setTrace([]);
    setAudioUrl(null);
    try {
      await ask({ ...body, params: { ...params, ...body.params }, faults, speak: true }, (e) => {
        if (e.event === "audio") {
          const bytes = Uint8Array.from(atob(String((e as TraceEvent).wav_b64)), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
          setAudioUrl(url);
          play(url);
        } else if (e.event === "final") {
          const f = e as Final;
          setFinal(f);
          setPending(f.clarify);
          if (f.result) setParams((p) => ({ ...p, ...f.result!.costs })); // show what was used
        } else {
          setTrace((t) => [...t, e as TraceEvent]);
          if (e.event === "error") setError((e as TraceEvent).hi || (e as TraceEvent).en);
        }
      });
    } catch (err) {
      const msg = err instanceof Error && err.message.includes("—") ? err.message : null; // our 429 text
      setError(msg ?? "सर्वर से संपर्क नहीं हो पाया। थोड़ी देर बाद फिर कोशिश करें। (backend unreachable)");
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
      body.question = pending.hi;
      body.place = pending.place;
      const kg = parseFloat(q.replace(/[^\d.]/g, ""));
      if (pending.needs === "bori_kg" && kg > 0) {
        body.params = { ...params, bori_kg: kg };
        setParams(body.params); // keep it for the next question in this conversation
      }
    } else {
      lastText.current = q;
    }
    setText("");
    run(body);
  }

  function confirmPlace(p: Place) {
    run({ text: lastText.current, previous: pending?.intent, place: p });
  }

  function confirmQty() {
    const p = { ...params, qty_confirmed: true };
    setParams(p);
    run({ text: lastText.current, previous: pending?.intent, place: pending?.place, params: p });
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
    <main className="mx-auto max-w-3xl px-4 pt-10">
      <header>
        <h1 className="font-display text-3xl leading-tight font-bold text-ink-900 sm:text-5xl">अपनी फसल के बारे में पूछें</h1>
        <p className="mt-1 text-lg text-ink-600">लाइव मंडी भाव, सड़क की दूरी और दो मौसम मॉडल से — हर अंक का स्रोत साथ में।</p>
        {server === "waking" && (
          <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900" role="status">
            ⏳ सर्वर जाग रहा है, लगभग 1 मिनट लग सकता है… (free server waking up)
          </p>
        )}
        {server === "down" && (
          <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">सर्वर से संपर्क नहीं हो पाया। (backend unreachable)</p>
        )}
      </header>

      <section className="glass-strong mt-6 p-4 sm:p-6">
        {pending && (
          <div className="mb-3 rounded-xl bg-amber-50 p-3 text-amber-950" role="status">
            <p className="text-lg font-semibold">
              {pending.hi}
              {audioUrl && <ListenButton url={audioUrl} />}
            </p>
            {pending.needs === "confirm_qty" && (
              <button
                onClick={confirmQty}
                disabled={busy}
                className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm hover:bg-amber-100"
              >
                हाँ, मात्रा सही है
              </button>
            )}
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
          className="mt-1 w-full resize-none rounded-2xl border border-white bg-white/80 p-3 text-lg shadow-inner focus:border-leaf-600 focus:outline-none"
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={toggleMic}
            disabled={busy && !recording}
            aria-pressed={recording}
            className={`flex-1 rounded-full px-4 py-3 text-lg font-semibold text-white ${
              recording ? "animate-pulse bg-red-600" : "bg-ink-800 hover:bg-ink-700"
            } disabled:opacity-50`}
          >
            {recording ? "⏹ रोकें" : "🎤 बोलें"}
          </button>
          <button
            onClick={() => submit()}
            disabled={busy || !text.trim()}
            className="btn-primary flex-1 text-lg disabled:opacity-50"
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
        <section className="glass-strong mt-6 p-5 ring-2 ring-leaf-600/40" aria-live="polite">
          <p className="text-xl leading-relaxed text-ink-900">
            {final.answer}
            {audioUrl && <ListenButton url={audioUrl} />}
          </p>
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

      {srcHealth && <Footer h={srcHealth} faults={faults} setFaults={setFaults} />}
    </main>
  );
}

function ListenButton({ url }: { url: string }) {
  return (
    <button
      onClick={() => new Audio(url).play().catch(() => {})}
      className="ml-2 rounded-full bg-white px-2 py-0.5 align-middle text-base shadow-sm ring-1 ring-ink-200 hover:bg-ink-50"
      aria-label="जवाब सुनें"
    >
      🔊
    </button>
  );
}

const SOURCE_HI: Record<string, string> = {
  mandi_prices: "मंडी भाव (data.gov.in)",
  weather: "मौसम (Open-Meteo)",
  routing: "सड़क दूरी (OSRM)",
  geocoding: "नक्शा खोज (Nominatim)",
  database: "कैश डेटाबेस",
  llm: "भाषा मॉडल",
  voice: "आवाज़ (Sarvam)",
};

function Footer({ h, faults, setFaults }: { h: Health; faults: string[]; setFaults: (f: string[]) => void }) {
  const [use, setUse] = useState<Stats | null>(null);
  useEffect(() => {
    stats().then(setUse).catch(() => setUse(null));
  }, []);
  return (
    <section className="mt-8 space-y-3 text-sm text-ink-600" aria-label="स्रोत और टेस्ट स्विच">
      <details className="glass p-4 sm:p-5">
        <summary className="cursor-pointer font-semibold text-ink-800">
          स्रोत स्थिति {h.status === "ok" ? "✅" : "⚠️"} <span className="font-normal text-ink-500">(source health)</span>
        </summary>
        <ul className="mt-2 space-y-1">
          {Object.entries(h.sources).map(([k, v]) => (
            <li key={k}>
              {v.ok ? "✅" : "❌"} {SOURCE_HI[k] ?? k}
              <span className="text-xs text-ink-500">
                {v.ms != null ? ` · ${v.ms} ms` : v.note ? ` · ${v.note}` : ""}
                {v.error ? ` · ${v.error}` : ""}
              </span>
            </li>
          ))}
        </ul>
        {use && use.requests > 0 && (
          <p className="mt-2 text-xs text-ink-500">
            पिछले {use.days} दिन: {use.requests} सवाल · आधे {((use.p50_ms ?? 0) / 1000).toFixed(1)} s में, 95%{" "}
            {((use.p95_ms ?? 0) / 1000).toFixed(1)} s में · रास्ता बदला (repair){" "}
            {Math.round((use.fallback_rate ?? 0) * 100)}% · गढ़े गए अंक पकड़े: {use.invented_numbers}
          </p>
        )}
      </details>
      <details className="glass p-4 sm:p-5">
        <summary className="cursor-pointer font-semibold text-ink-800">
          टेस्ट स्विच {faults.length > 0 && `(${faults.length} चालू)`}{" "}
          <span className="font-normal text-ink-500">(demo: pretend a source is down)</span>
        </summary>
        <p className="mt-1 text-xs text-ink-500">
          चुना गया स्रोत अगले सवाल में बुलाया नहीं जाएगा, ताकि आप एजेंट को रास्ता बदलते देख सकें। कोई नकली डेटा नहीं भरा जाता।
        </p>
        {Object.entries(h.test_switches).map(([k, label]) => (
          <label key={k} className="mt-1 flex items-center gap-2">
            <input
              type="checkbox"
              checked={faults.includes(k)}
              onChange={(e) => setFaults(e.target.checked ? [...faults, k] : faults.filter((f) => f !== k))}
            />
            {label}
          </label>
        ))}
      </details>
    </section>
  );
}

function Trace({ events, busy }: { events: TraceEvent[]; busy: boolean }) {
  return (
    <section className="mt-6 glass p-4 sm:p-5">
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
      <section className="mt-6 glass p-4 sm:p-5">
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
          हिसाब का भाव {rupee(b.price_used)}{" "}
          {b.price_days > 1 ? `(पिछले ${b.price_days} रिपोर्ट का median)` : "(ताज़ा भाव)"} · आज का मॉडल भाव{" "}
          {rupee(b.modal_price)} ({b.variety}) · भाव की तारीख {hiDay(b.arrival_date)}
          {b.age_days > 0 && ` (${b.age_days} दिन पुराना)`}
        </p>
        {r.nearer_pick && (
          <p className="mt-3 text-sm text-ink-700">
            <b>{r.nearer_pick.skipped}</b> सिर्फ़ {rupee(r.nearer_pick.extra_per_quintal)}/क्विं. ज़्यादा देती, पर{" "}
            {r.nearer_pick.extra_km} km और दूर है, इसलिए पास वाली मंडी बताई।
          </p>
        )}
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
        <section className="mt-4 glass p-4 sm:p-5">
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

      <section className="mt-4 glass p-4 sm:p-5">
        <h3 className="mb-2 font-semibold text-ink-800">नक्शा</h3>
        <MandiMap origin={place} mandis={r.ranking.slice(0, 5)} />
      </section>

      <section className="mt-4 glass p-4 sm:p-5">
        <h3 className="font-semibold text-ink-800">मंडियों की तुलना</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-500">
              <tr>
                <th className="py-1 pr-2">#</th>
                <th className="pr-2">मंडी</th>
                <th className="pr-2 text-right" title="7 दिन का median">भाव (7 दिन)</th>
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
                  <td className="pr-2 text-right">{rupee(m.price_used)}</td>
                  <td className="pr-2 text-right">{m.road_km < 1 ? "उसी कस्बे" : `${Math.round(m.road_km)} km`}</td>
                  <td className="pr-2 text-right">{rupee(m.transport_total)}</td>
                  <td className="text-right font-semibold">{rupee(m.net_per_quintal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-4 glass p-4 sm:p-5">
        <h3 className="font-semibold text-ink-800">खर्च का हिसाब ({b.market})</h3>
        <ul className="mt-2 space-y-1 text-sm text-ink-700">
          <li>
            भाव: {rupee(b.price_used)} × {r.quantity_q} क्विं. = {rupee(b.price_used * r.quantity_q)}
          </li>
          <li>
            भाड़ा: {b.trips} चक्कर × 2 (आना-जाना) × {b.road_km} km × {rupee(r.costs.rate_per_km)}/km = −
            {rupee(b.transport_total)}
          </li>
          <li>
            हम्माली/तुलाई: {r.costs.other_charges_per_q > 0 ? `${rupee(r.costs.other_charges_per_q)}/क्विं. = −${rupee(b.mandi_charges)}` : "नहीं जोड़ी (आप देते हों तो नीचे भरें — दर मंडी समिति तय करती है)"}
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
            label="हम्माली/तुलाई ₹/क्विं. (अगर आप देते हैं)"
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
        <details className="mt-4 glass p-4 sm:p-5">
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
        <section className="mt-4 glass p-4 sm:p-5 text-sm text-ink-700">
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
    <div className="rounded-2xl bg-white/70 p-3">
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className={strong ? "text-2xl font-bold text-leaf-800" : "text-xl font-semibold text-ink-900"}>{value}</dd>
    </div>
  );
}

function NumField({ label, value, onChange, min = 1 }: { label: string; value?: number; onChange: (v: number) => void; min?: number }) {
  return (
    <label className="text-xs text-ink-600">
      {label}
      <input
        type="number"
        inputMode="decimal"
        min={min}
        value={value ?? ""}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value)))}
        className="mt-1 block w-full rounded-lg border border-ink-200 p-2 text-base text-ink-900"
      />
    </label>
  );
}
