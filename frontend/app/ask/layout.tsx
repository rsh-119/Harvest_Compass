import type { Metadata } from "next";

export const metadata: Metadata = { title: "Ask" };

export default function AskLayout({ children }: { children: React.ReactNode }) {
  return children;
}
