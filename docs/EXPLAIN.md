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
