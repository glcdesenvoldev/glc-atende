#!/usr/bin/env bash
set -euo pipefail
cd /docker/glc-atende
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
SECRET="${MONITOR_SECRET:-}"
if [ -z "$SECRET" ]; then
  echo "MONITOR_SECRET ausente; limpeza não executada" >&2
  exit 1
fi
curl -fsS -X POST -H "x-glc-webhook-secret: $SECRET" "https://atende.glcinternet.com.br/api/maintenance/retention" >/dev/null
