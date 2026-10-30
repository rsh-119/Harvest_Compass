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
- TODO (needs own key): verify `sort[Arrival_Date]=desc` or date-range filtering, so we can get the last 90 days without paging through 22k rows.

## Open-Meteo forecast ✅
- `GET https://api.open-meteo.com/v1/forecast?latitude=22.7196&longitude=75.8577&daily=precipitation_sum,precipitation_probability_max&models=ecmwf_ifs025,gfs_seamless&timezone=Asia/Kolkata&forecast_days=7`
- With several models, each daily key gets a model suffix: `precipitation_sum_ecmwf_ifs025`, `precipitation_sum_gfs_seamless`, and so on.
- Gotcha: ECMWF returned **`-0.10` mm** for one day. Clamp to ≥ 0.
- No key. CC BY 4.0, so the UI must show attribution.

## OSRM ✅
- `GET https://router.project-osrm.org/route/v1/driving/75.8577,22.7196;75.7849,23.1765?overview=false` (lon,lat order)
- Indore→Ujjain: `distance` 56719.8 m, `duration` 3160.7 s. `code: "Ok"`.
- TODO: verify `/table/v1/driving/...?annotations=distance,duration` for batching.

## Nominatim ✅
- `GET https://nominatim.openstreetmap.org/search?q=Ujjain,Madhya Pradesh,India&format=json&limit=1`, with a custom User-Agent.
- Returns `lat`/`lon` as strings: Ujjain 23.1885131, 75.7716562.
- Max 1 request/second. Cache permanently.

## Sarvam STT/TTS — ⏳ needs SARVAM_API_KEY
## OpenRouter — ⏳ needs OPENROUTER_API_KEY + chosen LLM_MODEL
