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

ROOT_DIR="${AGENTS_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
AGENTS_DIR="${AGENTS_APP_DIR:-$ROOT_DIR/agents}"

ENV_FILE="$AGENTS_DIR/.env.local"
ENV_EXAMPLE="$AGENTS_DIR/.env.example"

echo ""
echo -e "${BOLD}${BLUE}Environment Variable Status${NC}"
echo ""

if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$ENV_EXAMPLE" ]; then
    echo -e "${YELLOW}⚠${NC} .env.local not found — creating from .env.example"
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    echo -e "${GREEN}✓${NC} agents/.env.local created"
    echo ""
  else
    echo -e "${RED}No .env.local or .env.example found in agents/${NC}"
    echo -e "${DIM}Run './agents.sh setup' to configure environment.${NC}"
    echo ""
    exit 1
  fi
fi

REQUIRED=(
  "ANTHROPIC_API_KEY"
)

OPTIONAL=(
  "SUPABASE_URL"
  "SUPABASE_ANON_KEY"
  "DATABASE_URL"
  "SHOPIFY_ACCESS_TOKEN"
  "SHOPIFY_STORE_URL"
  "GA4_PROPERTY_ID"
  "GA4_CREDENTIALS_JSON"
  "META_ACCESS_TOKEN"
  "META_AD_ACCOUNT_ID"
  "GOOGLE_ADS_CUSTOMER_ID"
  "GOOGLE_ADS_CREDENTIALS_JSON"
  "KLAVIYO_API_KEY"
  "GITHUB_TOKEN"
)

echo -e "${BOLD}Required${NC}"
for var in "${REQUIRED[@]}"; do
  VALUE=$(grep "^${var}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
  if [ -n "$VALUE" ]; then
    # Mask the value, show first 4 and last 4 chars
    LEN=${#VALUE}
    if [ "$LEN" -gt 12 ]; then
      MASKED="${VALUE:0:4}$( printf '•%.0s' $(seq 1 $((LEN - 8))) )${VALUE: -4}"
    else
      MASKED="••••••••"
    fi
    echo -e "  ${GREEN}✓${NC} ${var}=${DIM}${MASKED}${NC}"
  else
    echo -e "  ${RED}✗${NC} ${var}  ${DIM}(missing — required)${NC}"
  fi
done

echo ""
echo -e "${BOLD}Optional${NC}"
for var in "${OPTIONAL[@]}"; do
  VALUE=$(grep "^${var}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
  if [ -n "$VALUE" ]; then
    LEN=${#VALUE}
    if [ "$LEN" -gt 12 ]; then
      MASKED="${VALUE:0:4}$( printf '•%.0s' $(seq 1 $((LEN - 8))) )${VALUE: -4}"
    else
      MASKED="••••••••"
    fi
    echo -e "  ${GREEN}✓${NC} ${var}=${DIM}${MASKED}${NC}"
  else
    echo -e "  ${YELLOW}–${NC} ${var}  ${DIM}(not set)${NC}"
  fi
done

echo ""
