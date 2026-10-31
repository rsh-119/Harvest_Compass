# Data sources — verified endpoints

All verified live on 2026-10-30 (IST) during M0.

## data.gov.in — current daily mandi prices ✅
- Resource: `9ef84268-d588-465a-a308-a864a43d0070` — "Current Daily Price of Various Commodities from Various Markets (Mandi)". Metadata `updated_date` 2026-10-30T17:00:48Z.
- Request: `GET https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070?api-key=KEY&format=json&limit=N&filters[state.keyword]=Madhya Pradesh&filters[commodity]=Soyabean`
- Also verified: `filters[district]=Indore`.
- Fields (lowercase): `state, district, market, commodity, variety, grade, arrival_date, min_price, max_price, modal_price`. Prices are numbers (₹/quintal).
- `arrival_date` format: `DD/MM/YYYY`.
- Response has `total` (matching rows) and `count` (rows returned). Paginate with `offset`.
- Observed 2026-10-30: MP Soyabean total=193 rows dated today; MP Onion total=55; Indore district Soyabean total=5.
- Gotchas:
  - Commodity spelling is `Soyabean`. Variety strings are inconsistent (`Yellow`, `Soyabeen`; onion: `Onion`, `Medium`, `Onion-Organic`). Grade is `FAQ` / `Non-FAQ` / `Grade C`. Like-for-like matching needs a variety+grade normalisation map.
  - Same market can appear twice (different variety). Example: Sanwer APMC Soyabeen FAQ 6900 vs Yellow FAQ 5514.
  - `min_price` can sit far below modal (Khachrod: min 2151, modal 6900). A "conservative net from min price" would be very pessimistic. Needs a team decision.
  - Market names end in ` APMC`.
  - Latency varied from 0.5 s to >60 s timeout. Needs a generous timeout, a retry and a cache.
  - The public demo key on data.gov.in pages is capped at 10 rows. Use our own key.

## data.gov.in — variety-wise daily prices (history) ✅ (partial)
- Resource: `35985678-0d79-46b4-9ed6-6f13308a1d24` — "Variety-wise Daily Market Prices Data of Commodity". `updated_date` 2026-10-29.
- Filters use Capitalised ids: `filters[State]`, `filters[District]`, `filters[Commodity]`.
- Fields: `Arrival_Date, Commodity, Commodity_Code, District, Grade, Market, Max_Price, Min_Price, Modal_Price, State, Variety`. **Prices are strings.**
- Indore Soyabean total=22068 rows going back to 2010. Default order is oldest first.
- Gotcha: market names have **no** ` APMC` suffix (`Gautampura`), unlike the current resource. Strip the suffix before joining.
- Verified with own key: `sort[Arrival_Date]=desc` works (newest first), and `filters[Arrival_Date]=29/10/2026` works (`2026-10-29` also accepted). Fetch history one day at a time with `limit=1000`.
- Lag: history has **no rows for today** (30/10 total=0) and starts at yesterday. Today's prices come from the current resource.
- Recent rows **do** carry the ` APMC` suffix (`Indore APMC`). Only old rows (2010) lack it. Normalise anyway.
- Onion has separate fruit-and-vegetable yards: `Indore APMC` vs `Indore(F&V) APMC`. Some names have a double space (`Ashta  APMC`). Normalise by collapsing whitespace. Keep F&V as its own yard, because it has different coordinates and prices.

## ⚠ data.gov.in rejects httpx's default User-Agent
Requests with UA `python-httpx/*` get an **empty HTTP 502**. The same request with a custom UA returns 200. Always send our own `User-Agent`.

## Coverage query (2026-10-30)
Last 7 days (24–30 Oct) from the history resource, MP only, distance = straight line from Indore to district centroid (Nominatim) ≤ 150 km. Districts in range: Agar Malwa, Dewas, Dhar, Harda, Indore, Jhabua, Khandwa, Khargone, Ratlam, Sehore, Shajapur, Ujjain.
- **Soyabean: 67 mandis.** Daily MP rows: 61–295.
- **Onion: 42 mandis/yards** (including F&V yards). Daily MP rows: 18–98.
- Nominatim didn't resolve `Badwani` or `Shehdol` with "X district, Madhya Pradesh". Their spellings need a lookup alias (Barwani/Shahdol).
- Caveat: centroid distance is approximate. The app uses per-mandi geocodes and OSRM road km.

## Open-Meteo forecast ✅
- `GET https://api.open-meteo.com/v1/forecast?latitude=22.7196&longitude=75.8577&daily=precipitation_sum,precipitation_probability_max&models=ecmwf_ifs025,gfs_seamless&timezone=Asia/Kolkata&forecast_days=7`
- With several models, each daily key gets a model suffix: `precipitation_sum_ecmwf_ifs025`, `precipitation_sum_gfs_seamless`, and so on.
- Gotcha: ECMWF returned **`-0.10` mm** for one day. Clamp to ≥ 0.
- Gotcha (verified M4): with **one** model in `models=`, the keys have **no suffix** (`precipitation_sum`). With two or more models, keys are suffixed. The parser handles both.
- No key. CC BY 4.0, so the UI must show attribution.

## OSRM ✅
- `GET https://router.project-osrm.org/route/v1/driving/75.8577,22.7196;75.7849,23.1765?overview=false` (lon,lat order)
- Indore→Ujjain: `distance` 56719.8 m, `duration` 3160.7 s. `code: "Ok"`.
- TODO: verify `/table/v1/driving/...?annotations=distance,duration` for batching.

## Nominatim ✅
- `GET https://nominatim.openstreetmap.org/search?q=Ujjain,Madhya Pradesh,India&format=json&limit=1`, with a custom User-Agent.
- Returns `lat`/`lon` as strings: Ujjain 23.1885131, 75.7716562.
- Max 1 request/second. Cache permanently.

## Sarvam TTS ✅
- `POST https://api.sarvam.ai/text-to-speech`, header `api-subscription-key: KEY`, JSON `{"text", "language_code": "hi-IN", "model": "bulbul:v4-flash", "speaker": "aditya_hi_conversational"}`.
- v4-flash speakers are persona IDs (`<name>_hi_<style>`), not the v3 short names. Up to 2500 chars per request.
- Response `{request_id, audios: [base64 WAV]}`. A 1-sentence Hindi reply took 1.7 s and produced ~210 KB of WAV.

## Sarvam STT ✅
- `POST https://api.sarvam.ai/speech-to-text`, multipart: `model=saaras:v4`, `mode=transcribe`, `language_code=hi-IN`, `file=@audio.wav`.
- Response `{request_id, transcript, language_code}`. Took 0.7 s.
- Round-trip test: TTS of "...गाँव सांवेर..." was transcribed as "...गांव **सामेर**...". Village names need fuzzy matching against the gazetteer.
- Windows console: print Devanagari with `PYTHONIOENCODING=utf-8`.

## OpenRouter ✅
- `POST https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer KEY`.
- Model `deepseek/deepseek-v4.1-flash` (exact ID taken from `/api/v1/models`, which lists `tools` as supported). $0.045 per 1M input tokens, $0.50 per 1M output tokens.
- Reasoning tokens count against `max_tokens`. Measured: 642 of 700 tokens went to reasoning, leaving empty content. We send `reasoning: {effort: "low"}` and `max_tokens: 1500`. Real answers use about 165–364 reasoning tokens, ~$0.0002–0.0004 per call.
- Forced `tool_choice` with a `set_intent` function returned `{"crop":"soyabean","quantity_quintals":40,"village":"Sanwer"}` in 1.2 s. 467 tokens, $0.00025. Includes 45 reasoning tokens, so set `max_tokens` with headroom.

## Mandi fee (who pays) — MP Krishi Upaj Mandi Adhiniyam, 1972
- **Section 19(2)**: "The market fees shall be payable by the buyer of the notified agricultural produce and shall not be deducted from the price payable to the seller." Source: Act text (as amended), https://prsindia.org/files/bills_acts/acts_states/madhya-pradesh/1973/1973MP24.pdf
- Rate (paid by the buyer): raised from ₹1.00 to ₹1.50 per ₹100 by notification BORAD-LEKHA-2025-26(1073987), 15 Jun 2026, effective from Gazette publication. Source: https://teamleaseregtech.com/updates/article/57895/mpfwad-revision-of-market-fee-under-the-madhya-pradesh-krishi-upaj-mandi-adhiniyam-1972/
- **Consequence:** the farmer's mandi-fee deduction is 0 in MP. Weighing/hammali charges exist (Sec 17: the committee recovers and distributes them), but rates are set per committee by bye-law, and we found no published rates. So: an editable "other charges ₹/quintal" field, default 0, which the farmer fills in.

## Mandi name aliases (31 Oct 2026)
data.gov.in spells some mandi towns differently from OpenStreetMap (Haatpipliya/Hatpipliya, Harsood/Harsud, "A lot"/Alot). Some towns also moved to a new district (Agar, Badod and Soyat Kalan are now in Agar Malwa). `MANDI_TOWN_ALIASES` in `backend/app/data/synonyms.py` maps the name only; coordinates always come from Nominatim. Every alias was checked by a Nominatim query on 31 Oct 2026. Result: 3 of 243 MP soybean/onion mandis are still unmapped (Barad, Chhapiheda, Sheopurbadod).

## OSM map tiles
- `https://tile.openstreetmap.org/{z}/{x}/{y}.png` in the Leaflet map, with the required "© OpenStreetMap contributors" attribution. The usage policy allows light use like ours (a demo with a few users); a heavy-traffic app would need its own tile provider.

## Sarvam STT input
- Browser MediaRecorder produces WebM/Opus. Sarvam docs list WebM as supported, and the REST endpoint is meant for clips under 30 s, so the UI stops at 25 s.

## Nominatim for villages: settlements only (31 Oct 2026)
- `format=jsonv2` returns `category`/`type`. We keep `category=place` with `type` in city/town/village/hamlet for villages.
- Verified: "Shajapur, Madhya Pradesh, India" returns only `boundary/administrative` (state_district) at 23.417, 76.607, ~35 km from the town. "Shajapur, Shajapur, …" returns `place/town` at 23.424, 76.283.
- `featureType=settlement` is no help: the docs say it covers "from 'state' down to 'neighbourhood'", which includes districts.
- Some towns exist only as a tahsil boundary (Badnagar and Mahidpur in Ujjain). We offer the tahsil as a confirmation question.
- Mhow's OSM name is "Dr. Ambedkar Nagar" (`place/town`, in "Mhow Tahsil").

## OpenRouter models tested (31 Oct 2026, from GET /api/v1/models)
- `deepseek/deepseek-v4.1-flash` (demo), `openai/gpt-5.6-terra`, `google/gemini-3.8-flash`: forced `tool_choice` works.
- `anthropic/claude-sonnet-5.5`: 400 "tool_choice: type tool and any are not supported for this model" (Bedrock / Claude Platform on AWS).
