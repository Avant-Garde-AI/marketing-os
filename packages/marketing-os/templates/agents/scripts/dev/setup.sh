#!/usr/bin/env bash

# agents dev:setup — First-time setup for the Marketing OS agent app.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

ROOT_DIR="${AGENTS_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
AGENTS_DIR="${AGENTS_APP_DIR:-$ROOT_DIR}"

log_info()    { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error()   { echo -e "${RED}✗${NC} $1" >&2; }
log_step()    { echo -e "\n${BOLD}$1${NC}\n"; }

ERRORS=0

log_step "1/4  Checking prerequisites"

if command -v node &> /dev/null; then
  NODE_VERSION=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 20 ]; then
    log_success "Node.js v${NODE_VERSION}"
  else
    log_error "Node.js v${NODE_VERSION} found — v20+ required"
    ERRORS=$((ERRORS + 1))
  fi
else
  log_error "Node.js not found (v20+ required)"
  ERRORS=$((ERRORS + 1))
fi

if command -v pnpm &> /dev/null; then
  PM="pnpm"; log_success "pnpm $(pnpm -v)"
elif command -v npm &> /dev/null; then
  PM="npm"; log_success "npm $(npm -v)"
else
  log_error "No package manager found"
  ERRORS=$((ERRORS + 1))
fi

if command -v vercel &> /dev/null; then
  log_success "Vercel CLI detected"
else
  log_warning "Vercel CLI not installed (needed for deploy)"
  echo -e "  ${DIM}Install: npm i -g vercel${NC}"
fi

if command -v shopify &> /dev/null; then
  log_success "Shopify CLI detected"
else
  log_warning "Shopify CLI not installed (needed for theme dev)"
  echo -e "  ${DIM}Install: npm i -g @shopify/cli${NC}"
fi

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  log_error "Prerequisites check failed. Fix the issues above and re-run."
  exit 1
fi

log_step "2/4  Installing dependencies"

cd "$AGENTS_DIR"
log_info "Running ${PM} install..."
$PM install
log_success "Dependencies installed"

log_step "3/4  Validating environment"

ENV_FILE="$AGENTS_DIR/.env"
ENV_EXAMPLE="$AGENTS_DIR/.env.example"

if [ -f "$ENV_FILE" ]; then
  log_success ".env file exists"

  if [ -f "$ENV_EXAMPLE" ]; then
    MISSING=()
    while IFS= read -r line; do
      [[ -z "$line" || "$line" == \#* ]] && continue
      VAR_NAME=$(echo "$line" | cut -d= -f1 | xargs)
      if ! grep -q "^${VAR_NAME}=" "$ENV_FILE" 2>/dev/null; then
        MISSING+=("$VAR_NAME")
      fi
    done < "$ENV_EXAMPLE"

    if [ ${#MISSING[@]} -gt 0 ]; then
      log_warning "Missing environment variables:"
      for var in "${MISSING[@]}"; do
        echo -e "  ${DIM}- ${var}${NC}"
      done
    else
      log_success "All expected env vars present"
    fi
  fi
elif [ -f "$ENV_EXAMPLE" ]; then
  log_warning ".env not found — creating from .env.example"
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  log_info "Edit ${BOLD}agents/.env${NC} with your actual values"
else
  log_warning "No .env or .env.example found"
fi

log_step "4/4  Verifying build"

log_info "Running type check..."
if $PM run --silent typecheck 2>/dev/null || npx --yes tsc --noEmit 2>/dev/null; then
  log_success "TypeScript compiles cleanly"
else
  log_warning "TypeScript errors detected (non-blocking)"
fi

echo ""
log_success "${BOLD}Setup complete!${NC}"
echo ""
echo -e "  Next: ${GREEN}./agents.sh dev${NC}   — start the dev server"
echo -e "        ${GREEN}./agents.sh doctor${NC} — full health check"
echo ""
