# PROGRESS — Harvest Compass

## M0 — Data go/no-go (HUMAN GATE)

**Goal:** prove every live data source works before writing app code.

**Acceptance criteria**
- [ ] data.gov.in key works; real request returns recent prices for target state/crops; resource ID, fields, filters, date format recorded in `docs/DATA_SOURCES.md`.
- [ ] Coverage query: mandis per crop reporting in last 7 days within 150 km of Indore; crops/region chosen by data.
- [ ] Open-Meteo (two models), OSRM route, Nominatim lookup, Sarvam STT+TTS, OpenRouter tool call — all succeed and are logged.
- [ ] If mandi API fails: STOP and report options.

**Plan:** curl each endpoint, record verified request/response shape in DATA_SOURCES.md, paste evidence here.

### Evidence
- **data.gov.in current prices** — resource `9ef84268…` returns rows dated 30/10/2026. MP Soyabean total=193, Onion total=55, Indore district Soyabean=5 (Sanwer, Gautampura). ✅
- **data.gov.in history** — resource `35985678…` returns Indore Soyabean total=22068 (from 2010). ✅ Sorting/date filter not yet verified.
- **Open-Meteo** — ecmwf_ifs025 + gfs_seamless, 7 days, both returned. Example 30 Oct: ECMWF 1.0 mm/53%, GFS 0.3 mm/23%. ✅
- **OSRM** — Indore→Ujjain 56.7 km, 52.7 min. ✅
- **Nominatim** — Ujjain → 23.1885, 75.7717. ✅
- **Coverage query** — ⏳ blocked. Needs our own data.gov.in key (demo key is capped at 10 rows).
- **Sarvam STT+TTS, OpenRouter tool call** — ⏳ blocked. Need keys.

### Reflection
- What worked: the mandi API works and has today's data, so the main risk is gone. No need for a backup idea.
- Gotchas found: date format is DD/MM/YYYY. Variety naming is inconsistent. The two resources name markets differently (` APMC` suffix). History prices are strings. ECMWF can return negative precipitation. data.gov.in latency is unpredictable.
- Status: **M0 partially done. Waiting for keys from humans.**
