"use client";

// The farmer's language. The agent (questions, answers, voice) works in all of these; the page's
// own labels are written in English and Hindi, and other languages show the English labels.
// Mirrors backend/app/languages.py (voice = Sarvam bulbul:v4-flash has a voice for it).
import { createContext, useContext, useEffect, useState } from "react";

export const LANGS = [
  { code: "en", native: "English", english: "English", voice: true },
  { code: "hi", native: "हिन्दी", english: "Hindi", voice: true },
  { code: "bn", native: "বাংলা", english: "Bengali", voice: true },
  { code: "mr", native: "मराठी", english: "Marathi", voice: true },
  { code: "te", native: "తెలుగు", english: "Telugu", voice: true },
  { code: "ta", native: "தமிழ்", english: "Tamil", voice: true },
  { code: "gu", native: "ગુજરાતી", english: "Gujarati", voice: true },
  { code: "kn", native: "ಕನ್ನಡ", english: "Kannada", voice: true },
  { code: "pa", native: "ਪੰਜਾਬੀ", english: "Punjabi", voice: true },
  { code: "ml", native: "മലയാളം", english: "Malayalam", voice: false },
  { code: "od", native: "ଓଡ଼ିଆ", english: "Odia", voice: false },
  { code: "ur", native: "اردو", english: "Urdu", voice: false },
  { code: "as", native: "অসমীয়া", english: "Assamese", voice: false },
  { code: "mai", native: "मैथिली", english: "Maithili", voice: false },
  { code: "ne", native: "नेपाली", english: "Nepali", voice: false },
  { code: "kok", native: "कोंकणी", english: "Konkani", voice: false },
  { code: "doi", native: "डोगरी", english: "Dogri", voice: false },
  { code: "sd", native: "سنڌي", english: "Sindhi", voice: false },
  { code: "ks", native: "كٲشُر", english: "Kashmiri", voice: false },
  { code: "mni", native: "মৈতৈলোন্", english: "Manipuri", voice: false },
  { code: "brx", native: "बड़ो", english: "Bodo", voice: false },
  { code: "sat", native: "ᱥᱟᱱᱛᱟᱲᱤ", english: "Santali", voice: false },
  { code: "sa", native: "संस्कृतम्", english: "Sanskrit", voice: false },
] as const;
export type Lang = (typeof LANGS)[number]["code"];

const EN = {
  ask_title: "Ask about your crop",
  ask_sub: "Live mandi prices, road distances and two weather models, with the source of every number.",
  waking: "⏳ The server is waking up. This can take about a minute…",
  down: "Couldn't reach the server.",
  unreachable: "Couldn't reach the server. Please try again in a little while.",
  stt_failed: "Couldn't understand the recording. Please speak again or type.",
  mic_denied: "Microphone permission was denied. You can type your question instead.",
  yes_qty: "Yes, the quantity is right",
  yes: "Yes",
  answer_label: "Type or speak your answer",
  ask_label: "Ask about your crop, by voice or text",
  placeholder: "e.g. I have 40 quintals of soybean, village Sanwer, Indore…",
  stop: "⏹ Stop",
  speak: "🎤 Speak",
  thinking: "Thinking…",
  ask: "Ask",
  examples: "Examples (tap one):",
  listen: "Listen to the answer",
  no_voice: "Spoken replies aren't available in {lang} yet; the answer is shown as text.",
  conf_high: "Confidence: high",
  conf_medium: "Confidence: medium",
  conf_low: "Confidence: low",
  trace: "What the agent is doing",
  best: "Best mandi",
  same_town: "in the same town",
  by_road: "{km} km by road",
  about_min: "about {min} min",
  net_q: "Net price / quintal",
  net_total: "Total net ({q} q)",
  bad_day: "Bad-day price / q",
  little_history: "too little history",
  price_used: "Price used {p}",
  median_of: "(median of last {n} reports)",
  latest: "(latest price)",
  modal_today: "today's modal price {p}",
  price_date: "price date {d}",
  days_old: "({n} days old)",
  nearer: "{m} pays only {p}/q more but is {km} km farther, so the nearer mandi is recommended.",
  runner_up: "Second:",
  ru_lower: "price {p} lower",
  ru_higher: "price {p} higher, but transport {t}/q more",
  ru_total: "— {p}/q less overall.",
  safe_days: "Safe days to harvest and transport",
  dry: "☀️ dry",
  rain: "🌧 rain possible",
  uncertain: " · uncertain",
  no_forecast: "no forecast yet (beyond 7 days)",
  wait_q: "Wait {n} days?",
  no_trend: "Not enough history to read a price trend.",
  trend: "From the last 14 days' trend, the price may change by about {p}/q",
  rain_risk: "rain risk {p}%",
  trend_note: "This is a trend, not a forecast.",
  map: "Map",
  compare: "Mandis compared",
  col_mandi: "Mandi",
  col_price: "Price (7 days)",
  col_dist: "Distance",
  col_transport: "Transport",
  col_net: "Net/q",
  same_town_short: "same town",
  costs: "Cost breakdown ({m})",
  c_price: "Price: {p} × {q} q = {t}",
  c_transport: "Transport: {trips} trips × 2 (both ways) × {km} km × {r}/km = −{t}",
  c_hammali: "Hammali/weighing: {v}",
  c_hammali_none: "not added (fill in below if you pay it; each mandi committee sets the rate)",
  c_fee: "The mandi fee is paid by the buyer, not deducted from the farmer (MP Krishi Upaj Mandi Adhiniyam 1972, Sec 19(2)).",
  c_net: "Net: {t}",
  f_rate: "Vehicle ₹/km",
  f_cap: "Quintals per trip",
  f_hammali: "Hammali/weighing ₹/q (if you pay it)",
  recalc: "Recalculate",
  excluded: "Mandis left out ({n}) — why?",
  sources: "Data sources",
  s_today: "Today's prices",
  s_history: "Price history",
  s_weather: "Weather",
  s_roads: "Road distance",
  health: "Source status",
  usage: "Last {d} days: {n} questions · median {p50} s, 95% within {p95} s · repaired {fb}% · invented numbers caught: {inv}",
  switches: "Test switches",
  switches_on: "({n} on)",
  switches_note: "The chosen source is skipped on the next question, so you can watch the agent recover. Nothing fake is filled in.",
  st_live: "live",
  st_cache: "cache",
  st_stale_cache: "old cache",
  st_error: "failed",
  language: "Language",
};
type Key = keyof typeof EN;

const HI: Partial<Record<Key, string>> = {
  ask_title: "अपनी फसल के बारे में पूछें",
  ask_sub: "लाइव मंडी भाव, सड़क की दूरी और दो मौसम मॉडल से — हर अंक का स्रोत साथ में।",
  waking: "⏳ सर्वर जाग रहा है, लगभग 1 मिनट लग सकता है…",
  down: "सर्वर से संपर्क नहीं हो पाया।",
  unreachable: "सर्वर से संपर्क नहीं हो पाया। थोड़ी देर बाद फिर कोशिश करें।",
  stt_failed: "आवाज़ समझ नहीं आई। कृपया फिर बोलें या लिखें।",
  mic_denied: "माइक की अनुमति नहीं मिली। आप लिखकर पूछ सकते हैं।",
  yes_qty: "हाँ, मात्रा सही है",
  yes: "हाँ",
  answer_label: "जवाब लिखें या बोलें",
  ask_label: "अपनी फसल के बारे में पूछें — बोलकर या लिखकर",
  placeholder: "जैसे: 40 क्विंटल सोयाबीन है, गाँव सांवेर, इंदौर…",
  stop: "⏹ रोकें",
  speak: "🎤 बोलें",
  thinking: "सोच रहा हूँ…",
  ask: "पूछें",
  examples: "उदाहरण (टैप करें):",
  listen: "जवाब सुनें",
  no_voice: "{lang} में आवाज़ वाला जवाब अभी उपलब्ध नहीं है; जवाब लिखकर दिखेगा।",
  conf_high: "भरोसा: ऊँचा",
  conf_medium: "भरोसा: मध्यम",
  conf_low: "भरोसा: कम",
  trace: "एजेंट क्या कर रहा है",
  best: "सबसे अच्छी मंडी",
  same_town: "उसी कस्बे में",
  by_road: "{km} km सड़क से",
  about_min: "लगभग {min} मिनट",
  net_q: "शुद्ध भाव / क्विंटल",
  net_total: "कुल शुद्ध ({q} क्विं.)",
  bad_day: "बुरे दिन का भाव / क्विं.",
  little_history: "इतिहास कम",
  price_used: "हिसाब का भाव {p}",
  median_of: "(पिछले {n} रिपोर्ट का median)",
  latest: "(ताज़ा भाव)",
  modal_today: "आज का मॉडल भाव {p}",
  price_date: "भाव की तारीख {d}",
  days_old: "({n} दिन पुराना)",
  nearer: "{m} सिर्फ़ {p}/क्विं. ज़्यादा देती, पर {km} km और दूर है, इसलिए पास वाली मंडी बताई।",
  runner_up: "दूसरे नंबर पर",
  ru_lower: "भाव {p} कम",
  ru_higher: "भाव {p} ज़्यादा, पर भाड़ा {t}/क्विं. ज़्यादा",
  ru_total: "— कुल मिलाकर {p}/क्विं. कम।",
  safe_days: "कटाई / ढुलाई के लिए सुरक्षित दिन",
  dry: "☀️ सूखा",
  rain: "🌧 बारिश संभव",
  uncertain: " · अनिश्चित",
  no_forecast: "पूर्वानुमान अभी उपलब्ध नहीं (7 दिन से आगे)",
  wait_q: "{n} दिन रुकें तो?",
  no_trend: "भाव का रुझान निकालने लायक इतिहास नहीं।",
  trend: "पिछले 14 दिन के रुझान से भाव लगभग {p}/क्विं.",
  rain_risk: "बारिश का जोखिम {p}%",
  trend_note: "यह रुझान है, पूर्वानुमान नहीं।",
  map: "नक्शा",
  compare: "मंडियों की तुलना",
  col_mandi: "मंडी",
  col_price: "भाव (7 दिन)",
  col_dist: "दूरी",
  col_transport: "भाड़ा",
  col_net: "शुद्ध/क्विं.",
  same_town_short: "उसी कस्बे",
  costs: "खर्च का हिसाब ({m})",
  c_price: "भाव: {p} × {q} क्विं. = {t}",
  c_transport: "भाड़ा: {trips} चक्कर × 2 (आना-जाना) × {km} km × {r}/km = −{t}",
  c_hammali: "हम्माली/तुलाई: {v}",
  c_hammali_none: "नहीं जोड़ी (आप देते हों तो नीचे भरें — दर मंडी समिति तय करती है)",
  c_fee: "मंडी शुल्क खरीदार देता है, किसान से नहीं कटता (म.प्र. कृषि उपज मंडी अधिनियम 1972, धारा 19(2))।",
  c_net: "शुद्ध: {t}",
  f_rate: "भाड़ा ₹/km",
  f_cap: "गाड़ी में क्विंटल",
  f_hammali: "हम्माली/तुलाई ₹/क्विं. (अगर आप देते हैं)",
  recalc: "दोबारा हिसाब करें",
  excluded: "छोड़ी गई मंडियाँ ({n}) — क्यों?",
  sources: "डेटा के स्रोत",
  s_today: "आज के भाव",
  s_history: "भाव का इतिहास",
  s_weather: "मौसम",
  s_roads: "सड़क की दूरी",
  health: "स्रोत स्थिति",
  usage: "पिछले {d} दिन: {n} सवाल · आधे {p50} s में, 95% {p95} s में · रास्ता बदला {fb}% · गढ़े गए अंक पकड़े: {inv}",
  switches: "टेस्ट स्विच",
  switches_on: "({n} चालू)",
  switches_note: "चुना गया स्रोत अगले सवाल में बुलाया नहीं जाएगा, ताकि आप एजेंट को रास्ता बदलते देख सकें। कोई नकली डेटा नहीं भरा जाता।",
  st_live: "लाइव",
  st_cache: "कैश",
  st_stale_cache: "पुराना कैश",
  st_error: "विफल",
  language: "भाषा",
};

export type T = (key: Key, vars?: Record<string, string | number>) => string;

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: T; locale: string };
const LangContext = createContext<Ctx | null>(null);
const STORE = "hc-lang";

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en"); // default English
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE);
      if (saved && LANGS.some((l) => l.code === saved)) setLangState(saved as Lang);
    } catch {} // storage blocked: stay on English
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  function setLang(l: Lang) {
    setLangState(l);
    try {
      localStorage.setItem(STORE, l);
    } catch {}
  }
  const t: T = (key, vars) => {
    let s = (lang === "hi" ? HI[key] : undefined) ?? EN[key];
    for (const [k, v] of Object.entries(vars ?? {})) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
  // Dates in the farmer's own language where the browser knows it (falls back to English).
  const locale = `${lang}-IN`;
  return <LangContext.Provider value={{ lang, setLang, t, locale }}>{children}</LangContext.Provider>;
}

export function useLang(): Ctx {
  const c = useContext(LangContext);
  if (!c) throw new Error("useLang outside LangProvider");
  return c;
}

export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useLang();
  return (
    <label className={compact ? "flex items-center" : "flex flex-col gap-1 text-sm font-medium text-ink-600"}>
      <span className={compact ? "sr-only" : ""}>{t("language")}</span>
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className={
          compact
            ? "rounded-full border border-white bg-white/70 py-1.5 pr-2 pl-3 text-sm font-semibold text-ink-800"
            : "rounded-2xl border border-white bg-white/80 p-3 text-lg text-ink-900"
        }
      >
        {LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.native === l.english ? l.native : `${l.native} · ${l.english}`}
          </option>
        ))}
      </select>
    </label>
  );
}
