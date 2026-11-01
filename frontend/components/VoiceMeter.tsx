"use client";

import { useEffect, useRef } from "react";

const BARS = 28;

/** Live loudness of a mic stream: rings around the mic button (ringRef) and a bar strip.
 * Drawn straight to the DOM each frame, so React doesn't re-render 60 times a second. */
export function VoiceMeter({
  stream,
  maxSeconds,
  label,
  ringRef,
}: {
  stream: MediaStream;
  maxSeconds: number;
  label: string;
  ringRef: React.RefObject<HTMLSpanElement | null>;
}) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const clock = useRef<HTMLSpanElement>(null);
  const progress = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const freq = new Uint8Array(analyser.frequencyBinCount);
    const wave = new Uint8Array(analyser.fftSize);
    const ring = ringRef.current;
    const t0 = performance.now();
    let level = 0;
    let raf = 0;

    const draw = () => {
      analyser.getByteFrequencyData(freq);
      analyser.getByteTimeDomainData(wave);
      let sum = 0;
      for (const v of wave) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / wave.length);
      level += (Math.min(1, rms * 4) - level) * 0.3; // ease so the rings breathe, not jitter

      // voice energy sits in the lower bins: spread those over the bars, mirrored from the middle
      const half = BARS / 2;
      for (let i = 0; i < BARS; i++) {
        const k = Math.abs(i - half + 0.5);
        const v = freq[Math.floor((k / half) * freq.length * 0.45)] / 255;
        const el = bars.current[i];
        if (el) el.style.transform = `scaleY(${Math.max(0.08, v)})`;
      }
      ring?.style.setProperty("--lvl", level.toFixed(3));
      const s = (performance.now() - t0) / 1000;
      if (clock.current) clock.current.textContent = `0:${String(Math.floor(s)).padStart(2, "0")}`;
      if (progress.current) progress.current.style.transform = `scaleX(${Math.min(1, s / maxSeconds)})`;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ctx.close();
      ring?.style.setProperty("--lvl", "0");
    };
  }, [stream, maxSeconds, ringRef]);

  return (
    <div className="mt-2 overflow-hidden rounded-2xl bg-red-50 ring-1 ring-red-200" role="status" aria-live="polite">
      <div className="flex items-center gap-3 px-3 py-2">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
        </span>
        <span className="shrink-0 text-sm font-semibold text-red-800">{label}</span>
        <div className="flex h-8 min-w-0 flex-1 items-center justify-center gap-[3px]" aria-hidden>
          {Array.from({ length: BARS }, (_, i) => (
            <span
              key={i}
              ref={(el) => {
                bars.current[i] = el;
              }}
              className="h-full w-1 origin-center rounded-full bg-gradient-to-t from-red-600 to-orange-400 transition-transform duration-75 motion-reduce:transition-none"
              style={{ transform: "scaleY(0.08)" }}
            />
          ))}
        </div>
        <span className="shrink-0 font-mono text-sm tabular-nums text-red-800">
          <span ref={clock}>0:00</span>
          <span className="text-red-400"> / 0:{maxSeconds}</span>
        </span>
      </div>
      <div ref={progress} className="h-1 origin-left bg-red-500/70" style={{ transform: "scaleX(0)" }} />
    </div>
  );
}
