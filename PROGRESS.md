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

## Review fixes after M5 (31 Oct 2026, human review)
1. **No placeholder vehicle rate** (the rules ban fake placeholder numbers). Removed the ₹30/km and 25 q defaults from config. If neither the farmer's words nor the edit boxes give them, the agent asks: "गाड़ी का किराया कितने रुपये प्रति किलोमीटर है, और एक चक्कर में कितने क्विंटल आता है?". The question is sent back with the answer, so a terse reply like "40 रुपये, 30" is read correctly (verified in the browser: ₹40/km, 30 q, 2 trips). We ask per km only: a whole-trip quote is for one destination and can't be compared across mandis.
2. **₹6,900/q checked against raw data.gov.in rows** (history resource, cached with source URL):
   - Sanwer APMC, Soyabean, variety "Soyabeen", grade FAQ, 30/10/2026: min 2200, max 7223, modal 6900.
   - The same mandi/variety on earlier days: 6800 (29 Oct), 7000 (28 Oct), 6000 (27 Oct), 6500 (26 Oct), 6900 (24 Oct), 7000 (23 Oct), 7050 (15 Oct), 6300 (12 Oct). It moves day to day, so nothing is copied.
   - Nearby mandis on the same days are at the same level: Indore ₹6,925, Ujjain ₹6,900, Rajgarh ₹7,300.
   - Sanwer also reports a "Yellow"/FAQ line at ₹5,514 (30 Oct) and "Non-FAQ" lines at ₹5,000–6,000. The audit compares only the main like-for-like group (Soyabeen/FAQ), and the UI shows the variety next to the price.
   - For reference: the soybean MSP for 2026-27 is ₹5,708/q (Cabinet, 13 May 2026; https://ddnews.gov.in/en/cabinet-approves-higher-msp-for-14-kharif-crops-for-2026-27-marketing-season/). The market is ~21% above MSP across MP, so ₹6,900 is a real market price, not a variety mix-up.
   - The 30 Oct row has min 2200 vs modal 6900, so the "wide price spread, mixed quality lots" info flag applies.
3. **Mandi fee = 0, with its source**: MP Krishi Upaj Mandi Adhiniyam 1972, Sec 19(2) (https://prsindia.org/files/bills_acts/acts_states/madhya-pradesh/1973/1973MP24.pdf): the market fee is payable by the buyer and not deducted from the seller. **Hammali/tulai**: these are set by each mandi committee's bye-law, and our search found no citable current MP rate. So the line is shown as "not included — fill in if you pay it (rate set by the mandi committee)", with an edit box, instead of a made-up number.
4. **Wording**: the explain prompt now forbids "लाभ"/"मुनाफ़ा" and uses "खर्च काटकर आपके हाथ में" / "शुद्ध भाव" (verified in the answer text).
5. **Credit protection**: `app/ratelimit.py`: 10 paid calls a minute per visitor plus 300 an hour overall, on `/ask` and `/transcribe` (429 with a Hindi message). In memory, which is fine for one Render instance. Also set a spending cap on the OpenRouter key in its dashboard (team action).
6. **Deploy files**: `backend/Dockerfile` (uv, `$PORT`, proxy headers), `.dockerignore`. Not built locally (Docker Desktop not running); Render will build it.
7. **Voice test sheet**: `docs/VOICE_TEST.md` (10 scripts with expected crop/quantity/village). `recordings/` is gitignored.

### Deploy steps (team, needs your accounts)
- **Render** → New Web Service → this repo, root directory `backend`, runtime Docker, free plan. Env vars: `DATA_GOV_IN_API_KEY`, `SARVAM_API_KEY`, `OPENROUTER_API_KEY`, `LLM_MODEL=deepseek/deepseek-v4.1-flash`, `DATABASE_URL`, `NOMINATIM_USER_AGENT`, `FRONTEND_ORIGIN=https://<your-app>.vercel.app`.
- **Vercel** → New Project → this repo, root directory `frontend`. Env var: `NEXT_PUBLIC_API_URL=https://<your-service>.onrender.com`.
- **cron-job.org** → GET `https://<your-service>.onrender.com/health` every 10 minutes (keeps the free instance awake).
- **OpenRouter** dashboard → set a credit limit on the key.

## Repo
- GitHub: https://github.com/rsh-119/Harvest_Compass (pushed 31 Oct; history scanned, no secrets or .env)

## M6 — Voice (31 Oct)
**Acceptance criteria**
- [ ] Hindi speech in → correct intent for 8 of 10 team recordings. **Waiting for recordings** (team, later). Sheet: `docs/VOICE_TEST.md`.
- [x] Spoken Hindi reply ≤ 20 s. The server speaks only the agent's own text (answer or question) and streams it as an `audio` SSE event right after `final`. No public TTS endpoint, so credits can't be drained. The UI auto-plays (🔊 replays it). Answers are ≤ 60 words (grounding test: max 51 words).
- [x] Text fallback when voice fails: STT error → "please type"; mic denied → "you can type"; TTS failure → `audio_failed` event, text stays.

## M7 — Robustness, counterfactual, fault injection (31 Oct)
- [x] `/health` shows **live** source status: tiny real calls to the database, data.gov.in, Open-Meteo and OSRM, run together and remembered 60 s. Nominatim isn't probed (policy); the LLM and voice APIs report "configured". Measured: all OK (DB 2.3 s cold, data.gov.in 0.7 s, Open-Meteo 0.6 s, OSRM 0.75 s).
- [x] Fault toggles in the UI ("टेस्ट स्विच"). CLI evidence with `--fault mandi_current --fault weather_gfs`: two repair lines, confidence medium.
- [x] Edge cases:
  - unknown crop (wheat → "only soybean/onion")
  - unknown village → asks; tahsil-only towns → one-tap tahsil question
  - no fresh data → audit rejects stale, "no reliable mandi" answer
  - API timeout → retry, then stale cache or fallback
  - empty audio → 400
  - very large quantity → 50,000 q asks "क्या सच में…?" with a confirm button
- [x] "Wait N days": 50 q soybean, Ujjain, wait 3 → trend +₹14/day ⇒ +₹42/q, rain risk 4%, "trend, not forecast".
- [ ] Deployed backend + frontend: **needs team logins** (Render, Vercel). Repo, Dockerfile and steps are ready (see above).
- Village matching fixes found by the grounding test:
  - Nominatim jsonv2 `category=place` + `type∈{city,town,village,hamlet}` only, so no district centroids (Shajapur's was 35 km from the town), roads or stations.
  - Retry with the farmer's Devanagari words, then "X, X".
  - A town also matches its tahsil name (Mhow = "Dr. Ambedkar Nagar").
  - A lone town name in the district slot is used as the place.

## M7b — Link hardening (code side done)
- [x] Waking-up state in the UI if `/health` is slow; backend-unreachable message.
- [x] Rate limit 10/min per visitor + 300/hour total; CORS from `FRONTEND_ORIGIN`.
- [x] Mic works only on HTTPS (Vercel and Render are HTTPS); text works if mic is denied.
- [ ] Team: Render + Vercel + cron-job.org (/health every 10 min) + OpenRouter spending cap. Then a smoke test from another device and network (3 questions).
- Free-tier notes to verify when signing up: Render free web services sleep after idle (hence the ping); Neon free tier; Sarvam and OpenRouter credit balances must last to **5 Nov 2026**.

## M8 — Backtest and metrics (31 Oct)
**Backtest** `app/backtest/run_backtest.py`:
- 30 real OSM villages around Indore/Ujjain/Dewas/Dhar (0 dropped), 60 days (31 Aug–30 Oct 2026), real data.gov.in history (cached; 0 extra API calls).
- Decide on day t with the agent's own `audit_mandis` + `rank` on rows dated ≤ t; realise at t+1 at the chosen mandi (same variety/grade).
- Baseline: nearest reporting mandi. Oracle: best net in hindsight.
- Transport swept (₹0.5/1/2 per q-km, **assumed**). Stored in Postgres `backtest_runs`.

| Crop | Strategy | Mean gain ₹/q (0.5 / 1 / 2) | % days gain > 0 (at 1) | Mean regret vs oracle (at 1) |
|---|---|---|---|---|
| Onion | today's price | +426 / +393 / +378 | 45.6% | 380 |
| Onion | 7-day median | +540 / +482 / +429 | 46.8% | 315 |
| Soybean | today's price | +27 / −32 / −73 | 34.6% | 423 |
| Soybean | 7-day median | +61 / +15 / −4 | 38.3% | 358 |

- Median gain is ₹0 in most settings: in many decisions the choice is the nearest mandi, or prices are equal.
- About 30–40% of decisions are unscorable (the chosen mandi doesn't report the next day).
- Losing examples come from overnight drops at the chosen mandi, e.g. Indore APMC 6500 → 3800 on 9–10 Oct.
- **Finding:** choosing the mandi pays for onion. Soybean prices are nearly uniform across MP. Ranking on a 7-day median beats today's single price everywhere (winner's curse on one-day spikes). **Decision for the team:** switch the live ranking to the 7-day median? (M0 decision #1 says rank on today's modal; not changed without your OK.)

**Grounding** `scripts/grounding.py` (20 varied Hindi/Hinglish questions, full agent):
- deepseek-v4.1-flash (final): 19/20 answered (1 correct tahsil question), **0 invented numbers**, 0 non-Hindi, 0 "लाभ", 0 over 60 words, p50 11.4 s, p95 15.3 s.
- openai/gpt-5.6-terra: 19/20, 0 invented numbers, p50 11.6 s, but it **wrote mandi names in Devanagari and turned Badnagar into "बदनावर" (Badnawar, another town)**. Added a name check (answer must contain the exact mandi name, else retry/template).
- anthropic/claude-sonnet-5.5: could not run. The provider rejects forced `tool_choice` ("type tool and any are not supported for this model").
- **Demo model: deepseek-v4.1-flash** (decision #7: grounding + Hindi check on it and a stronger model).

**Reliability:** every tool call logs status (live/cache/stale_cache/error) and ms in the trace; LLM tokens and cost per call are logged. Per-request p50/p95 from the grounding run are above.

## M9 — Submission pack (31 Oct)
- [x] README: problem, solution, setup, env vars, Mermaid architecture, data sources + licences, tests/backtest, limitations (team names to add)
- [x] `docs/EXPLAIN.md` complete (team to read)
- [x] Slide content: `docs/SLIDES.md` (6 slides)
- [ ] Demo video: script in `docs/DEMO.md`; record from the deployed app (team)
- [x] Final grep: no mock/sample/dummy data files, no hardcoded prices, no secrets ("sample" hits are the statistics term only)

**Status: everything that doesn't need a team account or recordings is done.**

## Loop: 7-day median ranking + nearer on close calls (31 Oct)
- **Goal:** team decision after M8: rank on the 7-day median, prefer the nearer mandi on close calls.
- **Build:**
  - `net_profit.ranking_price`: median of the mandi's own modal over the last 7 days (3+ reports, today's report included), else its latest modal.
  - `rank(..., near_tie)`: among mandis within `NEAR_TIE_PER_Q = 50` ₹/q of the best, the nearest goes first. ₹50 is a judgement call, labelled as such in `compute.py`.
  - The result carries `price_used`, `price_days` and `nearer_pick` (skipped mandi, extra ₹/q, extra km). These show in the trace, the facts for the LLM, and the UI (a "हिसाब का भाव" line, a table column "भाव (7 दिन)", the cost breakdown).
  - The backtest gained a `median7_near` strategy, which is exactly the live rule.
- **Check:** ruff, mypy --strict, 38 tests (new: near-tie order, median needs 3 reports), tsc, eslint.
- **Verify:**
  - Live: 40 q soybean, Ujjain → Ujjain APMC, price used ₹6,900 (median) while today's modal is ₹7,025.
  - Backtest rerun (mean gain ₹/q at 0.5 / 1 / 2):

| Crop | today | median7 | median7_near (live) |
|---|---|---|---|
| Onion | +437 / +401 / +379 | +540 / +482 / +429 | +511 / +470 / +413 |
| Soybean | +27 / −32 / −73 | +61 / +15 / −4 | +69 / +39 / −5 |

  - Onion's "today" numbers moved by under ₹11 from the earlier run, because the cached history refreshed.
- **Reflect:** the near rule helps soybean (prices are uniform, so distance matters more) and costs onion ₹12–29/q for shorter trips. Mean regret at ₹1/q-km: soybean 344 (best of the three), onion 315 (same as median7).
