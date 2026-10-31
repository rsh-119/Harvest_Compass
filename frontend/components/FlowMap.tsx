"use client";

// The whole system on one screen: farmer, Sarvam voice, the agent's steps (AI or plain code),
// live data sources, and the two loops back (repair, re-check). A dot follows one question.
// Tap a box for what it does. Labels come from the language files (how.map).
import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

type Kind = "user" | "voice" | "ai" | "code" | "data";
type Id =
  | "farmer" | "stt" | "understand" | "plan" | "fetch" | "audit" | "repair" | "calc"
  | "explain" | "check" | "answer" | "tts" | "prices" | "weather" | "roads" | "places" | "cache"; // prettier-ignore

const NODES: { id: Id; kind: Kind; x: number; y: number; w: number; h: number }[] = [
  { id: "farmer", kind: "user", x: 20, y: 215, w: 150, h: 100 },
  { id: "stt", kind: "voice", x: 200, y: 36, w: 170, h: 70 },
  { id: "prices", kind: "data", x: 400, y: 40, w: 140, h: 62 },
  { id: "weather", kind: "data", x: 550, y: 40, w: 140, h: 62 },
  { id: "roads", kind: "data", x: 700, y: 40, w: 140, h: 62 },
  { id: "places", kind: "data", x: 850, y: 40, w: 140, h: 62 },
  { id: "cache", kind: "data", x: 1000, y: 40, w: 140, h: 62 },
  { id: "understand", kind: "ai", x: 210, y: 180, w: 150, h: 72 },
  { id: "plan", kind: "code", x: 390, y: 180, w: 150, h: 72 },
  { id: "fetch", kind: "code", x: 570, y: 180, w: 150, h: 72 },
  { id: "audit", kind: "code", x: 750, y: 180, w: 150, h: 72 },
  { id: "calc", kind: "code", x: 930, y: 180, w: 150, h: 72 },
  { id: "repair", kind: "code", x: 750, y: 300, w: 150, h: 72 },
  { id: "explain", kind: "ai", x: 930, y: 300, w: 150, h: 72 },
  { id: "check", kind: "code", x: 930, y: 410, w: 150, h: 72 },
  { id: "answer", kind: "code", x: 570, y: 410, w: 150, h: 72 },
  { id: "tts", kind: "voice", x: 210, y: 410, w: 170, h: 72 },
];

// The main route a question takes (animated), the side links, and the loops back.
const MAIN = [
  "M95 215 L95 71 L200 71",
  "M285 106 L285 180",
  "M360 216 L390 216",
  "M540 216 L570 216",
  "M720 216 L750 216",
  "M900 216 L930 216",
  "M1005 252 L1005 300",
  "M1005 372 L1005 410",
  "M930 446 L720 446",
  "M570 446 L380 446",
  "M210 446 L95 446 L95 315",
];
const TYPED = "M170 236 L210 236";
const TEXT_BACK = "M645 482 L645 512 L58 512 L58 315";
const DATA = [470, 620, 770, 920, 1070].map((x) => `M645 180 L${x} 102`);
const LOOPS = [
  "M825 252 L825 300", // audit -> repair
  "M750 336 L645 336 L645 252", // repair -> fetch again
  "M1080 446 C 1122 446, 1122 336, 1080 336", // check -> explain again
];
const DOT_PATH =
  "M95 215 L95 71 L285 71 L285 216 L1005 216 L1005 446 L95 446 L95 315";

const STYLE: Record<Kind, { fill: string; stroke: string; text: string }> = {
  user: { fill: "#17352f", stroke: "#17352f", text: "#ffffff" },
  voice: { fill: "#e3ebff", stroke: "#4f6fd6", text: "#1e2f6b" },
  ai: { fill: "#fbe3a6", stroke: "#c98e0c", text: "#3d2c05" },
  code: { fill: "#dcf1e3", stroke: "#2e7d4f", text: "#16402a" },
  data: { fill: "#ffffff", stroke: "#8aa39d", text: "#17352f" },
};

export default function FlowMap() {
  const { d } = useLang();
  const m = d.how.map;
  const nodes = m.nodes as Record<Id, { name: string; d: string }>;
  const tags: Record<Kind, string> = m.tags;
  const [sel, setSel] = useState<Id>("understand");
  const [motion, setMotion] = useState(false);
  useEffect(() => {
    setMotion(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  const selKind = NODES.find((n) => n.id === sel)!.kind;

  return (
    <section className="mt-14" aria-labelledby="flowmap-title">
      <h2 id="flowmap-title" className="font-display text-3xl font-bold sm:text-4xl">
        {m.title}
      </h2>
      <p className="mt-2 max-w-3xl text-lg text-ink-700">{m.sub}</p>

      <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-700">
        {(["ai", "voice", "code", "data"] as Kind[]).map((k) => (
          <li key={k} className="flex items-center gap-2">
            <span
              className="h-3.5 w-3.5 rounded"
              style={{ background: STYLE[k].fill, outline: `2px solid ${STYLE[k].stroke}` }}
            />
            {tags[k]}
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span className="h-0.5 w-6 border-t-2 border-dashed border-marigold-500" />
          {m.loop_legend}
        </li>
      </ul>

      <div className="glass-strong mt-5 overflow-x-auto p-3 sm:p-5">
        <svg viewBox="0 0 1250 530" className="min-w-[860px]" role="img" aria-label={m.title}>
          <defs>
            <marker id="fm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="#47665f" />
            </marker>
            <marker id="fm-arrow-loop" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="#c98e0c" />
            </marker>
          </defs>

          {/* The agent frame */}
          <rect x="190" y="150" width="950" height="350" rx="26" fill="rgb(255 255 255 / 0.35)" stroke="#8aa39d" strokeDasharray="4 6" />
          <text x="1125" y="172" textAnchor="end" fontSize="13" fontWeight="700" fill="#47665f">
            {m.agent}
          </text>

          {DATA.map((p, i) => (
            <path key={i} d={p} fill="none" stroke="#8aa39d" strokeWidth="1.5" className={motion ? "flow-edge flow-edge-slow" : ""} />
          ))}
          <text x="560" y="140" fontSize="12" fill="#47665f">{m.parallel}</text>

          {MAIN.map((p, i) => (
            <path key={i} d={p} fill="none" stroke="#47665f" strokeWidth="2.2" markerEnd="url(#fm-arrow)" className={motion ? "flow-edge" : ""} />
          ))}
          <path d={TYPED} fill="none" stroke="#47665f" strokeWidth="2.2" markerEnd="url(#fm-arrow)" />
          <path d={TEXT_BACK} fill="none" stroke="#47665f" strokeWidth="1.5" strokeDasharray="2 5" markerEnd="url(#fm-arrow)" />
          {LOOPS.map((p, i) => (
            <path key={i} d={p} fill="none" stroke="#c98e0c" strokeWidth="2.2" strokeDasharray="7 6" markerEnd="url(#fm-arrow-loop)" />
          ))}

          {/* Edge labels */}
          <text x="104" y="150" fontSize="12" fill="#47665f">{m.e_speech}</text>
          <text x="172" y="228" fontSize="12" fill="#47665f">{m.e_text}</text>
          <text x="652" y="394" fontSize="12" fill="#a8740a">{m.e_repair}</text>
          <text x="1124" y="394" fontSize="12" fill="#a8740a">{m.e_retry}</text>
          <text x="240" y="527" fontSize="12" fill="#47665f">{m.e_card}</text>
          <text x="392" y="436" fontSize="12" fill="#47665f">{m.e_spoken}</text>

          {NODES.map((n) => {
            const s = STYLE[n.kind];
            const on = n.id === sel;
            return (
              <g key={n.id}>
                <rect
                  x={n.x}
                  y={n.y}
                  width={n.w}
                  height={n.h}
                  rx="16"
                  fill={s.fill}
                  stroke={s.stroke}
                  strokeWidth={on ? 4 : 1.8}
                  className={on && motion ? "flow-node-on" : ""}
                />
                <foreignObject x={n.x} y={n.y} width={n.w} height={n.h}>
                  <button
                    type="button"
                    onClick={() => setSel(n.id)}
                    aria-pressed={on}
                    className="flex h-full w-full flex-col items-center justify-center rounded-2xl px-2 text-center leading-tight"
                    style={{ color: s.text }}
                  >
                    <span className="text-[15px] font-bold">{nodes[n.id].name}</span>
                    <span className="mt-0.5 text-[11px] opacity-80">{tags[n.kind]}</span>
                  </button>
                </foreignObject>
              </g>
            );
          })}

          {motion && (
            <circle r="8" fill="#e8a317" stroke="#fff" strokeWidth="3">
              <animateMotion dur="11s" repeatCount="indefinite" path={DOT_PATH} />
            </circle>
          )}
        </svg>
      </div>

      <div className="glass mt-4 flex flex-col gap-1 p-5 sm:flex-row sm:items-baseline sm:gap-4" aria-live="polite">
        <p className="flex shrink-0 items-center gap-2 font-display text-xl font-bold">
          <span className="h-3.5 w-3.5 rounded" style={{ background: STYLE[selKind].fill, outline: `2px solid ${STYLE[selKind].stroke}` }} />
          {nodes[sel].name}
        </p>
        <p className="text-lg text-ink-700">{nodes[sel].d}</p>
      </div>
      <p className="mt-2 text-sm text-ink-500">{m.tap_hint}</p>
    </section>
  );
}
