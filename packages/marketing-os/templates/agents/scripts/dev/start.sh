#!/usr/bin/env bash

# agents dev:start — Start the Marketing OS agent dev server.
# Pass --shopify to concurrently run Shopify theme dev.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

ROOT_DIR="${AGENTS_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
AGENTS_DIR="${AGENTS_APP_DIR:-$ROOT_DIR}"

log_info()    { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error()   { echo -e "${RED}✗${NC} $1" >&2; }

WITH_SHOPIFY=false
AGENT_PORT="${AGENT_PORT:-3000}"
SHOPIFY_PORT="${SHOPIFY_PORT:-9292}"

for arg in "$@"; do
  case "$arg" in
    --shopify)  WITH_SHOPIFY=true ;;
    --port=*)   AGENT_PORT="${arg#*=}" ;;
    *)          ;;
  esac
done

if [ ! -d "$AGENTS_DIR/app" ]; then
  log_error "Agent app not found. Run './agents.sh setup' first."
  exit 1
fi

if [ -f "$AGENTS_DIR/pnpm-lock.yaml" ]; then PM="pnpm"
elif [ -f "$AGENTS_DIR/yarn.lock" ];     then PM="yarn"
else PM="npm"
fi

PIDS=()

cleanup() {
  echo ""
  log_info "Shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  log_success "All processes stopped"
}

trap cleanup EXIT INT TERM

echo ""
echo -e "${BOLD}${CYAN}Marketing OS${NC} ${DIM}— Development Server${NC}"
echo ""

cd "$AGENTS_DIR"
PORT="$AGENT_PORT" $PM run dev &
PIDS+=($!)
AGENT_PID=$!

if [ "$WITH_SHOPIFY" = true ]; then
  if ! command -v shopify &> /dev/null; then
    log_error "Shopify CLI not installed. Install with: npm i -g @shopify/cli"
    log_warning "Continuing with agent server only..."
  else
    cd "$ROOT_DIR"
    THEME_DIR=""
    for candidate in "." "theme" "shopify"; do
      if [ -f "$ROOT_DIR/$candidate/config/settings_schema.json" ]; then
        THEME_DIR="$ROOT_DIR/$candidate"
        break
      fi
    done

    if [ -n "$THEME_DIR" ]; then
      log_info "Starting Shopify theme dev on port ${SHOPIFY_PORT}..."
      shopify theme dev --path "$THEME_DIR" --port "$SHOPIFY_PORT" &
      PIDS+=($!)
      echo ""
      log_success "Shopify theme:  ${BOLD}http://localhost:${SHOPIFY_PORT}${NC}"
    else
      log_warning "No Shopify theme found. Skipping theme dev."
    fi
  fi
fi

echo ""
log_success "Agent dashboard: ${BOLD}http://localhost:${AGENT_PORT}${NC}"
echo ""
echo -e "${DIM}Press Ctrl+C to stop all servers${NC}"
echo ""

wait "$AGENT_PID"
