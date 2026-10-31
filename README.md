# Harvest Compass

An AI agent that tells Indian farmers which mandi pays the most after transport costs, and which days are dry enough to harvest and move the crop. Farmers ask by voice or text in English or any of the 22 scheduled Indian languages.

## Problem

Most farmers sell at the nearest mandi or wherever a trader suggests. Prices vary between mandis, but so does the cost of reaching them, so the highest listed price is often not the best deal. The public price data that could help is scattered, published in English, often several days old, and sometimes distorted by a single unusual lot. Rain on harvest or transport day damages the crop, and forecasts are rarely presented in a form a farmer can act on.

## Solution

The farmer describes their crop, quantity and village. The agent:

1. Extracts a structured request from the question and asks one short follow-up when something is missing or ambiguous (vehicle hire rate, sack weight, which of two villages with the same name).
2. Fetches current and historical mandi prices, two weather models and road distances in parallel.
3. Audits the prices and excludes stale, inconsistent, outlier and non-comparable entries, recording the reason for each.
4. Ranks every reachable mandi in the farmer's state by **net ₹ per quintal**: the 7-day median price minus round-trip transport at the farmer's own vehicle rate.
5. Marks harvest days as safe only when both weather models expect no rain, including the transport day that follows.
6. Replies in the farmer's language, as text and, where a voice is available, as speech.

The language model is used only to read the question and to phrase the reply. Every number is computed by deterministic code, and a validator rejects any reply that contains a number or mandi name not present in the computed facts.

## Architecture

```mermaid
flowchart LR
  F[Farmer] -->|voice| STT[Sarvam STT]
  STT --> UI
  F -->|text| UI[Next.js frontend]
  UI -->|POST /ask · SSE| API[FastAPI]
  API --> G

  subgraph G[LangGraph agent]
    direction LR
    UN[Understand<br/>LLM] --> PL[Plan<br/>rules] --> EX[Execute<br/>parallel tools] --> AU[Audit<br/>rules]
    AU -->|too few usable mandis| RP[Repair<br/>widen radius] --> EX
    AU --> CO[Compute<br/>scoring] --> XP[Explain<br/>LLM + validator]
  end

  EX --> M[data.gov.in<br/>mandi prices]
  EX --> W[Open-Meteo<br/>ECMWF + GFS]
  EX --> R[OSRM<br/>road routing]
  EX --> N[Nominatim<br/>geocoding]
  M & W & R & N --- C[(Postgres cache)]
  XP --> TTS[Sarvam TTS] --> UI
```

Each node streams trace events to the frontend over Server-Sent Events, so the user sees every step as it runs.

| Step | Implementation | Responsibility |
|---|---|---|
| Understand | LLM (forced tool call) | Convert free text into a typed intent: crop, quantity, village, harvest window, vehicle rate. Ask a clarifying question when required. |
| Plan | Rules | Choose which data sources the question needs. |
| Execute | Async tools | Call all sources concurrently with timeouts and one retry. Cache each response with its source URL and fetch time. |
| Audit | Rules | Reject prices older than 3 days, with min > max, or that are robust z-score outliers against the mandi's own 30-day history and the region; keep variety and grade comparable. |
| Repair | Rules | Fall back to each mandi's latest stored report if today's feed fails, to the remaining weather model if one fails, or widen the search radius from 150 km to 250 km. |
| Compute | Pure functions | Net price per quintal, conservative "bad-day" price, harvest-day safety, and the 14-day price trend for "should I wait?" questions. If a farther mandi wins by ₹50/quintal or less, the nearer one is recommended. |
| Explain | LLM + validator | Phrase the result in the farmer's language. Replies with unknown numbers or altered mandi names are rejected, retried once, then replaced by a fixed template. |

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS 4, Leaflet |
| Backend | Python 3.11, FastAPI, LangGraph, Pydantic v2, httpx |
| Database | PostgreSQL (Neon), psycopg 3: response cache and backtest results |
| LLM | `deepseek/deepseek-v4.1-flash` via OpenRouter |
| Speech | Sarvam AI: `saaras:v4` speech-to-text (23 languages), `bulbul:v4-flash` text-to-speech (9 languages) |
| Hosting | Render (backend, Docker), Vercel (frontend) |

## Project structure

```
backend/
  app/
    agent/        LangGraph graph, state and nodes (understand, plan, execute, audit, repair, compute, explain)
    tools/        one module per external source: mandi, weather, routing, geocode, voice
    scoring/      net profit, harvest window, trend, audit rules (pure functions)
    backtest/     historical replay of the ranking strategy
    data/         cache, regions, crop synonyms, request log
    main.py       FastAPI app: /ask (SSE), /transcribe, /health, /stats, /backtest
  scripts/        CLI tools: ask, smoke test, grounding test, cache warm-up, UI translation
  tests/          pytest suite
frontend/
  app/            pages: home, ask, how-it-works, results, data, about
  components/     shared UI (map, flow diagram, backtest and usage cards)
  lib/            API client, i18n
  locales/        UI text for 23 languages (English and Hindi hand-written, others generated)
```

## Data sources

| Source | Used for | Licence |
|---|---|---|
| [data.gov.in](https://data.gov.in) (Agmarknet): daily prices `9ef84268-…`, variety-wise history `35985678-…` | Mandi prices | Government Open Data License – India |
| [Open-Meteo](https://open-meteo.com): ECMWF IFS 0.25°, GFS | Rain forecast | CC BY 4.0 |
| [OSRM](https://project-osrm.org) | Road distance and drive time | ODbL (OpenStreetMap data) |
| [Nominatim](https://nominatim.org) | Village and mandi coordinates | ODbL; ≤ 1 request/s, results cached |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) tiles | Map | ODbL |
| [Sarvam AI](https://www.sarvam.ai) | Speech input and output | API terms |
| [OpenRouter](https://openrouter.ai) | LLM access | API terms |

All prices, forecasts and distances come from these APIs or from cached copies of their responses, stored with `source_url` and `fetched_at`.

**Mandi fee.** In Madhya Pradesh the market fee is paid by the buyer (Krishi Upaj Mandi Adhiniyam 1972, Sec. 19(2)), so the seller's fee is zero. Other states' rules are not yet encoded, and the answer states that the fee is excluded. Hammali and weighing charges vary by mandi committee and are entered by the user.

## Evaluation

**Backtest** (`app/backtest/run_backtest.py`): 30 villages in Madhya Pradesh, 60 days (31 Aug – 30 Oct 2026), real data.gov.in history. Each day the strategy chooses a mandi using only data available that day, and is scored on the next day's price against the nearest mandi. Mean gain in ₹/quintal at assumed transport rates of ₹0.5 / 1 / 2 per quintal-km:

| Crop | Today's price | 7-day median | 7-day median + nearer on close calls (live) |
|---|---|---|---|
| Onion | +437 / +401 / +379 | +540 / +482 / +429 | +511 / +470 / +413 |
| Soybean | +27 / −32 / −73 | +61 / +15 / −4 | +69 / +39 / −5 |

Choosing the mandi matters for onion, where prices vary widely between mandis. Soybean prices are nearly uniform across the state, so the nearest mandi is usually close to optimal. About 30% of decisions could not be scored because the chosen mandi did not report the next day.

**Grounding** (`scripts/grounding.py`): 20 varied Hindi and Hinglish questions run through the full agent. 19 answered, 1 correctly asked for clarification; 0 invented numbers; median latency 11.4 s, p95 15.3 s.

## Getting started

Requirements: Python 3.11+, [uv](https://docs.astral.sh/uv/), Node.js 20+.

```bash
cp .env.example .env

# Backend
cd backend
uv sync
uv run uvicorn app.main:app --reload    # on Windows add: --loop asyncio:SelectorEventLoop

# Frontend (new terminal)
cd frontend
npm install
npm run dev                             # http://localhost:3000
```

### Environment variables

| Variable | Description |
|---|---|
| `DATA_GOV_IN_API_KEY` | data.gov.in API key |
| `SARVAM_API_KEY` | Sarvam AI API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `LLM_MODEL` | Model ID, e.g. `deepseek/deepseek-v4.1-flash` |
| `DATABASE_URL` | PostgreSQL connection string |
| `NOMINATIM_USER_AGENT` | Identifying User-Agent for OpenStreetMap services |
| `FRONTEND_ORIGIN` | Allowed CORS origin |
| `VOICE_DAILY_LIMIT` | Daily cap on live Sarvam calls (default 60) |
| `NEXT_PUBLIC_API_URL` | Backend URL used by the frontend |

## Testing

```bash
bash check.sh                                   # ruff, mypy --strict, pytest, eslint, tsc

cd backend
uv run python -m scripts.smoke                  # one live call to every data source
uv run python -m scripts.ask "40 quintal soybean, village Sanwer, Indore, vehicle ₹35/km, 30 q per trip"
uv run python -m scripts.ask "..." --fault weather_ecmwf    # simulate a source failure
uv run python -m scripts.grounding              # invented-number check over 20 questions
uv run python -m app.backtest.run_backtest      # results stored in the backtest_runs table
uv run python -m scripts.warm                   # pre-cache prices and mandi locations for all states
```

## Deployment

- **Backend:** Render web service, root `backend`, Docker. Set the environment variables above.
- **Frontend:** Vercel, root `frontend`, with `NEXT_PUBLIC_API_URL` pointing to the backend.
- `/health` runs lightweight checks against each source (cached for 60 s) and can be polled to keep a free instance awake.
- Rate limits: 10 paid requests per minute per client, 300 per hour overall.

## Limitations

- Transport cost depends on the rate the farmer provides; the backtest uses assumed rates.
- data.gov.in history lags by a day and many mandis do not report daily.
- Only mandis within the farmer's state are compared.
- Weather forecasts cover 7 days; later dates are shown without a forecast.
- Market fees are modelled for Madhya Pradesh only.
- Rate limiting is in-memory and assumes a single backend instance.
- The first query from a state with no cached mandi locations is slow, because Nominatim allows one lookup per second; `scripts.warm` pre-fills the cache.
