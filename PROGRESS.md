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
