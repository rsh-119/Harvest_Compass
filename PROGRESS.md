# PROGRESS — Harvest Compass

## M0 — Data go/no-go (HUMAN GATE)

**Goal:** prove every live data source works before writing app code.

**Acceptance criteria**
- [x] data.gov.in key works; real request returns recent prices for target state/crops; resource ID, fields, filters, date format recorded in `docs/DATA_SOURCES.md`.
- [x] Coverage query: mandis per crop reporting in last 7 days within 150 km of Indore; crops/region chosen by data.
- [x] Open-Meteo (two models), OSRM route, Nominatim lookup, Sarvam STT+TTS, OpenRouter tool call — all succeed and are logged.
- [x] (n/a, it works) If mandi API fails: STOP and report options.

**Plan:** curl each endpoint, record verified request/response shape in DATA_SOURCES.md, paste evidence here.

### Evidence
- **data.gov.in current prices** — resource `9ef84268…` returns rows dated 30/10/2026. MP Soyabean total=193, Onion total=55, Indore district Soyabean=5 (Sanwer, Gautampura). ✅
- **data.gov.in history** — resource `35985678…` returns Indore Soyabean total=22068 (from 2010). ✅ Sorting/date filter not yet verified.
- **Open-Meteo** — ecmwf_ifs025 + gfs_seamless, 7 days, both returned. Example 30 Oct: ECMWF 1.0 mm/53%, GFS 0.3 mm/23%. ✅
- **OSRM** — Indore→Ujjain 56.7 km, 52.7 min. ✅
- **Nominatim** — Ujjain → 23.1885, 75.7717. ✅

### Reflection
- What worked: the mandi API works and has today's data, so the main risk is gone. No need for a backup idea.
- Gotchas found: date format is DD/MM/YYYY. Variety naming is inconsistent. The two resources name markets differently (` APMC` suffix). History prices are strings. ECMWF can return negative precipitation. data.gov.in latency is unpredictable.

### Loop 2 (own keys)
- **History resource** — `sort[Arrival_Date]=desc` returns 29/10 first (Indore APMC, Gautampura, Sanwer). `filters[Arrival_Date]=29/10/2026` → total=5. 0.4–0.6 s. ✅
- **Coverage** (24–30 Oct, ≤150 km of Indore by district centroid): **Soyabean 67 mandis, Onion 42 mandis/yards.** Default crops and region (Soybean + Onion, Indore–Ujjain–Dewas) are confirmed by data. ✅
- **OpenRouter** `deepseek/deepseek-v4.1-flash` forced tool call → `{"crop":"soyabean","quantity_quintals":40,"village":"Sanwer"}`. 1.2 s, $0.00025. ✅
- **Sarvam** TTS bulbul:v4-flash 200 in 1.7 s (WAV 218 KB) → STT saaras:v4 200 in 0.7 s. Transcript: "मेरे पास चालीस क्विंटल सोयाबीन है। गांव सामेर कहां बेचूं?" ✅

### Reflection (loop 2)
- Broke: httpx calls to data.gov.in got empty 502s. Root cause: the server rejects the default `python-httpx` User-Agent. Fix: always send a custom UA. curl worked because its UA is accepted.
- Learned: the history resource lags a day (no rows for today), so use current = today and history = trend/backtest. STT mishears village names (सांवेर→सामेर), so geocoding needs fuzzy matching. The LLM spends reasoning tokens, so give `max_tokens` headroom.
- Open question for humans: what the "conservative net" should use (min price is often far below modal).
- **Status: M0 criteria all pass. HUMAN GATE — waiting for "go" before M1.**

### M0 gate decision (humans, 2026-10-30): GO
1. **Conservative net** = 25th percentile of the mandi's own modal prices over the last 14 days (same commodity + variety). Not computed if fewer than 5 history days ("not enough history", lower confidence). Rank by modal net. Conservative net is a risk badge and tie-breaker only.
   - Audit flag (not a rejection): min < 0.5 × modal → "wide price spread, mixed quality lots".
2. **Village matching:** transliterate Devanagari → Latin, then fuzzy-match against real Nominatim place names for the district and cache the result. High confidence → proceed. Low or ambiguous → one spoken confirmation, logged as a trace event. Never geocode an unconfirmed guess.
3. **Today vs history:** today comes from the current resource. If a mandi is missing today, use its latest history row with its age shown (≤3-day freshness rule still applies). Trends always come from history.
4. **Names:** normalise whitespace and case. Mandi key = (normalised market, district). F&V yards stay separate. District aliases (Badwani→Barwani, Shehdol→Shahdol) go in `data/synonyms.py`.
5. **Distance:** 150 km is only a pre-filter. Rank on OSRM road km, and also cap by drive time (tighter cap for onion/tomato).
6. **User-Agent:** set once on a shared httpx client used by all tools.
7. **Model:** deepseek/deepseek-v4.1-flash for dev. Before freeze, run the grounding test and a Hindi check on it and one stronger model, then pick the demo model.
8. **Database:** skip in M1. `DATABASE_URL` must be set before M2.

## M1 — Skeleton

**Goal:** a runnable skeleton that every later milestone builds on.

**Acceptance criteria**
- [x] Repo structure (backend/, frontend/, docs/), `.env.example`
- [x] FastAPI `/health` responds
- [x] Next.js page runs and shows backend health
- [ ] Postgres connected → **deferred to before M2** (human decision 8)
- [x] ruff + mypy + pytest configured; one local check command passes (`bash check.sh`, because there's no `make` on the Windows dev box)

**Plan:** `backend/pyproject.toml` (uv), `app/config.py` (env settings), `app/http.py` (shared client with UA, decision 6), `app/main.py` (/health), `tests/test_health.py`, `check.sh`. Frontend from create-next-app. The page calls `/health`.

### Evidence
- `curl localhost:8000/health` → `{"status":"ok","sources":{"mandi_prices":true,"voice":true,"llm":true,"database":false,"weather":true,"routing":true,"geocoding":true},"llm_model":"deepseek/deepseek-v4.1-flash"}`
- CORS: request with `Origin: http://localhost:3000` → `access-control-allow-origin: http://localhost:3000`
- `bash check.sh` → ruff format ✓, ruff ✓, mypy strict "no issues in 3 files", pytest 1 passed, eslint ✓, tsc ✓
- `npm run build` ✓ (static page). `next start` serves `<title>Harvest Compass</title>`, `lang="hi"`, heading "हार्वेस्ट कम्पास".
- Not verified: the browser actually rendering the fetched source list. Playwright MCP was down. Evidence above covers the server side and CORS only.

### Reflection
- Worked: uv for Python deps; create-next-app ran in the background while the backend was written.
- Deviation: `check.sh` instead of `make check`, because `make` isn't installed on the Windows dev machine. bash works in Git Bash and on Linux.
- Skipped on purpose: the shared httpx client with UA (decision 6) goes in M2, when the first tool uses it. Postgres is deferred by decision 8.
- Known warning: starlette TestClient deprecation (inside the library, not our code).
- **Status: M1 done, except Postgres (deferred). Next: M2 needs `DATABASE_URL` first.**

## M2 — Tools with provenance and cache

**Goal:** every data source behind a typed tool that records where each number came from and when, and that degrades gracefully.

**Acceptance criteria**
- [x] Each tool returns typed results with `source_url`, `fetched_at`, `status`. Timeouts plus one retry. Cache read/write. Nominatim rate-limited.
- [x] Live smoke test script prints real results for all tools.
- [x] (Human reminder) The 90-day history fetch is cached, so judging doesn't hit data.gov.in repeatedly.

**Plan:** `app/http.py` (shared client, UA, retry) · `app/data/cache.py` (one `api_cache` table, TTL, stale fallback) · `app/data/synonyms.py` · `app/tools/{mandi,weather,routing,geocode,voice}.py` · `scripts/smoke.py` · parser unit tests.
- Neon project `harvest-compass` (rapid-surf-18198750, aws-ap-southeast-1, free tier) created; `DATABASE_URL` is in `.env`.
- DB access uses psycopg with plain SQL instead of SQLAlchemy. There's one cache table, so an ORM adds a layer without benefit, and raw SQL is easier for the team to explain.

### Evidence (M2)
`uv run python -m scripts.smoke`, first (cold) run, all `live`:
- mandi current: Soyabean 193 rows (e.g. Harsood APMC Yellow ₹6800, 30 Oct), Onion 55 rows
- history 90 days: Soyabean 11,424 rows, Onion 5,941 rows. All 180 day-calls `live` (~11 min cold, see below)
- geocode: Indore 22.7204. 7 of 8 mandis located (Badnawar, Indore, Dhar, Mhow, Dhamnod, Kukshi, Khategaon). **Haatpipliya UNRESOLVED**: OSM spells it "Hatpipliya". It gets excluded and named, never guessed.
- OSRM table: Indore→Dhar 64.0 km/56 min, →Mhow 23.1 km/25 min, →Kukshi 167.6 km/141 min
- weather: ecmwf_ifs025 and gfs_seamless, 7 days each
- TTS 134 KB WAV → STT returned the exact sentence: "सांवेर मंडी में सोयाबीन का भाव सबसे अच्छा है।"

Second (warm) run, total **34.8 s** vs 1353.9 s:
- history Soyabean `{'cache': 89, 'live': 1}` in 6.1 s (the 1 live day is the newly-added yesterday, after the IST date rolled over). Onion `{'cache': 90}` in 5.3 s.
- routing, weather, TTS: `cache`. Geocode was `live` only because its cache key changed (English names).

### Reflection (M2)
- Broke 1: the cold history fetch was slow (~7 s per day-call at concurrency 4) while curl took 0.4–1.0 s. Root cause: occasional data.gov.in requests hang, and a 90 s timeout plus a retry blocked a slot for up to 3 min. Fix: 20 s timeout. A hung call fails fast and the retry usually succeeds.
- Broke 2: cache keys and "today" used `date.today()` (machine-local). The deployed server runs on UTC, so "today" would be wrong between 00:00 and 05:30 IST. Fix: `app/clock.py: today_ist()` everywhere.
- Learned: data.gov.in rejects httpx's default UA (fixed once, in `app/http.py`). Neon free tier works, and warm reads are fast.
- **Status: M2 done.**

## M3 — Scoring and audit (pure functions)
**Acceptance criteria**
- [x] `net_profit`, `harvest_window`, `trend`, `audit_rules` with unit tests (zero quantity, missing price, min > max, all mandis stale, model disagreement)
- [x] Coverage ≥ 90% on `scoring/`

### Evidence (M3)
`uv run pytest -q --cov=app/scoring` → **24 passed, coverage 100%** (audit_rules 52/52, harvest_window 52/52, net_profit 39/39, trend 12/12).

### Reflection (M3)
- Writing tests found 2 real bugs in harvest_window:
  1. The last forecast day looked safest because its unknown transport-day risk counted as 0. Now "no forecast for the transport day" makes the day uncertain.
  2. The reason "weather models disagree" was shown when the only issue was a missing forecast. Now the two are separate.
- Human decision applied: conservative price = 25th percentile of the mandi's own last-14-day modal prices, with a minimum of 5 days.
- **Mandi fee finding (needs a human look at the M4 gate):** MP Act Sec 19(2) says the market fee is paid by the BUYER and "shall not be deducted from the price payable to the seller". So the farmer's fee rate = 0, citation in DATA_SOURCES.md. Added an editable "other charges ₹/quintal" (hammali/weighing), default 0.
- **Status: M3 done.**

## M4 — Agent graph end to end (HUMAN GATE: design review)
**Acceptance criteria**
- [x] A text question in Hindi returns a ranked answer with sources, using live data
- [x] Trace shows plan → tools → audit → compute → explain
- [x] A forced stale/outlier case is rejected with a reason; a forced source failure triggers a repair
- [x] Number validator active; invented-number count logged

### Evidence (M4)
**Hindi question**: "मेरे पास 40 क्विंटल सोयाबीन है, गाँव सांवेर, इंदौर। फसल 2 नवंबर से 5 नवंबर के बीच तैयार होगी। कहाँ बेचूँ?"
- understand → Sanwer matched on OSM → plan `prices → history → mandis → weather → drive_cap → assume_vehicle`
- 193 rows today, 5,621 history rows, both weather models, 82/99 mandis located, 64/64 road distances
- audit: real stale/outlier flags, e.g. "Badnagar APMC: Price is 25 days old (limit 3)" and "Badnagar APMC: Modal 5985 is far from usual (median 6890); treated as suspect". 17 unmappable mandis named and excluded. Yellow/FAQ vs Soyabeen/FAQ marked not comparable.
- result: **57 usable of 81**. #1 Sanwer APMC ₹6900/q net (0 km, same town), #2 Rajgarh ₹7300 modal but 134 km → ₹6898/q net, #3 Indore ₹6830/q. Harvest days 2 Nov, 4 Nov (both models dry). Confidence high. **Invented numbers: 0.**

**Forced failures** (`--fault mandi_current --fault weather_ecmwf`):
- `repair: Today's price source failed (disabled by test switch); using each mandi's latest reported price, with its age` → best Indore APMC ₹6830/q, price age 2 days, confidence dropped to **medium** ("best price is 2 days old")
- `repair: Weather model ['ecmwf_ifs025'] unavailable; using ['gfs_seamless'] only, so days are marked uncertain` → confidence medium ("weather models disagree or one is missing")

**Radius repair** (village Rampur, Shahdol, before the ambiguity fix): execute ran 3× with 4 → 6 → 9 mandis (radius 150 → 200 → 250 km).

**SSE through uvicorn** (`POST /ask`, Hinglish "mere paas chalis quintal soyabean hai, gaon sanwer..."): events stream one by one; warm total **14.5 s** (locating 4.3 s, OSRM 1.1 s, LLM ~4 s). LLM cost about $0.0006 per question.

**Clarifications**: wheat → "only soybean/onion". "chalis bori pyaaz" → "एक बोरी में कितने किलो?". Rampur → "क्या आपका गाँव Rampur है?". "सामेर" → "village not found, say village and district".

`pytest`: 31 passed. scoring coverage 100%. ruff + mypy strict clean.

### Reflection (M4)
Six real bugs were found by running it live, each fixed at the root:
1. With one weather model, Open-Meteo drops the key suffix, so the fallback model parsed as empty. Fixed the parser and added a test.
2. An unknown transport-day risk counted as 0, so the last forecast day still won when every day was uncertain. Added a `transport_known` sort key and a test.
3. The LLM spent its token budget on reasoning, giving an empty Hindi answer (the template was used). Fixed with low reasoning effort and 1500 max tokens. Trace now says "empty answer" instead of a misleading message.
4. A database outage crashed the answer (30 s PoolTimeout). The cache now degrades to live calls (bounded 10 s wait).
5. Warm path was slow (36 s locating, 14 s routing) because ~200 sequential DB reads at ~150 ms each. Lookups are now concurrent (pool 20): 4.3 s and 1.1 s.
6. Tied village names ("Rampur" ×N) were accepted as confident. Ties now ask. Same-place duplicates (town + tahsil within 10 km) are ignored.

Also: Windows-only event-loop issue (psycopg vs Proactor). Fixed with `--loop asyncio:SelectorEventLoop`, no code change.

**Open items for the design review:**
- **Mandi fee:** the farmer's fee = 0 per MP Act Sec 19(2). The brief's formula assumed a farmer-paid fee. Please confirm.
- **Vehicle defaults** ₹30/km, 25 q/trip are placeholders the farmer can edit. Team: replace with real local hire rates.
- 17 of 99 mandis can't be geocoded (e.g. Agar, Harsood, Haatpipliya/"Hatpipliya", "A lot"/Alot). They're excluded and named. Plan: hand-check spelling aliases into `synonyms.py` (vocabulary, not coordinates), or use Nominatim structured search in M7.
- STT village errors ("सामेर"): "did you mean Sanwer?" needs a per-district village list (e.g. OSM Overpass). Planned for M6.
- Sanwer→Sanwer APMC = 0 km road (village and mandi are in the same town). Correct, but it looks odd. The UI should say "same town".
- **Status: M4 criteria pass. Gate passed 31 Oct (see below).**

### M4 gate decisions (31 Oct 2026, human)
- GO for M5. **Seller mandi fee = 0 confirmed** (MP Act Sec 19(2)).
- **Add mandi spelling aliases**: done. 30 aliases in `MANDI_TOWN_ALIASES` (synonyms.py) plus `Anupur→Anuppur`. Each was checked by hand on Nominatim. Unmapped mandis went from **39 of 243 to 3** (Barad, Chhapiheda, Sheopurbadod: no match on OSM in the right district, still excluded and named). Agar, Badod and Soyat Kalan are now in Agar Malwa district; data.gov.in still lists them under Shajapur.

## M5 — Frontend
**Acceptance criteria**
- [x] Mic button + text box (mic → `POST /transcribe` (Sarvam, WebM) → fills the box and asks)
- [x] Live trace panel over SSE (fetch + stream reader; EventSource can't POST)
- [x] Result card: Hindi answer, confidence badge + reasons, best mandi, net/q, total, bad-day net, runner-up gap, harvest days, wait-N trade-off
- [x] Map of ranked mandis (plain Leaflet + OSM tiles, top 5 numbered, home pin)
- [x] Sources with timestamps (IST) and status; Open-Meteo CC BY 4.0 attribution with links
- [x] Cost breakdown with editable ₹/km, quintals per trip, other charges → "recalculate" reruns with the confirmed place (skips village matching)
- [x] Mobile-friendly (tested at 390×844), Hindi-first labels, "same town" instead of 0 km

### Evidence (M5)
Playwright on localhost, 390×844:
- Sanwer example → trace streamed live, then Sanwer APMC ₹6,900/q "उसी कस्बे में (same town)", total ₹2,76,000, bad-day ₹6,725, harvest days ☀️ 5, 2, 4 Nov, map with 10 ranked pins and the home pin, 11 excluded with reasons (down from ~24 thanks to aliases), sources with fetch time.
- Rate changed to ₹45/km → recalculated: Rajgarh (134 km) drops from #2. Ujjain transport 26 km × 2 × 2 trips × ₹45 = ₹4,682 ✓.
- "20 क्विंटल सोयाबीन, गाँव रामपुर" → three Rampur buttons with tahsil names. Picked Gohparu → two visible radius repairs (150→200→250 km) → Satna APMC.
- Browser console: 0 errors, 0 warnings. `check.sh`: ruff, mypy strict, 32 tests, eslint, tsc all pass.
- Security: Next 15.5.4 had a critical RSC RCE advisory; upgraded to 15.5.28. Remaining `npm audit` highs are in `sharp` (next/image only, which we don't use). Mandi names are HTML-escaped in map popups (external data).

### Reflection (M5)
- The trace showed Python's `datetime.date(...)` repr in the "understood" line. Fixed with `model_dump(mode='json')`.
- The Hindi answer sometimes says "शुद्ध लाभ" (net profit) for what is the net price after transport. To tighten in the explain prompt in M7.
- Mic recording → Sarvam is wired up but not yet tested with a real voice; that's M6.
- **Status: M5 criteria pass. Next: M6 voice, then deploy a first version (brief: by Sat evening).**
