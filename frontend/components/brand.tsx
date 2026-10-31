// Shared by the client header and the server footer, so it must not be a client module.
// Labels come from the language files (common.nav.<key>).
export const NAV = [
  { href: "/how-it-works", key: "how" },
  { href: "/results", key: "results" },
  { href: "/data", key: "data" },
  { href: "/about", key: "about" },
] as const;

// The agent's seven steps (names in how.flow): which use the language model, and their icons.
export const STEP_AI = [true, false, false, false, false, false, true];
export const STEP_ICONS = ["🗣️", "🧭", "📡", "🔍", "🛟", "🧮", "🔊"];

export function Compass({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7cf6b" />
          <stop offset="1" stopColor="#2e7d4f" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="14" fill="url(#cg)" />
      <circle cx="16" cy="16" r="10.5" fill="#fff" fillOpacity=".85" />
      <path d="M16 7l3 9-3 9-3-9z" fill="#17352f" />
      <path d="M16 7l3 9h-6z" fill="#e8a317" />
    </svg>
  );
}
