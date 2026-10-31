import type { Metadata, Viewport } from "next";
import { Mukta } from "next/font/google";
import "./globals.css";

// Mukta covers Devanagari and Latin, so Hindi and numbers share one typeface.
const mukta = Mukta({
  variable: "--font-mukta",
  subsets: ["devanagari", "latin"],
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "Harvest Compass",
  description: "कौन सी मंडी, कौन सा दिन — which mandi to sell in and which days to harvest",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="hi">
      <body className={`${mukta.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
