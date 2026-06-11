#!/usr/bin/env bash
# Local dev: start the inference server with the viewer at http://localhost:$PORT
#
# Usage:
#   ./dev.sh              # default port 8000
#   PORT=8123 ./dev.sh    # override
#
# --reload picks up edits to server/*.py and the buildingcv package without
# a manual restart. Edits to viewer/index.html are served fresh on every
# request, so a browser hard-reload (Cmd+Shift+R) is enough.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8000}"

# Friendly preflight: if something else is already on PORT, fail with a
# message that tells the user what to do, instead of uvicorn's cryptic
# "Address already in use".
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use:" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2
  echo >&2
  echo "Either:" >&2
  echo "  - stop that process, or" >&2
  echo "  - run with a different port: PORT=$((PORT + 1)) ./dev.sh" >&2
  exit 1
fi

echo "→ http://localhost:$PORT"
exec .venv/bin/uvicorn server.main:app --reload --host 127.0.0.1 --port "$PORT"
