#!/usr/bin/env bash
#
# test.sh — start the API, hammer every endpoint in bulk, and produce one log
# line of every level (debug / info / warn / error). Then summarise what landed
# in logs/. Handy for demoing the logger and for filling logs/app.log with
# realistic, mixed traffic.
#
# Usage:
#   ./test.sh            # 20 rounds (default)
#   ./test.sh 100        # 100 rounds
#
set -euo pipefail

cd "$(dirname "$0")"

ROUNDS="${1:-20}"
PORT="${PORT:-3000}"
BASE="http://localhost:${PORT}"

# Run at debug so the debug-level "listing all students" line shows up too.
export LOG_LEVEL=debug
export PORT

echo "Starting server on :${PORT} (LOG_LEVEL=${LOG_LEVEL})..."
node app.js >/dev/null 2>&1 &
SERVER_PID=$!

# Always stop the server, even if the script errors out.
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

# Wait for the port to accept connections (up to ~5s).
for _ in $(seq 1 50); do
  if curl -s -o /dev/null "${BASE}/students"; then break; fi
  sleep 0.1
done

echo "Firing ${ROUNDS} rounds of mixed traffic..."
for i in $(seq 1 "$ROUNDS"); do
  curl -s -o /dev/null "${BASE}/students"            # info + debug
  curl -s -o /dev/null "${BASE}/students/2"          # info (student found)
  curl -s -o /dev/null "${BASE}/students/999"        # warn (not found)
  curl -s -o /dev/null "${BASE}/boom"                # error (500)
done

# Give winston's file transport a moment to flush to disk.
sleep 0.5

echo
echo "=== logs/app.log line counts by level (${ROUNDS} rounds) ==="
for level in debug info warn error; do
  count=$(grep -c "\"level\":\"${level}\"" logs/app.log 2>/dev/null || true)
  printf "  %-6s %s\n" "$level" "${count:-0}"
done

echo
echo "=== logs/error.log (errors only) ==="
printf "  %s lines\n" "$(wc -l < logs/error.log 2>/dev/null | tr -d ' ' || echo 0)"

echo
echo "Done. Inspect with:  tail -f logs/app.log"
