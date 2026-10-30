# How Harvest Compass works — plain English

One section per module. Every team member should be able to explain each one.

## backend/app/config.py
Reads settings from the `.env` file in the repo root, or from real environment variables on the hosting platform. It holds API keys, the LLM model name and the region/crop choice. Region and crops come from the M0 coverage query: 67 soybean and 42 onion mandis reported prices within ~150 km of Indore in the last 7 days. Changing region is a config change, not a code change.

## backend/app/main.py
The FastAPI web server. Right now it has one route, `/health`, which reports which data sources are configured (true/false, never the key itself). CORS allows only the frontend's address, so other websites can't call our backend from a browser.

## frontend/app/page.tsx
The single web page (Next.js). On load it calls the backend `/health` and lists each source with ✅/❌. Labels are Hindi-first. The backend address comes from `NEXT_PUBLIC_API_URL`.

## check.sh
One command that runs every check: Python formatting (ruff format), lint (ruff), type check (mypy strict), unit tests (pytest), frontend lint (eslint) and TypeScript check. Run with `bash check.sh` from the repo root.

## Running locally
- Backend: `cd backend && uv sync && uv run uvicorn app.main:app --reload --port 8000`
- Frontend: `cd frontend && npm install && npm run dev` → http://localhost:3000

## backend/app/http.py — one shared HTTP client
Every outside call goes through one `httpx.AsyncClient` with our own User-Agent. Two reasons: data.gov.in sends an empty 502 to the library's default UA (found in M0), and Nominatim's usage policy requires an identifying UA. `request_json` retries **once** (with a short wait) on network errors, 5xx, 429 or broken JSON. It does **not** retry 4xx, because that means our request is wrong and retrying won't help.

## backend/app/data/cache.py — cache of real responses
One Postgres table, `api_cache(key, source_url, fetched_at, payload)`. Tools call `cached(key, source_url, ttl, fetch)`:
1. Cached copy younger than `ttl` → use it (status `cache`).
2. Otherwise call the real API, store the answer → status `live`.
3. API fails → return the old cached copy with its original `fetched_at`, so the UI can show its age (status `stale_cache`). No copy → status `error` with `data=None`.

It never fills a gap with made-up numbers. `ttl=None` means "never goes stale": geocodes, road distances, and mandi prices for days more than 3 days old (those are final). Every result is a `Sourced` object: `data + source_url + fetched_at + status (+ error)`. Stored `source_url`s never contain the API key.

## backend/app/data/synonyms.py — reference vocabulary
Words, not numbers: farmer crop words → data.gov.in commodity names (pyaaz/kanda/प्याज → Onion), the district spellings Nominatim needs (Badwani→Barwani, Shehdol→Shahdol, found in M0), and name cleaning (`'Ashta  APMC'` → `'ashta apmc'`; `'Mhow (Ambedkar Nagar) (F&V) APMC'` → `'Mhow'` for geocoding). Each yard is its own mandi, keyed by (cleaned market name, district).

## backend/app/tools/ — one file per outside source
- **mandi.py**: today's prices from the "current" data.gov.in resource. History from the "variety-wise" resource, **one cached call per day**. A 90-day history costs data.gov.in 90 calls the first time and zero after that, so judging won't hammer the API. Both resources come out as the same `PriceRow` shape. A row we can't parse is dropped, never guessed.
- **weather.py**: one Open-Meteo call returns both models (ECMWF and GFS). Negative rain (ECMWF has returned −0.1 mm) is clamped to 0. If a model returns all-empty values it's dropped, so the agent can see it's missing and use the other.
- **routing.py**: OSRM "table" call: one origin → many mandis in one request. Each origin→mandi pair is cached forever.
- **geocode.py**: Nominatim, at most one request every 1.1 s (a lock enforces it), results cached forever, including "not found". A mandi is first searched as "town, district, MP". If that fails, "town, MP" is accepted only if the result is in the right district. Otherwise the mandi is excluded and named. We never guess coordinates.
- **voice.py**: Sarvam speech-to-text (saaras:v4, Hindi) and text-to-speech (bulbul:v4-flash, voice `aditya_hi_conversational`). TTS audio is cached by its exact text to save credits. Empty transcripts count as errors, so the UI falls back to text.

## backend/app/scoring/ — the maths (pure functions, fully unit-tested)
- **net_profit.py**: `trips = ceil(quantity / vehicle capacity)`. `transport = trips × 2 (round trip) × road km × ₹/km`. `mandi charges = price × quantity × fee rate`. `net per quintal = price − (transport + charges) / quantity`.
  - *Conservative price* = 25th percentile of this mandi's own modal prices over the last 14 days ("a bad day here recently"). It needs at least 5 days, otherwise "not enough history".
  - Ranking uses modal net. The conservative net only breaks ties.
- **trend.py**: straight-line (least-squares) slope of the daily median modal price, in ₹/quintal per day. Needs at least 5 days. Always shown as "trend, not forecast".
- **audit_rules.py**:
  - *inconsistent* (min > max, or modal outside min–max) → rejected.
  - *stale* (> 3 days old) → flagged.
  - *wide spread* (min < half of modal: mixed-quality lots) → info only.
  - *outlier* → flagged. It uses the robust z-score: 0.6745 × (price − median) / MAD, where MAD = median distance from the median, so one crazy value can't distort it. The threshold is 3.5 (standard Iglewicz–Hoaglin value). A price must be unusual against **both** the mandi's own last 30 days **and** today's regional prices (if one comparison has too little data, the other decides).
  - *not comparable* (different variety/grade from the group we rank on) → flagged.
- **harvest_window.py**: for each day the farmer is ready, rain risk per model = max(rain probability, rain mm / 5 mm). Day score = harvest-day risk + weight × next-day (transport) risk, using the worse model. Weight = 1 for perishables (onion), 0.5 for grain.
  - A day is **uncertain** if only one model is available, if the models disagree (one says dry and the other doesn't, or their risk differs by ≥ 0.3), or if the transport day has no forecast (unknown ≠ dry).
  - Sort order: days both models call dry first, then confident days, then lowest risk.
  - Days beyond the 7-day forecast are listed, never scored.
  - The 5 mm "wet" threshold is a heuristic, marked in the code.

## backend/app/agent/ — the agent loop (LangGraph)
`graph.py` wires the steps:
**understand → (clarify? stop) → plan → execute → audit → (repair → execute, at most 2×) → compute → explain**.
Every step sends live trace events (`trace.py` → SSE), each with an English and a Hindi message.

- **understand**: the LLM fills a strict JSON form (crop word, quantity + unit, village in Latin script, ready dates, harvested?, storage?, "wait N days?"). It extracts only what was said. Then our code decides:
  - The crop goes through the synonym table. Unsupported crops get a polite "only soybean/onion".
  - Quantity becomes quintals. A quantity in **bori** makes us ask "how many kg in one bori?" instead of guessing.
  - The village is matched against real OpenStreetMap places with fuzzy matching (rapidfuzz). It's accepted only if the score is ≥ 90 and at least 10 points ahead of any *different* place more than 10 km away. Otherwise we ask "क्या आपका गाँव X है?" (MP has many Rampurs). Not found → ask for village + district.
  - We ask **one** question per turn. The frontend sends the answer back with the previous intent.
- **plan**: fixed rules, not the LLM, so the plan is predictable. Already harvested → skip the harvest window. Storage, or asked to wait → add the "wait" comparison. Perishable → tighter drive-time cap. No vehicle details → use the editable default and say so.
- **execute**: today's prices + 30-day history + weather run **in parallel**. Then mandis are located (district pre-filter → geocode → straight-line ≤ radius) and one OSRM table call gets road distances. Lookups run concurrently. The geocode lock still spaces live Nominatim calls 1.1 s apart. Test switches (`faults.py`) skip a source to prove recovery:
  - today's prices down → each mandi's latest history row is used, with its age shown;
  - one weather model down → the other is used and days are marked "uncertain".
- **audit**: the rules from `scoring/audit_rules.py`, applied per mandi, plus "not on map", "no road" and "too far". Only mandis with no reject/flag are ranked.
- **repair**: if fewer than 3 mandis are usable, widen the radius 150 → 200 → 250 km (max 2 rounds), then run execute again.
- **compute**: only pure functions. Net profit uses **seller fee = 0** (MP Act Sec 19(2): the buyer pays the market fee) plus the farmer's editable "other charges/quintal". It also computes: the conservative (bad-day) net, the ranking and why the runner-up lost, the harvest days, the 14-day trend, the "wait N days" trade-off (labelled *trend, not forecast*), and confidence (count of weak points: 0 → high, 1 → medium, 2+ → low).
- **explain**: the LLM writes ≤ 60 Hindi words from a small facts dict. A **number validator** extracts every number in the text (Devanagari digits and Indian comma grouping too) and checks it exists in the facts (±0.5). Fail → one retry with feedback → fixed Hindi template. The invented-number count is logged and returned.
- **main.py `/ask`**: streams trace events as SSE (`data: {...}`), then a final event with the answer, card data and any clarification.
- **app/llm.py**: OpenRouter chat with temperature 0 and `reasoning: low`. Reasoning tokens count against `max_tokens`, so we leave 1500 of headroom (an empty answer was measured at 700).
- **app/clock.py**: `today_ist()`. The server runs on UTC, but mandis and farmers run on Indian time.

Windows dev note: run `uv run uvicorn app.main:app --reload --loop asyncio:SelectorEventLoop`, because psycopg async can't use the default Windows event loop. Linux (deployment) needs nothing.
Ask from the terminal: `uv run python -m scripts.ask "मेरे पास 40 क्विंटल सोयाबीन है, गाँव सांवेर" [--fault weather_ecmwf]`.
