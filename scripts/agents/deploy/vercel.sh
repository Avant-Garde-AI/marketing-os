#!/usr/bin/env bash

# agents deploy:vercel — Deploy the Marketing OS agent app to Vercel (production).

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
AGENTS_DIR="${AGENTS_APP_DIR:-$ROOT_DIR/agents}"

log_info()    { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error()   { echo -e "${RED}✗${NC} $1" >&2; }

if [ ! -d "$AGENTS_DIR" ]; then
  log_error "agents/ directory not found"
  exit 1
fi

if ! command -v vercel &> /dev/null; then
  log_error "Vercel CLI not installed"
  echo -e "  ${DIM}Install: npm i -g vercel${NC}"
  exit 1
fi

cd "$AGENTS_DIR"

echo ""
echo -e "${BOLD}${CYAN}Deploying Marketing OS to Vercel${NC}"
echo ""

# Check for env vars
ENV_FILE="$AGENTS_DIR/.env"
REQUIRED_VARS=("ANTHROPIC_API_KEY")

if [ -f "$ENV_FILE" ]; then
  for var in "${REQUIRED_VARS[@]}"; do
    if ! grep -q "^${var}=.\+" "$ENV_FILE" 2>/dev/null; then
      log_warning "Missing or empty: ${var}"
    fi
  done
fi

# Check if Vercel project is linked
if [ ! -d ".vercel" ]; then
  log_info "No Vercel project linked. Running initial setup..."
  vercel link
  echo ""
fi

# Pull env from Vercel (merge with local)
log_info "Syncing environment variables..."
vercel env pull .env.vercel 2>/dev/null || true

# Deploy
log_info "Deploying to production..."
echo ""

DEPLOY_URL=$(vercel --prod 2>&1 | tee /dev/tty | grep -oE 'https://[^ ]+' | tail -1)

echo ""
if [ -n "$DEPLOY_URL" ]; then
  log_success "${BOLD}Deployed!${NC}"
  echo ""
  echo -e "  ${GREEN}Production URL:${NC} ${BOLD}${DEPLOY_URL}${NC}"
  echo ""
else
  log_success "Deployment command finished. Check Vercel dashboard for URL."
fi
