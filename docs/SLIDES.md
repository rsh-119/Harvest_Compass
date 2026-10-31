# Slide deck content (6 slides)

## 1. Harvest Compass — हार्वेस्ट कम्पास
- Which mandi, which day: a Hindi voice agent for soybean and onion farmers in Madhya Pradesh
- Team: _(names, roles)_ · FORGE '26
- Live link: _(Vercel URL)_

## 2. The problem
- A farmer with 40 quintals sells at the nearest mandi, or wherever a trader says
- Prices differ between mandis, and transport eats the difference. Published prices can be stale or come from one odd lot
- Rain on harvest or transport day spoils the crop
- The data is public (data.gov.in, weather models) but scattered, in English, and unchecked

## 3. The solution
- Ask in Hindi, by voice or text → spoken Hindi answer in ~12 s
- Best mandi by **net ₹/quintal after round-trip transport** at the farmer's own vehicle rate, on each mandi's 7-day median price; on a close call (≤ ₹50/q) the nearer mandi
- Safe harvest and transport days where **two** weather models agree it's dry
- "What if I wait 3 days?" from the real 14-day trend, labelled *trend, not forecast*
- Asks instead of guessing: which Rampur, kg per sack, vehicle hire, unusual quantities

## 4. Architecture and what's new
- LangGraph agent: understand → plan → execute (parallel) → **audit** → repair → compute → explain
- **Visible audit:** stale, inconsistent and outlier prices rejected by name, with the reason
- **Self-repair, shown live:** a source fails → fallback to real older data with its age, or the other weather model, or a wider radius
- **Grounded LLM:** it only phrases facts we computed. A number and name validator rejects anything invented (0 invented numbers in 20 test questions)
- Every number has a source URL and a fetch time. No dummy data anywhere
- Stack: FastAPI · LangGraph · Postgres (Neon) · Next.js · Leaflet · Sarvam · OpenRouter · Open-Meteo · OSRM · OSM

## 5. Results (measured on real data)
- Backtest: 30 real villages × 60 days. Decide with only that day's data, realise the next day's price, compare with the nearest mandi
  - **Onion: +₹470/quintal mean gain** (live ranking, ₹1/q-km transport). Soybean: +₹39, about break-even, since MP soybean prices are nearly uniform
  - Ranking on a 7-day median beats one day's price in every setting, so the live agent uses it
- Grounding: 19/20 answered (1 correctly asks to confirm), **0 invented numbers**, median 11.4 s
- Model choice by test: GPT-5.6 wrote a mandi name as a different town, so deepseek with a name check

## 6. Roadmap and demo
- Demo: speak → live trace → stale mandi rejected → weather model switched off → fallback → map and net ₹ → spoken answer → wait-3-days → backtest card
- Next: real transport quotes per district, more crops and states, an SMS/IVR channel for feature phones, mandi arrival volumes, a per-district village list for better speech matching
