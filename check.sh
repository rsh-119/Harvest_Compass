#!/usr/bin/env bash
# One command for format + lint + types + tests. Run from repo root: bash check.sh
set -euo pipefail
cd "$(dirname "$0")/backend"
uv run ruff format --check .
uv run ruff check .
uv run mypy app
uv run pytest -q
cd ../frontend
npm run lint
npx tsc --noEmit
