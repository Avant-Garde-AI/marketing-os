#!/usr/bin/env bash

# agents deploy:vercel — Deploy the agent app to Vercel (production).

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

AGENTS_DIR="${AGENTS_APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

log_info()    { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_error()   { echo -e "${RED}✗${NC} $1" >&2; }

if ! command -v vercel &> /dev/null; then
  log_error "Vercel CLI not installed"
  echo -e "  ${DIM}Install: npm i -g vercel${NC}"
  exit 1
fi

cd "$AGENTS_DIR"

echo ""
echo -e "${BOLD}${CYAN}Deploying Marketing OS to Vercel${NC}"
echo ""

if [ ! -d ".vercel" ]; then
  log_info "No Vercel project linked. Running initial setup..."
  vercel link
  echo ""
fi

log_info "Syncing environment variables..."
vercel env pull .env.vercel 2>/dev/null || true

log_info "Deploying to production..."
echo ""

DEPLOY_URL=$(vercel --prod 2>&1 | tee /dev/tty | grep -oE 'https://[^ ]+' | tail -1)

echo ""
if [ -n "$DEPLOY_URL" ]; then
  log_success "${BOLD}Deployed!${NC}"
  echo -e "  ${GREEN}Production URL:${NC} ${BOLD}${DEPLOY_URL}${NC}"
else
  log_success "Deployment finished. Check Vercel dashboard for URL."
fi
echo ""
