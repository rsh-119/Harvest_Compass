// Shared by the client header and the server footer, so it must not be a client module.
export const NAV = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/results", label: "Results" },
  { href: "/data", label: "Data & sources" },
  { href: "/about", label: "About" },
];

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
