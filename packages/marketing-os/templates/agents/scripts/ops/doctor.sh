#!/usr/bin/env bash

# agents ops:doctor — Diagnose the Marketing OS agent setup.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

ROOT_DIR="${AGENTS_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
AGENTS_DIR="${AGENTS_APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

log_success() { echo -e "  ${GREEN}✓${NC} $1"; }
log_warning() { echo -e "  ${YELLOW}⚠${NC} $1"; }
log_error()   { echo -e "  ${RED}✗${NC} $1"; }
log_section() { echo -e "\n${BOLD}$1${NC}"; }

WARNINGS=0
ERRORS=0

echo ""
echo -e "${BOLD}${BLUE}Marketing OS — Doctor${NC}"

log_section "Runtime"

if command -v node &> /dev/null; then
  NODE_V=$(node -v)
  NODE_MAJOR=$(echo "$NODE_V" | sed 's/v//' | cut -d. -f1)
  [ "$NODE_MAJOR" -ge 20 ] && log_success "Node.js $NODE_V" || { log_error "Node.js $NODE_V (need v20+)"; ERRORS=$((ERRORS+1)); }
else
  log_error "Node.js not found"; ERRORS=$((ERRORS+1))
fi

for tool in npm vercel shopify git; do
  if command -v "$tool" &> /dev/null; then
    log_success "$tool"
  elif [ "$tool" = "vercel" ] || [ "$tool" = "shopify" ]; then
    log_warning "$tool not installed (optional)"; WARNINGS=$((WARNINGS+1))
  else
    log_error "$tool not found"; ERRORS=$((ERRORS+1))
  fi
done

log_section "Project structure"

for f in "package.json" "next.config.ts" "src/mastra/index.ts"; do
  [ -f "$AGENTS_DIR/$f" ] && log_success "$f" || { log_warning "$f missing"; WARNINGS=$((WARNINGS+1)); }
done

[ -d "$AGENTS_DIR/node_modules" ] && log_success "node_modules/ installed" || { log_warning "node_modules/ missing — run ./agents.sh setup"; WARNINGS=$((WARNINGS+1)); }
[ -f "$ROOT_DIR/marketing-os.config.json" ] && log_success "marketing-os.config.json" || { log_warning "marketing-os.config.json missing"; WARNINGS=$((WARNINGS+1)); }

log_section "Environment variables"

ENV_FILE="$AGENTS_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  log_error ".env missing"; ERRORS=$((ERRORS+1))
else
  log_success ".env exists"
  for var in "ANTHROPIC_API_KEY"; do
    grep -q "^${var}=.\+" "$ENV_FILE" 2>/dev/null && log_success "$var" || { log_error "$var not set"; ERRORS=$((ERRORS+1)); }
  done
  for var in "SUPABASE_URL" "SUPABASE_ANON_KEY" "DATABASE_URL" "SHOPIFY_ACCESS_TOKEN"; do
    grep -q "^${var}=.\+" "$ENV_FILE" 2>/dev/null && log_success "$var" || { log_warning "$var not set (optional)"; WARNINGS=$((WARNINGS+1)); }
  done
fi

log_section "API connectivity"

curl -sf --max-time 5 "https://api.anthropic.com/" > /dev/null 2>&1 && log_success "Anthropic API reachable" || { log_warning "Anthropic API unreachable"; WARNINGS=$((WARNINGS+1)); }

echo ""
if [ "$ERRORS" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}All checks passed!${NC}"
elif [ "$ERRORS" -eq 0 ]; then
  echo -e "${YELLOW}${BOLD}Passed with ${WARNINGS} warning(s).${NC}"
else
  echo -e "${RED}${BOLD}${ERRORS} error(s), ${WARNINGS} warning(s).${NC}"
fi
echo ""
exit $ERRORS
