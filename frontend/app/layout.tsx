import type { Metadata, Viewport } from "next";
import { Baloo_2, Mukta } from "next/font/google";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { LangProvider } from "@/lib/i18n";
import "./globals.css";

// Mukta covers Devanagari and Latin, so Hindi and numbers share one typeface.
const mukta = Mukta({
  variable: "--font-mukta",
  subsets: ["devanagari", "latin"],
  weight: ["400", "600", "700"],
});
// Baloo 2 for headlines: rounded, like hand-painted mandi and truck signage. Also Devanagari.
const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["devanagari", "latin"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: { default: "Harvest Compass — कौन सी मंडी, कौन सा दिन", template: "%s · Harvest Compass" },
  description:
    "A voice agent in English and 22 Indian languages for soybean and onion farmers across India: the mandi that pays most after transport, and dry days to harvest. Live public data, checked and shown.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#eef5fc" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${mukta.variable} ${baloo.variable} flex flex-col font-sans antialiased`}>
        <LangProvider>
          <SiteHeader />
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </LangProvider>
      </body>
    </html>
  );
}
