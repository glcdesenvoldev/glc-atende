#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

export WITHUB_URL="${WITHUB_URL:-${WITHUB_URL:-https://app.withub.ai/}}"
export WITHUB_USER="${WITHUB_USER:-${WITHUB_USER:-}}"
export WITHUB_PASSWORD="${WITHUB_PASSWORD:-${WITHUB_PASSWORD:-}}"
export WITHUB_OUT_DIR="${WITHUB_OUT_DIR:-${WITHUB_OUT_DIR:-data/withub}}"
TOOLS_DIR="${WITHUB_PLAYWRIGHT_DIR:-/opt/glc-atende-playwright}"

if [ -z "$WITHUB_USER" ] || [ -z "$WITHUB_PASSWORD" ]; then
  echo "WITHUB_USER/WITHUB_PASSWORD ausentes"
  exit 1
fi

if [ ! -d "$TOOLS_DIR/node_modules/playwright" ]; then
  mkdir -p "$TOOLS_DIR"
  [ -f "$TOOLS_DIR/package.json" ] || npm --prefix "$TOOLS_DIR" init -y >/dev/null
  npm --prefix "$TOOLS_DIR" install playwright@1.60.0 --no-audit --no-fund
fi

mkdir -p node_modules "$WITHUB_OUT_DIR"
ln -sfn "$TOOLS_DIR/node_modules/playwright" node_modules/playwright
ln -sfn "$TOOLS_DIR/node_modules/playwright-core" node_modules/playwright-core

node scripts/withub-map.mjs

if [ -f "$WITHUB_OUT_DIR/storage-state.json" ]; then
  chown 1001:1001 "$WITHUB_OUT_DIR/storage-state.json" 2>/dev/null || true
  chmod 600 "$WITHUB_OUT_DIR/storage-state.json" 2>/dev/null || true
fi
