#!/usr/bin/env bash

# agents ops:env — Validate and display environment variable status.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

AGENTS_DIR="${AGENTS_APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ENV_FILE="$AGENTS_DIR/.env"

echo ""
echo -e "${BOLD}${BLUE}Environment Variable Status${NC}"
echo ""

if [ ! -f "$ENV_FILE" ]; then
  echo -e "${RED}No .env file found in agents/${NC}"
  [ -f "$AGENTS_DIR/.env.example" ] && echo -e "${DIM}Create one: cp agents/.env.example agents/.env${NC}"
  echo ""
  exit 1
fi

mask_value() {
  local val="$1"
  local len=${#val}
  if [ "$len" -gt 12 ]; then
    echo "${val:0:4}$(printf '•%.0s' $(seq 1 $((len - 8))))${val: -4}"
  else
    echo "••••••••"
  fi
}

echo -e "${BOLD}Required${NC}"
for var in "ANTHROPIC_API_KEY"; do
  VALUE=$(grep "^${var}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
  if [ -n "$VALUE" ]; then
    echo -e "  ${GREEN}✓${NC} ${var}=${DIM}$(mask_value "$VALUE")${NC}"
  else
    echo -e "  ${RED}✗${NC} ${var}  ${DIM}(missing — required)${NC}"
  fi
done

echo ""
echo -e "${BOLD}Optional${NC}"
for var in SUPABASE_URL SUPABASE_ANON_KEY DATABASE_URL SHOPIFY_ACCESS_TOKEN SHOPIFY_STORE_URL \
           GA4_PROPERTY_ID META_ACCESS_TOKEN META_AD_ACCOUNT_ID KLAVIYO_API_KEY GITHUB_TOKEN; do
  VALUE=$(grep "^${var}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
  if [ -n "$VALUE" ]; then
    echo -e "  ${GREEN}✓${NC} ${var}=${DIM}$(mask_value "$VALUE")${NC}"
  else
    echo -e "  ${YELLOW}–${NC} ${var}  ${DIM}(not set)${NC}"
  fi
done

echo ""
