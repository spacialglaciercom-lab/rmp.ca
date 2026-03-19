#!/usr/bin/env bash
# Check port usage for rmp.ca-main to detect conflicts.
# Usage: ./scripts/check-ports.sh   or   bash scripts/check-ports.sh

set -e

PORTS="3000 4000 8000 8082 8083 8501 8502 8503 19006 19007"
echo "=== rmp.ca-main port usage ==="
echo ""

for p in $PORTS; do
  if command -v ss &>/dev/null; then
    out=$(ss -tlnp 2>/dev/null | grep -E ":$p\s" || true)
  else
    out=$(netstat -tlnp 2>/dev/null | grep -E ":$p\s|\.$p " || true)
  fi
  if [ -n "$out" ]; then
    echo "Port $p: IN USE"
    lsof -i :$p 2>/dev/null | head -4 || true
  else
    echo "Port $p: free"
  fi
  echo ""
done

echo "=== What uses what ==="
echo "  3000  = Node API server (preferred). If busy, server falls back to 8082."
echo "  4000  = Extract service (Docker or local)."
echo "  8000  = Python optimizer (Docker or local)."
echo "  8082  = Node API fallback when 3000 is taken."
echo "  8501+ = Streamlit dashboard (default 8501; 8502, 8503 if 8501 busy)."
echo "  19007 = Expo web app (pnpm run dev)."
echo ""
echo "=== Start web page ==="
echo "  1. API server:  pnpm run dev:server   (wants 3000; uses 8082 if 3000 busy)"
echo "  2. Web app:     pnpm run dev          (opens http://localhost:19007)"
echo "  If API is on 8082, set in .env:  EXPO_PUBLIC_API_BASE_URL=http://localhost:8082"
echo ""
