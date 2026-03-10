#!/usr/bin/env bash

# agents ops:doctor — Diagnose the Marketing OS agent setup.
# Checks runtime, config, env vars, and API connectivity.

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

log_success() { echo -e "  ${GREEN}✓${NC} $1"; }
log_warning() { echo -e "  ${YELLOW}⚠${NC} $1"; }
log_error()   { echo -e "  ${RED}✗${NC} $1"; }
log_section() { echo -e "\n${BOLD}$1${NC}"; }

WARNINGS=0
ERRORS=0

echo ""
echo -e "${BOLD}${BLUE}Marketing OS — Doctor${NC}"

# ── Runtime ──────────────────────────────────────────────────────────────────
log_section "Runtime"

if command -v node &> /dev/null; then
  NODE_V=$(node -v)
  NODE_MAJOR=$(echo "$NODE_V" | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 20 ]; then
    log_success "Node.js $NODE_V"
  else
    log_error "Node.js $NODE_V (need v20+)"
    ERRORS=$((ERRORS + 1))
  fi
else
  log_error "Node.js not found"
  ERRORS=$((ERRORS + 1))
fi

for tool in pnpm npm vercel shopify git; do
  if command -v "$tool" &> /dev/null; then
    log_success "$tool"
  else
    if [ "$tool" = "vercel" ] || [ "$tool" = "shopify" ]; then
      log_warning "$tool not installed (optional)"
      WARNINGS=$((WARNINGS + 1))
    else
      log_error "$tool not found"
      ERRORS=$((ERRORS + 1))
    fi
  fi
done

# ── Project structure ────────────────────────────────────────────────────────
log_section "Project structure"

if [ -d "$AGENTS_DIR" ]; then
  log_success "agents/ directory"
else
  log_error "agents/ directory missing"
  ERRORS=$((ERRORS + 1))
fi

if [ -f "$ROOT_DIR/marketing-os.config.json" ]; then
  log_success "marketing-os.config.json"
else
  log_warning "marketing-os.config.json missing"
  WARNINGS=$((WARNINGS + 1))
fi

for f in "agents/package.json" "agents/next.config.ts" "agents/src/mastra/index.ts"; do
  if [ -f "$ROOT_DIR/$f" ]; then
    log_success "$f"
  else
    log_warning "$f missing"
    WARNINGS=$((WARNINGS + 1))
  fi
done

if [ -d "$AGENTS_DIR/node_modules" ]; then
  log_success "agents/node_modules/ installed"
else
  log_warning "agents/node_modules/ missing — run ./agents.sh setup"
  WARNINGS=$((WARNINGS + 1))
fi

# ── Environment ──────────────────────────────────────────────────────────────
log_section "Environment variables"

ENV_FILE="$AGENTS_DIR/.env.local"

if [ ! -f "$ENV_FILE" ]; then
  log_error ".env.local file missing in agents/"
  echo -e "    ${DIM}Run: ./agents.sh setup${NC}"
  ERRORS=$((ERRORS + 1))
else
  log_success ".env.local file exists"

  check_env_var() {
    local var="$1"
    local required="${2:-true}"
    if grep -q "^${var}=.\+" "$ENV_FILE" 2>/dev/null; then
      log_success "$var"
    elif [ "$required" = "true" ]; then
      log_error "$var not set"
      ERRORS=$((ERRORS + 1))
    else
      log_warning "$var not set (optional)"
      WARNINGS=$((WARNINGS + 1))
    fi
  }

  check_env_var "ANTHROPIC_API_KEY" true
  check_env_var "SUPABASE_URL" false
  check_env_var "SUPABASE_ANON_KEY" false
  check_env_var "DATABASE_URL" false
  check_env_var "SHOPIFY_ACCESS_TOKEN" false
fi

# ── API connectivity ────────────────────────────────────────────────────────
log_section "API connectivity"

if curl -sf --max-time 5 "https://api.anthropic.com/" > /dev/null 2>&1; then
  log_success "Anthropic API reachable"
else
  log_warning "Anthropic API unreachable (may be a firewall issue)"
  WARNINGS=$((WARNINGS + 1))
fi

if [ -f "$ENV_FILE" ]; then
  SUPA_URL=$(grep "^SUPABASE_URL=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
  if [ -n "$SUPA_URL" ]; then
    if curl -sf --max-time 5 "${SUPA_URL}/rest/v1/" > /dev/null 2>&1; then
      log_success "Supabase reachable"
    else
      log_warning "Supabase unreachable at ${SUPA_URL}"
      WARNINGS=$((WARNINGS + 1))
    fi
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────
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
