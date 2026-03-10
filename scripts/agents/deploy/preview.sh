#!/usr/bin/env bash

# agents deploy:preview — Create a Vercel preview deployment.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

ROOT_DIR="${AGENTS_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
AGENTS_DIR="${AGENTS_APP_DIR:-$ROOT_DIR/agents}"

log_info()    { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
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
echo -e "${BOLD}${CYAN}Creating Vercel preview deployment...${NC}"
echo ""

if [ ! -d ".vercel" ]; then
  log_info "No Vercel project linked. Running initial setup..."
  vercel link
  echo ""
fi

PREVIEW_URL=$(vercel 2>&1 | tee /dev/tty | grep -oE 'https://[^ ]+' | tail -1)

echo ""
if [ -n "$PREVIEW_URL" ]; then
  log_success "${BOLD}Preview deployed!${NC}"
  echo ""
  echo -e "  ${GREEN}Preview URL:${NC} ${BOLD}${PREVIEW_URL}${NC}"
  echo ""
else
  log_success "Preview deployment finished. Check Vercel dashboard for URL."
fi
