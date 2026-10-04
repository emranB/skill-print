#!/usr/bin/env bash
# Local cleanup then npm run dev. Docker Compose is separate.

set -euo pipefail
cd "$(dirname "$0")"

echo "SkillPrint local run"
echo "Docker Compose is separate. This script only starts npm run dev."
echo

stop_port() {
  local port="$1"
  local pid
  while read -r pid; do
    [[ -z "$pid" || "$pid" == "0" ]] && continue
    echo "  stopping PID ${pid} on port ${port}"
    if command -v taskkill.exe >/dev/null 2>&1; then
      taskkill.exe //PID "$pid" //T //F >/dev/null 2>&1 || true
    elif command -v lsof >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  done < <(
    netstat -ano 2>/dev/null | grep LISTENING | grep -E ":${port}[[:space:]]" | awk '{print $NF}' | sort -u
  )
}

echo "[1/3] Stopping leftover local listeners on 5173 and 8000..."
stop_port 5173
stop_port 8000

if command -v docker >/dev/null 2>&1; then
  echo "Stopping docker compose if it is holding port 8000..."
  docker compose stop >/dev/null 2>&1 || true
  stop_port 8000
fi

sleep 1

echo "[2/3] Installing dependencies if needed..."
if [[ ! -d node_modules ]]; then
  npm install
fi

if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
  echo "Copied .env.example to .env. Add your ElevenLabs key before using the live apprentice."
fi

echo "[3/3] Starting local app: UI http://localhost:5173  API http://localhost:8000"
exec npm run dev
