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

# Janela de alerta do Monitor WIT/Mundiale.
# Padrão: envia alertas somente das 08:00 até antes das 18:00 no horário de Brasília.
# Fora da janela, o cron roda, mas sai sem chamar o endpoint e sem disparar Telegram.
WIT_MONITOR_TIMEZONE="${WIT_MONITOR_TIMEZONE:-America/Sao_Paulo}"
WIT_MONITOR_START="${WIT_MONITOR_START:-08:00}"
WIT_MONITOR_END="${WIT_MONITOR_END:-18:00}"

if [ "${WIT_MONITOR_FORCE:-0}" != "1" ]; then
  now_hm="$(TZ="$WIT_MONITOR_TIMEZONE" date +%H:%M)"
  now_num="${now_hm%:*}${now_hm#*:}"
  start_num="${WIT_MONITOR_START%:*}${WIT_MONITOR_START#*:}"
  end_num="${WIT_MONITOR_END%:*}${WIT_MONITOR_END#*:}"

  if [ "$now_num" -lt "$start_num" ] || [ "$now_num" -ge "$end_num" ]; then
    echo "$(date -Is) Monitor WIT/Mundiale fora da janela de alerta (${WIT_MONITOR_START}-${WIT_MONITOR_END} ${WIT_MONITOR_TIMEZONE}); sem envio."
    exit 0
  fi
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
