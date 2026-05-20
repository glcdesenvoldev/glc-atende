#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -z "${MONITOR_SECRET:-}" ]; then
  echo "MONITOR_SECRET ausente"
  exit 1
fi

url="http://127.0.0.1:${PORT:-3000}/api/monitor/wit?dryRun=0&notify=1"
response="$(curl -fsS -H "x-glc-webhook-secret: $MONITOR_SECRET" "$url")"
node -e '
const input = process.argv[1];
const j = JSON.parse(input);
console.log(JSON.stringify({
  ts: new Date().toISOString(),
  ok: j.ok,
  configured: j.configured,
  ticketCount: j.ticketCount,
  alertCount: j.alertCount,
  error: j.error || null,
}));
if (!j.configured || j.ok === false) process.exit(1);
' "$response"
