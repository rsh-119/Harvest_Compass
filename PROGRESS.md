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
