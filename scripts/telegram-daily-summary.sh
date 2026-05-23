#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

SECRET="${MONITOR_SECRET:-}"
if [ -z "$SECRET" ]; then
  echo "MONITOR_SECRET ausente; resumo diário não enviado" >&2
  exit 1
fi

PORT_VALUE="${PORT:-3000}"
DRY_RUN_PARAM=""
if [ "${DAILY_SUMMARY_DRY_RUN:-0}" = "1" ]; then
  DRY_RUN_PARAM="?dryRun=1"
fi
response="$(curl -fsS -X POST -H "x-glc-webhook-secret: $SECRET" "http://127.0.0.1:${PORT_VALUE}/api/telegram/daily-summary${DRY_RUN_PARAM}")"
node -e '
const j = JSON.parse(process.argv[1]);
console.log(JSON.stringify({
  ts: new Date().toISOString(),
  ok: j.ok,
  chamadosTotal: j.chamadosTotal || null,
  pendingApprovals: j.pendingApprovals ?? null,
  approvedOpen: j.approvedOpen ?? null,
  witEnabled: j.witEnabled ?? null,
  error: j.error || null,
}));
if (!j.ok) process.exit(1);
' "$response"
