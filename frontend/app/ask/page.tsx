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
  type Params,
  type Place,
  type Result,
  type TraceEvent,
} from "@/lib/api";
import { STEP_AI, STEP_ICONS } from "@/components/brand";
import { VoiceMeter } from "@/components/VoiceMeter";
import { LANGS, LanguagePicker, useLang, type T } from "@/lib/i18n";

const STATUS_KEY = { live: "st_live", cache: "st_cache", stale_cache: "st_stale_cache", error: "st_error" } as const;
const status = (t: T, s: string) => (s in STATUS_KEY ? t(STATUS_KEY[s as keyof typeof STATUS_KEY]) : s);

const MandiMap = dynamic(() => import("@/components/MandiMap"), { ssr: false });

// No vehicle defaults: the agent asks. Other charges start at 0 = "none entered" (labelled so).
const DEFAULT_PARAMS: Params = { other_charges_per_q: 0 };
// The farmer's last vehicle, kept in this browser. Only ever offered as a button when the agent
// asks about the vehicle: a new question never picks it up silently (test C2).
type Vehicle = { rate_per_km: number; capacity_q: number; other_charges_per_q: number };
const VEHICLE_KEY = "hc_vehicle";
const loadVehicle = (): Vehicle | null => {
  try {
    const v = JSON.parse(localStorage.getItem(VEHICLE_KEY) ?? "null");
    return v && v.rate_per_km > 0 && v.capacity_q > 0 ? v : null;
  } catch {
    return null;
  }
};

const rupee = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const fmtTime = (iso: string | null | undefined, locale: string) =>
  iso ? new Date(iso).toLocaleString(locale, { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—";
const dateOf = (iso: string) => new Date(iso + "T00:00:00");
const stepText = (e: TraceEvent, lang: string) => (lang === "hi" && e.hi ? e.hi : e.en);
// Multi-agent mode labels each trace line with the agent that produced it.
const AGENT_CHIP: Record<string, string> = {
  supervisor: "bg-violet-100 text-violet-800",
  intake: "bg-sky-100 text-sky-800",
  market: "bg-amber-100 text-amber-800",
  weather: "bg-cyan-100 text-cyan-800",
  auditor: "bg-red-100 text-red-800",
  calculator: "bg-leaf-100 text-leaf-800",
  explainer: "bg-ink-100 text-ink-800",
};

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
const CONF_CLS = {
  high: "bg-leaf-100 text-leaf-800",
  medium: "bg-amber-100 text-amber-900",
  low: "bg-red-100 text-red-800",
};

// One run of the agent: what the farmer said, the steps it took, and where it ended.
type Turn = { said: string; final: Final | null; trace: TraceEvent[] };
type Intent = {
  crop?: string | null;
  crop_word?: string | null;
  quantity?: number | null;
  unit?: string | null;
  village?: string | null;
  village_as_said?: string | null;
  district?: string | null;
  ready_from?: string | null;
  ready_to?: string | null;
  has_storage?: boolean;
  rate_per_km?: number | null;
};

// Trace event -> step of the agent (0 Understand … 6 Answer). Audit's closing summary is a "compute" event with `usable`.
function stageOf(e: TraceEvent): number {
  switch (e.event) {
    case "understand":
    case "clarify":
      return 0;
    case "plan":
      return 1;
    case "tool_call":
    case "tool_result":
      return 2;
    case "audit_reject":
    case "audit_flag":
      return 3;
    case "repair":
      return 4;
    case "compute":
      return "usable" in e ? 3 : 5;
    case "decision":
      return 5;
    case "explain":
      return 6;
    default:
      return -1;
  }
}

export default function AskPage() {
  const { lang, t } = useLang();
  const langInfo = LANGS.find((l) => l.code === lang)!;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sel, setSel] = useState<number | null>(null); // turn being viewed; null = latest
  const [final, setFinal] = useState<Final | null>(null);
  const [pending, setPending] = useState<Clarify | null>(null); // question we're waiting on
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null); // drives the live meter
  const [transcribing, setTranscribing] = useState(false);
  const micRing = useRef<HTMLSpanElement>(null);
  // Spoken replies cost Sarvam credits: only when the farmer spoke, or switched this on.
  const [readAloud, setReadAloud] = useState(false);
  const lastSpoken = useRef(false); // was the latest question asked with the mic?
  const recorder = useRef<MediaRecorder | null>(null);
  const lastText = useRef("");
  const pipelineRef = useRef<HTMLElement | null>(null);
  const questionRef = useRef<HTMLElement | null>(null);
  const answerRef = useRef<HTMLDivElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [server, setServer] = useState<"checking" | "waking" | "up" | "down">("checking");
  const [srcHealth, setSrcHealth] = useState<Health | null>(null);
  const [faults, setFaults] = useState<string[]>([]);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  useEffect(() => setVehicle(loadVehicle()), []);

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

  const patchLast = (p: Partial<Turn>) => setTurns((ts) => ts.map((x, i) => (i === ts.length - 1 ? { ...x, ...p } : x)));

  async function run(body: AskBody, said: string) {
    setTurns((ts) => [...ts, { said, final: null, trace: [] }]);
    setSel(null);
    setBusy(true);
    setError(null);
    setAudioUrl(null);
    setTimeout(() => pipelineRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    const steps: TraceEvent[] = [];
    try {
      // Only the params this call passes: a new question never inherits the last answer's vehicle.
      await ask({ ...body, params: body.params ?? DEFAULT_PARAMS, faults, speak: langInfo.voice && (readAloud || lastSpoken.current), lang }, (e) => {
        if (e.event === "audio") {
          const bytes = Uint8Array.from(atob(String((e as TraceEvent).wav_b64)), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
          setAudioUrl(url);
          play(url);
        } else if (e.event === "final") {
          const f = e as Final;
          setFinal(f);
          setPending(f.clarify);
          // The agent stopped to ask: bring its question back into view (on phones it is above the steps).
          // Otherwise go to the answer. Without this, phone browsers keep "Source status" in place as the
          // result is inserted above it (scroll anchoring) and the farmer lands at the bottom of the page.
          const target = f.clarify ? questionRef : answerRef;
          setTimeout(() => target.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
          if (f.result) {
            const c = f.result.costs; // show what was used, in the edit boxes
            setParams((p) => ({ ...p, rate_per_km: c.rate_per_km, capacity_q: c.capacity_q, other_charges_per_q: c.other_charges_per_q }));
            const v = { rate_per_km: c.rate_per_km, capacity_q: c.capacity_q, other_charges_per_q: c.other_charges_per_q };
            setVehicle(v);
            try {
              localStorage.setItem(VEHICLE_KEY, JSON.stringify(v));
            } catch {} // private mode: just not remembered
          }
          patchLast({ final: f });
        } else {
          steps.push(e as TraceEvent);
          patchLast({ trace: [...steps] });
          if (e.event === "error") setError(lang === "hi" ? (e as TraceEvent).hi || (e as TraceEvent).en : (e as TraceEvent).en);
        }
      });
    } catch (err) {
      const msg = err instanceof Error && err.message.includes("—") ? err.message : null; // our 429 text
      setError(err instanceof Error && err.message === "422" ? t("too_long") : (msg ?? t("unreachable")));
    } finally {
      setBusy(false);
    }
  }

  function submit(q0 = text, spoken = false) {
    const q = q0.trim();
    if (!q || busy) return;
    lastSpoken.current = spoken; // taps on follow-up buttons keep the same mode
    const body: AskBody = { text: q };
    if (pending && !pending.unsupported) {
      // Answering our question: carry the intent forward instead of starting over.
      body.previous = pending.intent;
      body.question = pending.text ?? pending.en;
      body.place = pending.place;
      body.params = params;
      const kg = parseFloat(q.replace(/[^\d.]/g, ""));
      if (pending.needs === "bori_kg" && kg > 0) {
        body.params = { ...params, bori_kg: kg };
        setParams(body.params); // keep it for the next question in this conversation
      }
    } else {
      // A new question: vehicle, charges and confirmations from the last one don't carry over.
      lastText.current = q;
      body.params = DEFAULT_PARAMS;
      setParams(DEFAULT_PARAMS);
    }
    setText("");
    run(body, q);
  }

  function confirmPlace(p: Place) {
    run({ text: lastText.current, previous: pending?.intent, place: p, params }, `${t("yes")}, ${p.name}`);
  }

  function pickVehicle(v: Vehicle) {
    const p = { ...params, ...v };
    setParams(p);
    run(
      { text: lastText.current, previous: pending?.intent, question: pending?.text ?? pending?.en, place: pending?.place, params: p },
      t("use_vehicle", { rate: rupee(v.rate_per_km), cap: v.capacity_q }),
    );
  }

  function confirmQty() {
    const p = { ...params, qty_confirmed: true };
    setParams(p);
    run({ text: lastText.current, previous: pending?.intent, place: pending?.place, params: p }, t("yes_qty"));
  }

  function recalc() {
    if (!final?.intent || !final.place) return;
    run({ text: lastText.current, previous: final.intent, place: final.place, params, recalc: true }, t("recalc"));
  }

  function reset() {
    setTurns([]);
    setSel(null);
    setFinal(null);
    setPending(null);
    setParams(DEFAULT_PARAMS);
    setError(null);
    setAudioUrl(null);
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
        setMicStream(null);
        setTranscribing(true);
        try {
          const said = await transcribe(new Blob(chunks, { type: rec.mimeType }), lang);
          setText(said);
          submit(said, true);
        } catch (err) {
          setError(err instanceof Error && err.message.includes("limit") ? t("voice_limit") : t("stt_failed"));
        } finally {
          setTranscribing(false);
        }
      };
      rec.start();
      recorder.current = rec;
      setRecording(true);
      setMicStream(stream);
      setTimeout(() => rec.state === "recording" && rec.stop(), 25_000); // Sarvam REST limit ~30 s
    } catch {
      setError(t("mic_denied"));
    }
  }

  const at = sel ?? turns.length - 1;
  const view = turns[at];
  const isLatest = at === turns.length - 1;
  const vf = view?.final ?? null;
  const asking = isLatest && !busy ? pending : null;
  // While a follow-up runs, keep showing what was understood so far.
  // When the agent asks back, what it understood so far is in clarify.intent, not intent. Without
  // it the chips fell back to the PREVIOUS question (asking about gram, showing wheat).
  const intentOf = (f: Final | null | undefined) => f?.intent ?? f?.clarify?.intent ?? null;
  const intent = (intentOf(vf) ?? intentOf(turns.findLast((x) => intentOf(x.final))?.final)) as Intent | null;
  const r = vf?.result;

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 pt-8 lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_17rem]">
      <aside className="order-2 lg:order-1 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto">
        <History turns={turns} at={at} busy={busy} onPick={setSel} />
      </aside>

      <div className="order-1 min-w-0 space-y-5 lg:order-2">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl leading-tight font-bold text-ink-900 sm:text-4xl">{t("ask_title")}</h1>
            <p className="mt-1 text-ink-600">{t("ask_sub")}</p>
          </div>
          {turns.length > 0 && (
            <button onClick={reset} disabled={busy} className="btn-ghost px-4 py-2 text-sm disabled:opacity-50">
              ＋ {t("new_chat")}
            </button>
          )}
        </header>
        {server === "waking" && (
          <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900" role="status">
            {t("waking")}
          </p>
        )}
        {server === "down" && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-800">{t("down")}</p>}

        {/* 1. The question, and what the agent made of it */}
        <section ref={questionRef} className="glass-strong scroll-mt-24 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor="q" className="font-semibold text-ink-800">
              {asking ? t("answer_label") : t("ask_label")}
            </label>
            <div className="w-44">
              <LanguagePicker compact />
            </div>
          </div>
          {asking && (
            <div className="mt-3 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200" role="status">
              <p className="text-lg font-semibold text-amber-950">
                ❓ {asking.text ?? asking.en}
                {audioUrl && <ListenButton url={audioUrl} />}
              </p>
              {asking.needs === "confirm_qty" && (
                <button onClick={confirmQty} className="mt-3 rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-sm ring-1 ring-amber-300 hover:bg-amber-100">
                  {t("yes_qty")}
                </button>
              )}
              {asking.needs === "vehicle" && vehicle && (
                <button
                  onClick={() => pickVehicle(vehicle)}
                  disabled={busy}
                  className="mt-3 rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-sm ring-1 ring-amber-300 hover:bg-amber-100"
                >
                  🚜 {t("use_vehicle", { rate: rupee(vehicle.rate_per_km), cap: vehicle.capacity_q })}
                </button>
              )}
              {asking.options && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {asking.options.map((p) => (
                    <button
                      key={p.display_name}
                      onClick={() => confirmPlace(p)}
                      className="rounded-2xl bg-white px-4 py-2 text-left text-sm shadow-sm ring-1 ring-amber-300 hover:bg-amber-100"
                    >
                      <b>{asking.options!.length > 1 ? p.name : `${t("yes")}, ${p.name}`}</b>
                      <span className="block text-xs text-ink-500">{p.display_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="mt-3 flex items-end gap-2">
            <textarea
              id="q"
              maxLength={1000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), submit())}
              rows={2}
              placeholder={asking ? t("answer_label") : t("placeholder")}
              className="min-w-0 flex-1 resize-none rounded-2xl border border-white bg-white/90 p-3 text-lg shadow-inner focus:border-leaf-600 focus:outline-none"
            />
            <span ref={micRing} className="relative grid shrink-0 place-items-center" style={{ "--lvl": 0 } as React.CSSProperties}>
              {recording && (
                <>
                  {/* rings grow with the voice's loudness (--lvl, 0..1, set by VoiceMeter) */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-full bg-red-500/30 transition-transform duration-100 motion-reduce:hidden"
                    style={{ transform: "scale(calc(1 + var(--lvl) * 0.9))" }}
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-full bg-red-500/15 transition-transform duration-150 motion-reduce:hidden"
                    style={{ transform: "scale(calc(1.1 + var(--lvl) * 1.6))" }}
                  />
                </>
              )}
              <button
                onClick={toggleMic}
                disabled={(busy && !recording) || transcribing}
                aria-pressed={recording}
                aria-label={recording ? t("stop") : t("speak")}
                className={`relative grid h-12 w-12 place-items-center rounded-full text-xl text-white transition-colors ${
                  recording ? "bg-red-600 shadow-lg shadow-red-600/40" : "bg-ink-800 hover:bg-ink-700"
                } disabled:opacity-50`}
              >
                {transcribing ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
                ) : recording ? (
                  "⏹"
                ) : (
                  "🎤"
                )}
              </button>
            </span>
            <button onClick={() => submit()} disabled={busy || !text.trim()} className="btn-primary h-12 shrink-0 px-6 disabled:opacity-50">
              {busy ? "…" : t("ask")}
            </button>
          </div>
          {micStream && <VoiceMeter stream={micStream} maxSeconds={25} label={t("listening")} ringRef={micRing} />}
          {transcribing && (
            <p className="mt-2 flex items-center gap-2 rounded-2xl bg-white/70 px-3 py-2 text-sm text-ink-700" role="status">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-leaf-600/30 border-t-leaf-600" aria-hidden />
              {t("understanding")}
            </p>
          )}
          <div className="mt-2 text-sm text-ink-600">
            {langInfo.voice ? (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={readAloud} onChange={(e) => setReadAloud(e.target.checked)} />
                {t("read_aloud")}
              </label>
            ) : (
              t("no_voice", { lang: langInfo.native })
            )}
          </div>
          {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">{error}</p>}

          {view && (
            <div className="mt-4 border-t border-white pt-4">
              <p className="text-sm text-ink-600">
                {t("you_asked")}: <span className="text-ink-900">“{view.said}”</span>
              </p>
              {intent && (
                <>
                  <p className="mt-3 text-xs font-semibold tracking-wide text-ink-500 uppercase">{t("understood")}</p>
                  <Chips intent={intent} rate={r?.costs.rate_per_km} needs={asking?.needs} />
                </>
              )}
              {vf?.clarify && !asking && <p className="mt-3 text-sm text-ink-600">❓ {vf.clarify.text ?? vf.clarify.en}</p>}
            </div>
          )}
        </section>

        {turns.length === 0 && (
          <section className="glass p-6">
            <p className="text-lg text-ink-700">{t("welcome")}</p>
            <p className="mt-4 text-sm font-semibold text-ink-500">{t("examples")}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {[t("ex1"), t("ex2")].map((ex) => (
                <button key={ex} onClick={() => setText(ex)} className="rounded-2xl bg-white/80 p-4 text-left text-ink-800 shadow-sm ring-1 ring-white hover:bg-white">
                  {ex}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 2. The agent at work */}
        {/* Inline below xl; on wide screens it sits in the right column instead */}
        {view && (
          <section ref={pipelineRef} className="scroll-mt-24 xl:hidden">
            <Pipeline key={at} events={view.trace} busy={busy && isLatest} final={vf} />
          </section>
        )}

        {/* 3. The decision */}
        <div ref={answerRef} className="scroll-mt-24 space-y-5">
        {r?.best && vf?.place && (
          <ResultView
            r={r}
            place={vf.place}
            answer={vf.answer}
            audioUrl={isLatest ? audioUrl : null}
            editable={isLatest}
            params={params}
            setParams={setParams}
            recalc={recalc}
            busy={busy}
          />
        )}
        {vf?.answer && !r?.best && (
          <section className="glass-strong p-5 text-lg text-ink-900">
            {vf.answer}
            {isLatest && audioUrl && <ListenButton url={audioUrl} />}
          </section>
        )}
        </div>

        {srcHealth && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Status h={srcHealth} faults={faults} setFaults={setFaults} />
          </div>
        )}
      </div>

      {view && (
        <aside className="order-3 hidden xl:sticky xl:top-24 xl:block xl:max-h-[calc(100dvh-7rem)] xl:self-start xl:overflow-y-auto">
          <Pipeline key={at} events={view.trace} busy={busy && isLatest} final={vf} vertical />
        </aside>
      )}
    </main>
  );
}

function Chips({ intent: i, rate, needs }: { intent: Intent; rate?: number; needs?: string }) {
  const { t, locale } = useLang();
  const day = (s: string) => dateOf(s).toLocaleDateString(locale, { day: "numeric", month: "short" });
  const vehicle = rate ?? i.rate_per_km;
  // [label, value, show even when missing]
  const items: [string, string | null, boolean][] = [
    [t("c_crop"), i.crop_word || i.crop || null, true],
    [t("c_qty"), i.quantity ? `${i.quantity} ${i.unit ?? ""}`.trim() : null, true],
    [t("c_village"), [i.village_as_said || i.village, i.district].filter(Boolean).join(", ") || null, true],
    [t("c_dates"), i.ready_from ? (i.ready_to && i.ready_to !== i.ready_from ? `${day(i.ready_from)} – ${day(i.ready_to)}` : day(i.ready_from)) : null, false],
    [t("c_vehicle"), vehicle ? `${rupee(vehicle)}/km` : null, needs === "vehicle"],
    [t("c_storage"), i.has_storage ? "✓" : null, false],
  ];
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {items
        .filter(([, v, must]) => v || must)
        .map(([k, v]) =>
          v ? (
            <li key={k} className="rounded-full bg-white px-3 py-1.5 text-sm shadow-sm">
              <span className="text-ink-500">{k}</span> <b className="text-ink-900">{v}</b>
            </li>
          ) : (
            <li key={k} className="rounded-full border border-dashed border-marigold-500 bg-marigold-300/25 px-3 py-1.5 text-sm font-semibold text-ink-800">
              {k}?
            </li>
          ),
        )}
    </ul>
  );
}

function Pipeline({ events, busy, final, vertical = false }: { events: TraceEvent[]; busy: boolean; final: Final | null; vertical?: boolean }) {
  const { lang, t, d, locale } = useLang();
  const [open, setOpen] = useState<number | null>(null);
  const by = d.how.flow.map((_, k) => events.filter((e) => stageOf(e) === k));
  const current = busy && events.length ? stageOf(events[events.length - 1]) : -1;
  const stopped = !!final?.clarify; // the agent stopped to ask, so later steps didn't run
  const took = events.length > 1 && !busy ? ((events[events.length - 1].t ?? 0) - (events[0].t ?? 0)) / 1000 : null;
  const done = by.filter((x) => x.length).length;

  function note(k: number): string {
    const n = by[k].length;
    if (k === 0 && stopped) return t("stg_asked");
    if (k === 2 && n) return t("stg_sources", { n: by[k].filter((e) => e.event === "tool_result").length || n });
    if (k === 3 && n) {
      // repair rounds re-audit the same mandi, so count mandis, not reject events
      const out = new Set(by[k].filter((e) => e.event === "audit_reject").map((e) => e.mandi ?? e.en)).size;
      return out ? t("stg_left_out", { n: out }) : t("stg_all_ok");
    }
    if (k === 4) return n ? t("stg_fixed", { n }) : final && !stopped ? t("not_needed") : "";
    return n ? t("stg_done") : "";
  }

  return (
    <div className="glass p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold">
          {t("pipeline")}
          {busy && <span className="inline-block h-2 w-2 animate-ping rounded-full bg-leaf-600" />}
        </h2>
        <span className="text-sm text-ink-600">{took != null ? t("took", { s: took.toFixed(1) }) : `${done} / 7`}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/70">
        <div className="h-full rounded-full bg-gradient-to-r from-marigold-400 to-leaf-600 transition-all duration-500" style={{ width: `${(done / 7) * 100}%` }} />
      </div>
      <ol className={`mt-4 grid gap-2 ${vertical ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-4 lg:grid-cols-7"}`}>
        {d.how.flow.map((s, k) => {
          const has = by[k].length > 0;
          const active = k === current;
          const skipped = !busy && !!final && !has;
          const cls = active
            ? "bg-white ring-2 ring-leaf-600 shadow-md"
            : has
              ? STEP_AI[k]
                ? "bg-marigold-300/60 ring-1 ring-marigold-400"
                : "bg-leaf-50 ring-1 ring-leaf-100"
              : "bg-white/40 ring-1 ring-white text-ink-500";
          return (
            <li key={k}>
              <button
                onClick={() => setOpen(open === k ? null : k)}
                disabled={!has}
                aria-expanded={open === k}
                className={`h-full w-full rounded-2xl text-left transition ${vertical ? "flex items-center gap-3 px-3 py-2" : "p-3"} ${cls} ${skipped ? "opacity-60" : ""} ${open === k ? "outline-2 outline-ink-900" : ""}`}
              >
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className={active ? "animate-pulse" : ""}>
                    {STEP_ICONS[k]}
                  </span>
                  <span className="text-xs font-bold text-ink-500">{k + 1}</span>
                </span>
                <span className={vertical ? "min-w-0" : ""}>
                  <span className={`block font-semibold text-ink-900 ${vertical ? "" : "mt-1"}`}>{s.name}</span>
                  <span className="block text-xs text-ink-600">{active ? t("thinking") : note(k)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {busy && events.length > 0 && (
        <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-sm text-ink-700">
          {EVENT_ICON[events[events.length - 1].event] ?? "•"} {stepText(events[events.length - 1], lang)}
        </p>
      )}
      {open != null && by[open].length > 0 && (
        <ol className="mt-3 space-y-1.5 rounded-2xl bg-white/70 p-3 text-sm">
          {by[open].map((e, k) => (
            <li key={k} className={`flex gap-2 rounded-lg px-2 py-1 ${e.event === "repair" ? "bg-amber-50" : e.event === "audit_reject" ? "bg-red-50" : ""}`}>
              <span aria-hidden>{EVENT_ICON[e.event] ?? "•"}</span>
              <span className="min-w-0">
                <span className="block break-words text-ink-800">
                  {typeof e.agent === "string" && (
                    <span className={`mr-1.5 inline-block rounded-full px-1.5 py-px align-middle text-[10px] font-semibold uppercase tracking-wide ${AGENT_CHIP[e.agent] ?? "bg-ink-100 text-ink-700"}`}>
                      {e.agent}
                    </span>
                  )}
                  {stepText(e, lang)}
                </span>
                {e.status && (
                  <span className="text-xs text-ink-500">
                    {status(t, e.status)}
                    {e.ms != null && ` · ${(e.ms / 1000).toFixed(1)} s`}
                    {e.fetched_at && ` · ${fmtTime(e.fetched_at, locale)}`}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function History({ turns, at, busy, onPick }: { turns: Turn[]; at: number; busy: boolean; onPick: (i: number) => void }) {
  const { t } = useLang();
  if (!turns.length) return null;
  return (
    <details open className="glass p-3">
      <summary className="cursor-pointer px-1 font-semibold text-ink-800">
        {t("previous")} ({turns.length})
      </summary>
      <ol className="mt-2 space-y-1.5">
        {turns.map((x, i) => {
          const best = x.final?.result?.best;
          return (
            <li key={i}>
              <button
                onClick={() => onPick(i)}
                disabled={busy}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm ${i === at ? "bg-white shadow-sm ring-1 ring-leaf-600/40" : "hover:bg-white/60"}`}
              >
                <span className="line-clamp-2 text-ink-800">{x.said}</span>
                <span className="mt-0.5 block truncate text-xs text-ink-500">
                  {best ? `✅ ${best.market} · ${rupee(best.net_per_quintal)}/q` : x.final?.clarify ? "❓" : x.final ? "💬" : "…"}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function ListenButton({ url }: { url: string }) {
  const { t } = useLang();
  return (
    <button
      onClick={() => new Audio(url).play().catch(() => {})}
      className="ml-2 rounded-full bg-white px-2 py-0.5 align-middle text-base shadow-sm ring-1 ring-ink-200 hover:bg-ink-50"
      aria-label={t("listen")}
    >
      🔊
    </button>
  );
}

function Status({ h, faults, setFaults }: { h: Health; faults: string[]; setFaults: (f: string[]) => void }) {
  const { t, d } = useLang();
  const [use, setUse] = useState<Stats | null>(null);
  useEffect(() => {
    stats().then(setUse).catch(() => setUse(null));
  }, []);
  return (
    <>
      <details className="glass p-4 text-sm text-ink-600">
        <summary className="cursor-pointer font-semibold text-ink-800">
          {t("health")} {h.status === "ok" ? "✅" : "⚠️"}
        </summary>
        <ul className="mt-2 space-y-1">
          {Object.entries(h.sources).map(([k, v]) => (
            <li key={k}>
              {v.ok ? "✅" : "❌"} {(d.ask as Record<string, string>)[`src_${k}`] ?? k}
              <span className="text-xs text-ink-500">
                {v.ms != null ? ` · ${v.ms} ms` : v.note ? ` · ${v.note}` : ""}
                {v.error ? ` · ${v.error}` : ""}
              </span>
            </li>
          ))}
        </ul>
        {use && use.requests > 0 && (
          <p className="mt-2 text-xs text-ink-500">
            {t("usage", {
              d: use.days ?? 7,
              n: use.requests,
              p50: ((use.p50_ms ?? 0) / 1000).toFixed(1),
              p95: ((use.p95_ms ?? 0) / 1000).toFixed(1),
              fb: Math.round((use.fallback_rate ?? 0) * 100),
              inv: use.invented_numbers ?? 0,
            })}
          </p>
        )}
      </details>
      <details className="glass p-4 text-sm text-ink-600">
        <summary className="cursor-pointer font-semibold text-ink-800">
          {t("switches")} {faults.length > 0 && t("switches_on", { n: faults.length })}
        </summary>
        <p className="mt-1 text-xs text-ink-500">{t("switches_note")}</p>
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
    </>
  );
}

function ResultView({
  r,
  place,
  answer,
  audioUrl,
  editable,
  params,
  setParams,
  recalc,
  busy,
}: {
  r: Result;
  place: Place;
  answer: string | null;
  audioUrl: string | null;
  editable: boolean;
  params: Params;
  setParams: (p: Params) => void;
  recalc: () => void;
  busy: boolean;
}) {
  const { lang, t, locale } = useLang();
  const b = r.best!;
  const day = (iso: string) => dateOf(iso).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "long" });
  const gross = b.price_used * r.quantity_q;
  const nets = r.ranking.map((m) => m.net_per_quintal);
  const top = Math.max(...nets);
  const low = Math.min(...nets);
  const floor = low - (top - low || top * 0.05); // bars start below the lowest, so the last one isn't empty
  const old = (n: number) => (n === 1 ? t("day_old") : t("days_old", { n }));

  return (
    <div className="space-y-4">
      {/* 1. The decision */}
      <section className="rounded-[2rem] bg-gradient-to-br from-leaf-700 to-leaf-900 p-6 text-white shadow-xl sm:p-8">
        {answer && (
          <blockquote className="mb-6 rounded-2xl bg-white/10 p-4 text-lg leading-relaxed text-white">
            <p className="text-xs font-semibold tracking-wide text-leaf-100 uppercase">{t("agent_says")}</p>
            <p className="mt-1">
              {answer}
              {audioUrl && <ListenButton url={audioUrl} />}
            </p>
            <ShareButton text={answer} />
          </blockquote>
        )}
        <p className="text-sm font-semibold tracking-wide text-leaf-100 uppercase">{t("best")}</p>
        <h2 className="mt-1 font-display text-4xl font-extrabold sm:text-5xl">{b.market}</h2>
        <p className="mt-1 text-leaf-100">
          📍 {b.district} · {b.road_km < 1 ? t("same_town") : t("by_road", { km: b.road_km })}
          {b.road_km >= 1 && ` · ${t("about_min", { min: Math.round(b.drive_min) })}`}
        </p>
        {r.confidence && (
          <p className="mt-3">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${CONF_CLS[r.confidence]}`} title={r.confidence_reasons?.join("; ")}>
              {t(`conf_${r.confidence}`)}
            </span>
            {r.confidence_reasons?.length ? <span className="ml-2 text-xs text-leaf-100">{r.confidence_reasons.join("; ")}</span> : null}
          </p>
        )}
        <dl className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-white/15 p-4">
            <dt className="text-sm text-leaf-100">{t("net_q")}</dt>
            <dd className="font-display text-4xl font-extrabold text-marigold-300">{rupee(b.net_per_quintal)}</dd>
          </div>
          <div className="rounded-2xl bg-white/10 p-4">
            <dt className="text-sm text-leaf-100">{t("net_total", { q: r.quantity_q })}</dt>
            <dd className="font-display text-3xl font-bold">{rupee(b.net_total)}</dd>
          </div>
          <div className="rounded-2xl bg-white/10 p-4">
            <dt className="text-sm text-leaf-100">{t("bad_day")}</dt>
            <dd className="font-display text-3xl font-bold">
              {b.conservative_net_per_quintal == null ? (
                <span className="text-base font-normal">{t("little_history")}</span>
              ) : (
                rupee(b.conservative_net_per_quintal)
              )}
            </dd>
          </div>
        </dl>
        {(r.nearer_pick || (r.runner_up && r.runner_up_gap)) && (
          <div className="mt-5 rounded-2xl bg-white/10 p-4 text-sm leading-relaxed">
            <p className="font-semibold">💡 {t("why")}</p>
            {r.nearer_pick && (
              <p className="mt-1 text-leaf-50">
                {t("nearer", { m: r.nearer_pick.skipped, p: rupee(r.nearer_pick.extra_per_quintal), km: r.nearer_pick.extra_km })}
              </p>
            )}
            {r.runner_up && r.runner_up_gap && (
              <p className="mt-1 text-leaf-50">
                {t("runner_up")} <b>{r.runner_up.market}</b>:{" "}
                {r.runner_up_gap.price > 0
                  ? t("ru_lower", { p: rupee(r.runner_up_gap.price) })
                  : t("ru_higher", { p: rupee(-r.runner_up_gap.price), t: rupee(r.runner_up_gap.transport_per_quintal) })}{" "}
                {r.runner_up_gap.net_per_quintal < 0
                  ? t("ru_more_far", { p: rupee(-r.runner_up_gap.net_per_quintal), km: Math.round(r.runner_up.road_km - b.road_km) })
                  : t("ru_total", { p: rupee(r.runner_up_gap.net_per_quintal) })}
              </p>
            )}
          </div>
        )}
        {r.advice?.includes("split_sale") && <p className="mt-4 rounded-2xl bg-white/10 p-3 text-sm text-leaf-50">⚖️ {t("split_sale")}</p>}
        <p className="mt-4 text-xs text-leaf-100">
          {t("price_used", { p: rupee(b.price_used) })} {b.price_days > 1 ? t("median_of", { n: b.price_days }) : t("latest")} · {b.variety} ·{" "}
          {t("price_date", { d: day(b.arrival_date) })}
          {b.age_days > 0 && ` ${old(b.age_days)}`}
        </p>
      </section>

      {/* 2. Weather and waiting */}
      {(r.harvest_days?.length || r.wait || r.weather_note) && (
        <section className="glass p-5 sm:p-6">
          {r.weather_note === "no_forecast" && (
            <>
              <h3 className="font-display text-2xl font-bold">🌾 {t("weather")}</h3>
              <p className="mt-1 text-ink-700">{t("no_weather")}</p>
            </>
          )}
          {r.harvest_days && r.harvest_days.length > 0 && (
            <>
              <h3 className="font-display text-2xl font-bold">🌾 {t("weather")}</h3>
              <p className="text-sm text-ink-600">{t("safe_days")}</p>
              <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-7">
                {r.harvest_days.map((d) => {
                  const ok = d.dry && !d.uncertain;
                  const dt = dateOf(d.day);
                  return (
                    <li
                      key={d.day}
                      title={d.reasons.join("; ")}
                      className={`rounded-2xl p-3 text-center ring-1 ${ok ? "bg-leaf-50 ring-leaf-100" : "bg-amber-50 ring-amber-100"}`}
                    >
                      <p className="text-xs font-semibold text-ink-600 uppercase">{dt.toLocaleDateString(locale, { weekday: "short" })}</p>
                      <p className="font-display text-2xl font-bold">{dt.toLocaleDateString(locale, { day: "numeric" })}</p>
                      <p className="text-2xl" aria-hidden>
                        {d.dry ? "☀️" : "🌧️"}
                      </p>
                      <p className={`mt-1 text-xs font-semibold ${ok ? "text-leaf-800" : "text-amber-900"}`}>
                        {(d.dry ? t("dry") : t("rain")).replace(/^\S+\s/, "")}
                        {d.one_model ? t("one_model") : d.uncertain && t("uncertain")}
                      </p>
                    </li>
                  );
                })}
              </ul>
              {r.beyond_forecast && r.beyond_forecast.length > 0 && (
                <p className="mt-2 text-xs text-ink-500">
                  {r.beyond_forecast.map(day).join(", ")}: {t("no_forecast")}
                </p>
              )}
            </>
          )}
          {r.wait && (
            <div className="mt-4 rounded-2xl bg-white/70 p-4">
              <p className="font-semibold text-ink-900">⏳ {t("wait_q", { n: r.wait.days })}</p>
              <p className="mt-1 text-ink-700">
                {r.wait.trend_change_per_quintal == null
                  ? t("no_trend")
                  : t("trend", { p: `${r.wait.trend_change_per_quintal >= 0 ? "+" : ""}${rupee(r.wait.trend_change_per_quintal)}` })}
                {r.wait.max_rain_risk != null && ` · ${t("rain_risk", { p: Math.round(r.wait.max_rain_risk * 100) })}`}
              </p>
              <p className="mt-1 text-xs text-ink-500">{t("trend_note")}</p>
            </div>
          )}
        </section>
      )}

      {/* 3. Where the money goes */}
      <section className="glass p-5 sm:p-6">
        <h3 className="font-display text-2xl font-bold">💰 {t("money")}</h3>
        <p className="text-sm text-ink-600">{b.market}</p>
        <ul className="mt-4 space-y-3">
          <MoneyRow label={t("m_gross", { q: r.quantity_q, p: rupee(b.price_used) })} value={rupee(gross)} width={1} cls="bg-ink-200" />
          <MoneyRow
            label={t("m_transport")}
            sub={`${b.trips} × 2 × ${b.road_km} km × ${rupee(r.costs.rate_per_km)}/km`}
            value={`−${rupee(b.transport_total)}`}
            width={gross ? b.transport_total / gross : 0}
            cls="bg-red-300"
          />
          <MoneyRow
            label={t("m_charges")}
            sub={r.costs.other_charges_per_q > 0 ? `${rupee(r.costs.other_charges_per_q)}/q` : t("c_hammali_none")}
            value={`−${rupee(b.mandi_charges)}`}
            width={gross ? b.mandi_charges / gross : 0}
            cls="bg-amber-300"
          />
          <MoneyRow label={t("m_net")} value={rupee(b.net_total)} width={gross ? b.net_total / gross : 0} cls="bg-leaf-600" strong />
        </ul>
        <p className="mt-3 text-xs text-ink-500">{r.costs.fee_rule ? t("c_fee_buyer", { law: r.costs.fee_rule }) : t("c_fee_other")}</p>

        {editable && (
        <details className="mt-4 rounded-2xl bg-white/60 p-4">
          <summary className="cursor-pointer font-semibold text-ink-800">✏️ {t("edit")}</summary>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <NumField label={t("f_rate")} value={params.rate_per_km} onChange={(v) => setParams({ ...params, rate_per_km: v })} />
            <NumField label={t("f_cap")} value={params.capacity_q} onChange={(v) => setParams({ ...params, capacity_q: v })} />
            <NumField
              label={t("f_hammali")}
              value={params.other_charges_per_q}
              min={0}
              onChange={(v) => setParams({ ...params, other_charges_per_q: v })}
            />
          </div>
          <button
            onClick={recalc}
            disabled={busy}
            className="mt-3 rounded-full bg-ink-800 px-5 py-2 font-semibold text-white hover:bg-ink-700 disabled:opacity-50"
          >
            {t("recalc")}
          </button>
        </details>
        )}
        {r.notes.length > 0 && <p className="mt-2 text-xs text-ink-500">{r.notes.join(" · ")}</p>}
      </section>

      {/* 4. Every mandi, ranked */}
      <section className="glass p-5 sm:p-6">
        <h3 className="font-display text-2xl font-bold">📊 {t("compare")}</h3>
        <ol className="mt-4 space-y-3">
          {r.ranking.map((m, i) => (
            <li key={m.market + m.district}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="font-semibold text-ink-900">
                  {i + 1}. {m.market}
                  {i === 0 && <span className="ml-2 rounded-full bg-leaf-600 px-2 py-0.5 text-xs text-white">{t("best_tag")}</span>}
                </p>
                <p className="font-display text-lg font-bold">
                  {rupee(m.net_per_quintal)}
                  <span className="text-xs font-normal text-ink-500">/q</span>
                </p>
              </div>
              <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-ink-100">
                <div
                  className={`h-full rounded-full ${i === 0 ? "bg-leaf-600" : "bg-marigold-400"}`}
                  style={{ width: `${Math.max(6, ((m.net_per_quintal - floor) / (top - floor)) * 100)}%` }}
                />
              </div>
              <Sparkline points={m.history} label={t("price_14d")} />
              <p className="mt-1 text-xs text-ink-500">
                {t("col_price")} {rupee(m.price_used)} · {m.road_km < 1 ? t("same_town_short") : `${Math.round(m.road_km)} km`} ·{" "}
                {t("col_transport")} {rupee(m.transport_total)}
                {m.age_days > 0 && ` · ${old(m.age_days)}`}
                {i > 0 &&
                  ` · ${
                    m.net_per_quintal > r.ranking[0].net_per_quintal
                      ? t("vs_best_more", { p: rupee(m.net_per_quintal - r.ranking[0].net_per_quintal), km: Math.round(m.road_km - r.ranking[0].road_km) })
                      : t("vs_best", { p: rupee(r.ranking[0].net_per_quintal - m.net_per_quintal) })
                  }`}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="glass p-3 sm:p-4">
        <h3 className="mb-2 px-1 font-semibold text-ink-800">🗺️ {t("map")}</h3>
        <MandiMap origin={place} mandis={r.ranking.slice(0, 5)} labels={{ home: t("map_home"), village: t("map_village"), map: t("map") }} />
      </section>

      {/* 5. The fine print */}
      <details className="glass p-5">
        <summary className="cursor-pointer font-semibold text-ink-800">{t("more")}</summary>
        {r.excluded.length > 0 && (
          <>
            <h4 className="mt-4 font-semibold text-ink-800">🚫 {t("excluded", { n: r.excluded.length })}</h4>
            <ul className="mt-2 space-y-1 text-sm text-ink-700">
              {r.excluded.map((x) => (
                <li key={x.market + x.district} className="rounded-xl bg-red-50/70 px-3 py-2">
                  <b>{x.market}</b> ({x.district}): {(lang === "hi" && x.reasons_hi.length ? x.reasons_hi : x.reasons).join("; ")}
                </li>
              ))}
            </ul>
          </>
        )}
        {r.sources && (
          <>
            <h4 className="mt-4 font-semibold text-ink-800">{t("sources")}</h4>
            <ul className="mt-2 space-y-1 text-sm text-ink-700">
              {r.sources.prices_today && (
                <li>
                  {t("s_today")}:{" "}
                  <a className="underline" href={r.sources.prices_today.url} target="_blank" rel="noreferrer">
                    data.gov.in
                  </a>{" "}
                  · {status(t, r.sources.prices_today.status)} · {fmtTime(r.sources.prices_today.fetched_at, locale)}
                </li>
              )}
              <li>
                {t("s_history")}: {r.sources.history}
              </li>
              {r.sources.weather && (
                <li>
                  {t("s_weather")}:{" "}
                  <a className="underline" href="https://open-meteo.com/" target="_blank" rel="noreferrer">
                    Weather data by Open-Meteo.com
                  </a>{" "}
                  (
                  <a className="underline" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
                    CC BY 4.0
                  </a>
                  ) · {status(t, r.sources.weather.status)} · {fmtTime(r.sources.weather.fetched_at, locale)}
                </li>
              )}
              <li>
                {t("s_roads")}: {r.sources.routing}
              </li>
            </ul>
          </>
        )}
      </details>
    </div>
  );
}

function ShareButton({ text }: { text: string }) {
  const { t } = useLang();
  function share() {
    const msg = `${text}\n${location.origin}/ask`;
    // Phones open the share sheet (WhatsApp is usually first); desktops open WhatsApp Web.
    if (navigator.share) navigator.share({ text: msg }).catch(() => {});
    else window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  }
  return (
    <button onClick={share} className="mt-3 rounded-full bg-white/20 px-4 py-1.5 text-sm font-semibold text-white hover:bg-white/30">
      📤 {t("share")}
    </button>
  );
}

// This mandi's own daily price over the last 14 days, as a tiny line. Hidden with < 2 days.
function Sparkline({ points, label }: { points?: [string, number][]; label: string }) {
  if (!points || points.length < 2) return null;
  const ys = points.map(([, v]) => v);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = hi - lo || 1; // flat line when every day had the same price
  const w = 120;
  const h = 24;
  const xy = ys.map((v, i) => `${((i / (ys.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / span) * (h - 4)).toFixed(1)}`);
  const desc = `${label}: ${rupee(lo)} – ${rupee(hi)}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={desc} className="mt-1 text-leaf-600">
      <title>{desc}</title>
      <polyline points={xy.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function MoneyRow({ label, sub, value, width, cls, strong }: { label: string; sub?: string; value: string; width: number; cls: string; strong?: boolean }) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className={strong ? "font-bold text-ink-900" : "text-ink-800"}>
          {label}
          {sub && <span className="block text-xs text-ink-500">{sub}</span>}
        </span>
        <span className={`shrink-0 font-display ${strong ? "text-2xl font-extrabold text-leaf-800" : "text-lg font-bold"}`}>{value}</span>
      </div>
      <div className="mt-1 h-3 overflow-hidden rounded-full bg-white/80">
        <div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.min(100, Math.max(width > 0 ? 1.5 : 0, width * 100))}%` }} />
      </div>
    </li>
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
