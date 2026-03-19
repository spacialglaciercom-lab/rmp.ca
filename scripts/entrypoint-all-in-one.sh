#!/bin/sh
# Run Python optimizer on 8000 and Node API on $PORT. Single container for Cloud Run.
set -e

OPTIMIZER_PORT=8000

# Start Python optimizer in background (Node will proxy to http://127.0.0.1:8000)
# Run from backend dir so `app.main` resolves
cd /app/backend && uvicorn app.main:app --host 0.0.0.0 --port "$OPTIMIZER_PORT" &
UVICORN_PID=$!
cd /app

# Give uvicorn a moment to bind
sleep 2

# Node reads PORT from env (Cloud Run sets it). Proxy optimizer to local Python.
export OPTIMIZER_BACKEND_URL="http://127.0.0.1:${OPTIMIZER_PORT}"

# Run Node in foreground; on exit or SIGTERM, kill uvicorn too
node dist/index.js &
NODE_PID=$!
trap 'kill $UVICORN_PID $NODE_PID 2>/dev/null; exit' TERM INT
wait $NODE_PID
kill $UVICORN_PID 2>/dev/null || true
exit 0
