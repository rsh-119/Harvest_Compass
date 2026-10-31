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
import { LANGS, LanguagePicker, useLang, type T } from "@/lib/i18n";

const STATUS_KEY = { live: "st_live", cache: "st_cache", stale_cache: "st_stale_cache", error: "st_error" } as const;
const status = (t: T, s: string) => (s in STATUS_KEY ? t(STATUS_KEY[s as keyof typeof STATUS_KEY]) : s);

const MandiMap = dynamic(() => import("@/components/MandiMap"), { ssr: false });

// No vehicle defaults: the agent asks. Other charges start at 0 = "none entered" (labelled so).
const DEFAULT_PARAMS: Params = { other_charges_per_q: 0 };

const rupee = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const fmtTime = (iso: string | null | undefined, locale: string) =>
  iso ? new Date(iso).toLocaleString(locale, { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—";
const dateOf = (iso: string) => new Date(iso + "T00:00:00");
const stepText = (e: TraceEvent, lang: string) => (lang === "hi" && e.hi ? e.hi : e.en);

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

// One turn in the conversation. Agent turns keep their final payload and the steps that produced them.
type Msg = { role: "user" | "agent"; text: string; final?: Final; trace?: TraceEvent[] };

export default function AskPage() {
  const { lang, t } = useLang();
  const langInfo = LANGS.find((l) => l.code === lang)!;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [trace, setTrace] = useState<TraceEvent[]>([]); // live steps of the running question
  const [shown, setShown] = useState<number | null>(null); // agent turn whose steps the side panel shows
  const [final, setFinal] = useState<Final | null>(null);
  const [pending, setPending] = useState<Clarify | null>(null); // question we're waiting on
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  // Spoken replies cost Sarvam credits: only when the farmer spoke, or switched this on.
  const [readAloud, setReadAloud] = useState(false);
  const lastSpoken = useRef(false); // was the latest question asked with the mic?
  const recorder = useRef<MediaRecorder | null>(null);
  const lastText = useRef("");
  const lastMsg = useRef<HTMLLIElement | null>(null);
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

  // Bring each new turn into view.
  useEffect(() => {
    lastMsg.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [msgs.length, busy]);

  function play(url: string) {
    new Audio(url).play().catch(() => {}); // autoplay blocked: the speaker button still works
  }

  async function run(body: AskBody, said: string) {
    setMsgs((m) => [...m, { role: "user", text: said }]);
    setBusy(true);
    setError(null);
    setTrace([]);
    setShown(null);
    setAudioUrl(null);
    const steps: TraceEvent[] = [];
    try {
      await ask({ ...body, params: { ...params, ...body.params }, faults, speak: langInfo.voice && (readAloud || lastSpoken.current), lang }, (e) => {
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
          const reply = f.answer ?? (f.clarify ? (f.clarify.text ?? f.clarify.en) : "");
          if (reply) setMsgs((m) => [...m, { role: "agent", text: reply, final: f, trace: [...steps] }]);
        } else {
          steps.push(e as TraceEvent);
          setTrace([...steps]);
          if (e.event === "error") setError(lang === "hi" ? (e as TraceEvent).hi || (e as TraceEvent).en : (e as TraceEvent).en);
        }
      });
    } catch (err) {
      const msg = err instanceof Error && err.message.includes("—") ? err.message : null; // our 429 text
      setError(msg ?? t("unreachable"));
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
      const kg = parseFloat(q.replace(/[^\d.]/g, ""));
      if (pending.needs === "bori_kg" && kg > 0) {
        body.params = { ...params, bori_kg: kg };
        setParams(body.params); // keep it for the next question in this conversation
      }
    } else {
      lastText.current = q;
    }
    setText("");
    run(body, q);
  }

  function confirmPlace(p: Place) {
    run({ text: lastText.current, previous: pending?.intent, place: p }, `${t("yes")}, ${p.name}`);
  }

  function confirmQty() {
    const p = { ...params, qty_confirmed: true };
    setParams(p);
    run({ text: lastText.current, previous: pending?.intent, place: pending?.place, params: p }, t("yes_qty"));
  }

  function recalc() {
    if (!final?.intent || !final.place) return;
    run({ text: lastText.current, previous: final.intent, place: final.place }, t("recalc"));
  }

  function reset() {
    setMsgs([]);
    setTrace([]);
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
        try {
          const said = await transcribe(new Blob(chunks, { type: rec.mimeType }), lang);
          setText(said);
          submit(said, true);
        } catch (err) {
          setError(err instanceof Error && err.message.includes("limit") ? t("voice_limit") : t("stt_failed"));
        }
      };
      rec.start();
      recorder.current = rec;
      setRecording(true);
      setTimeout(() => rec.state === "recording" && rec.stop(), 25_000); // Sarvam REST limit ~30 s
    } catch {
      setError(t("mic_denied"));
    }
  }

  // The latest answer with a result gets the full breakdown; older ones get a one-line summary.
  const lastResultAt = msgs.findLastIndex((m) => m.final?.result?.best);
  const lastAgentAt = msgs.findLastIndex((m) => m.role === "agent");
  const panelSteps = busy ? trace : (msgs[shown ?? lastAgentAt]?.trace ?? trace);

  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 pt-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl leading-tight font-bold text-ink-900 sm:text-4xl">{t("ask_title")}</h1>
            <p className="mt-1 text-ink-600">{t("ask_sub")}</p>
          </div>
          {msgs.length > 0 && (
            <button onClick={reset} disabled={busy} className="btn-ghost px-4 py-2 text-sm disabled:opacity-50">
              ＋ {t("new_chat")}
            </button>
          )}
        </header>
        {server === "waking" && (
          <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900" role="status">
            {t("waking")}
          </p>
        )}
        {server === "down" && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-800">{t("down")}</p>}

        {msgs.length === 0 && !busy && (
          <section className="glass mt-6 p-6 sm:p-8">
            <p className="text-lg text-ink-700">{t("welcome")}</p>
            <p className="mt-5 text-sm font-semibold text-ink-500">{t("examples")}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {[t("ex1"), t("ex2")].map((ex) => (
                <button
                  key={ex}
                  onClick={() => setText(ex)}
                  className="rounded-2xl bg-white/80 p-4 text-left text-ink-800 shadow-sm ring-1 ring-white hover:bg-white"
                >
                  {ex}
                </button>
              ))}
            </div>
          </section>
        )}

        <ol className="mt-6 space-y-5" aria-live="polite">
          {msgs.map((m, i) => {
            const ref = i === msgs.length - 1 && !busy ? lastMsg : undefined;
            if (m.role === "user")
              return (
                <li key={i} ref={ref} className="flex scroll-mt-24 justify-end">
                  <p className="max-w-[85%] rounded-3xl rounded-br-md bg-ink-900 px-5 py-3 text-lg text-white">{m.text}</p>
                </li>
              );
            const r = m.final?.result;
            const asking = i === lastAgentAt && pending && m.final?.clarify === pending ? pending : null;
            return (
              <li key={i} ref={ref} className="scroll-mt-24 space-y-4">
                <div className="flex items-start gap-3">
                  <Avatar />
                  <div className={`min-w-0 flex-1 rounded-3xl rounded-tl-md p-5 ${asking ? "bg-amber-50 ring-1 ring-amber-200" : "glass-strong"}`}>
                    <p className="text-lg leading-relaxed text-ink-900">
                      {m.text}
                      {i === lastAgentAt && audioUrl && <ListenButton url={audioUrl} />}
                    </p>
                    {asking?.needs === "confirm_qty" && (
                      <button
                        onClick={confirmQty}
                        disabled={busy}
                        className="mt-3 rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-sm ring-1 ring-amber-300 hover:bg-amber-100"
                      >
                        {t("yes_qty")}
                      </button>
                    )}
                    {asking?.options && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {asking.options.map((p) => (
                          <button
                            key={p.display_name}
                            onClick={() => confirmPlace(p)}
                            disabled={busy}
                            className="rounded-2xl bg-white px-4 py-2 text-left text-sm shadow-sm ring-1 ring-amber-300 hover:bg-amber-100"
                          >
                            <b>
                              {t("yes")}, {p.name}
                            </b>
                            <span className="block text-xs text-ink-500">{p.display_name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {r?.confidence && (
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${CONF_CLS[r.confidence]}`} title={r.confidence_reasons?.join("; ")}>
                          {t(`conf_${r.confidence}`)}
                        </span>
                      )}
                      {m.trace && m.trace.length > 0 && (
                        <a
                          href="#activity"
                          onClick={() => setShown(i)}
                          className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-leaf-800 ring-1 ring-ink-100 hover:bg-white"
                        >
                          🔍 {t("steps_n", { n: m.trace.length })}
                        </a>
                      )}
                    </div>
                  </div>
                </div>
                {r?.best && m.final?.place && i === lastResultAt && (
                  <ResultView r={r} place={m.final.place} params={params} setParams={setParams} recalc={recalc} busy={busy} />
                )}
                {r?.best && i !== lastResultAt && (
                  <p className="ml-12 rounded-2xl bg-white/60 px-4 py-2 text-sm text-ink-700">
                    {t("best")}: <b>{r.best.market}</b> · {rupee(r.best.net_per_quintal)}/q
                  </p>
                )}
              </li>
            );
          })}
          {busy && (
            <li ref={lastMsg} className="flex scroll-mt-24 items-start gap-3">
              <Avatar />
              <div className="glass rounded-3xl rounded-tl-md px-5 py-4">
                <p className="flex items-center gap-2 font-semibold text-ink-800">
                  <span className="flex gap-1" aria-hidden>
                    {[0, 1, 2].map((k) => (
                      <span key={k} className="h-2 w-2 animate-bounce rounded-full bg-leaf-600" style={{ animationDelay: `${k * 0.15}s` }} />
                    ))}
                  </span>
                  {t("thinking")}
                </p>
                {trace.length > 0 && (
                  <p className="mt-1 text-sm text-ink-600">
                    {EVENT_ICON[trace[trace.length - 1].event] ?? "•"} {stepText(trace[trace.length - 1], lang)}
                  </p>
                )}
              </div>
            </li>
          )}
        </ol>

        {/* The composer stays at the bottom of the screen while scrolling through answers. */}
        <section className="glass-strong sticky bottom-3 z-[500] mt-6 p-3 sm:p-4">
          {error && <p className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">{error}</p>}
          <label htmlFor="q" className="sr-only">
            {pending ? t("answer_label") : t("ask_label")}
          </label>
          <div className="flex items-end gap-2">
            <textarea
              id="q"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), submit())}
              rows={2}
              placeholder={pending ? t("answer_label") : t("placeholder")}
              className="min-w-0 flex-1 resize-none rounded-2xl border border-white bg-white/90 p-3 text-lg shadow-inner focus:border-leaf-600 focus:outline-none"
            />
            <button
              onClick={toggleMic}
              disabled={busy && !recording}
              aria-pressed={recording}
              aria-label={recording ? t("stop") : t("speak")}
              className={`grid h-12 w-12 shrink-0 place-items-center rounded-full text-xl text-white ${
                recording ? "animate-pulse bg-red-600" : "bg-ink-800 hover:bg-ink-700"
              } disabled:opacity-50`}
            >
              {recording ? "⏹" : "🎤"}
            </button>
            <button onClick={() => submit()} disabled={busy || !text.trim()} className="btn-primary h-12 shrink-0 px-5 disabled:opacity-50">
              {busy ? "…" : t("ask")}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-600">
            <div className="w-44">
              <LanguagePicker compact />
            </div>
            {langInfo.voice ? (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={readAloud} onChange={(e) => setReadAloud(e.target.checked)} />
                {t("read_aloud")}
              </label>
            ) : (
              <span className="text-xs">{t("no_voice", { lang: langInfo.native })}</span>
            )}
          </div>
        </section>
      </div>

      <aside className="space-y-3 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto">
        <Activity events={panelSteps} busy={busy} />
        {srcHealth && <Status h={srcHealth} faults={faults} setFaults={setFaults} />}
      </aside>
    </main>
  );
}

function Avatar() {
  return (
    <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-marigold-300 to-leaf-600 text-lg">
      🧭
    </span>
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

function Activity({ events, busy }: { events: TraceEvent[]; busy: boolean }) {
  const { lang, t, locale } = useLang();
  return (
    <section id="activity" className="glass scroll-mt-24 p-4">
      <h2 className="flex items-center gap-2 font-semibold text-ink-800">
        {t("trace")}
        {busy && <span className="inline-block h-2 w-2 animate-ping rounded-full bg-leaf-600" />}
      </h2>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-ink-500">{t("activity_idle")}</p>
      ) : (
        <ol className="relative mt-3 space-y-2 text-sm before:absolute before:top-2 before:bottom-2 before:left-[0.85rem] before:w-px before:bg-ink-200">
          {events.map((e, i) => (
            <li key={i} className="relative flex gap-2">
              <span
                aria-hidden
                className={`z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm ring-2 ring-white ${
                  e.event === "repair" ? "bg-amber-100" : e.event === "audit_reject" || e.event === "error" ? "bg-red-100" : "bg-white"
                }`}
              >
                {EVENT_ICON[e.event] ?? "•"}
              </span>
              <span className="min-w-0 pt-1">
                <span className="block break-words text-ink-800">{stepText(e, lang)}</span>
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
    </section>
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
  const { lang, t, locale } = useLang();
  const b = r.best!;
  const day = (iso: string) => dateOf(iso).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "long" });
  const gross = b.price_used * r.quantity_q;
  const nets = r.ranking.map((m) => m.net_per_quintal);
  const top = Math.max(...nets);
  const low = Math.min(...nets);
  const floor = low - (top - low || top * 0.05); // bars start below the lowest, so the last one isn't empty

  return (
    <div className="space-y-4 lg:ml-12">
      {/* 1. The decision */}
      <section className="rounded-[2rem] bg-gradient-to-br from-leaf-700 to-leaf-900 p-6 text-white shadow-xl sm:p-8">
        <p className="text-sm font-semibold tracking-wide text-leaf-100 uppercase">{t("best")}</p>
        <h2 className="mt-1 font-display text-4xl font-extrabold sm:text-5xl">{b.market}</h2>
        <p className="mt-1 text-leaf-100">
          📍 {b.district} · {b.road_km < 1 ? t("same_town") : t("by_road", { km: b.road_km })}
          {b.road_km >= 1 && ` · ${t("about_min", { min: Math.round(b.drive_min) })}`}
        </p>
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
                {t("ru_total", { p: rupee(r.runner_up_gap.net_per_quintal) })}
              </p>
            )}
          </div>
        )}
        <p className="mt-4 text-xs text-leaf-100">
          {t("price_used", { p: rupee(b.price_used) })} {b.price_days > 1 ? t("median_of", { n: b.price_days }) : t("latest")} · {b.variety} ·{" "}
          {t("price_date", { d: day(b.arrival_date) })}
          {b.age_days > 0 && ` ${t("days_old", { n: b.age_days })}`}
        </p>
      </section>

      {/* 2. Weather and waiting */}
      {(r.harvest_days?.length || r.wait) && (
        <section className="glass p-5 sm:p-6">
          {r.harvest_days && r.harvest_days.length > 0 && (
            <>
              <h3 className="font-display text-2xl font-bold">🌾 {t("weather")}</h3>
              <p className="text-sm text-ink-600">{t("safe_days")}</p>
              <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-7">
                {r.harvest_days.map((d) => {
                  const ok = d.both_dry && !d.uncertain;
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
                        {d.both_dry ? "☀️" : "🌧️"}
                      </p>
                      <p className={`mt-1 text-xs font-semibold ${ok ? "text-leaf-800" : "text-amber-900"}`}>
                        {(d.both_dry ? t("dry") : t("rain")).replace(/^\S+\s/, "")}
                        {d.uncertain && t("uncertain")}
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
        <p className="mt-3 text-xs text-ink-500">{r.region === "Madhya Pradesh" ? t("c_fee") : t("c_fee_other")}</p>

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
              <p className="mt-1 text-xs text-ink-500">
                {t("col_price")} {rupee(m.price_used)} · {m.road_km < 1 ? t("same_town_short") : `${Math.round(m.road_km)} km`} ·{" "}
                {t("col_transport")} {rupee(m.transport_total)}
                {m.age_days > 0 && ` · ${t("days_old", { n: m.age_days })}`}
                {i > 0 && ` · ${t("vs_best", { p: rupee(top - m.net_per_quintal) })}`}
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
