#!/usr/bin/env bash

# agents deploy:build — Production build of the agent app.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

AGENTS_DIR="${AGENTS_APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

log_info()    { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error()   { echo -e "${RED}✗${NC} $1" >&2; }

if [ -f "$AGENTS_DIR/pnpm-lock.yaml" ]; then PM="pnpm"
elif [ -f "$AGENTS_DIR/yarn.lock" ];     then PM="yarn"
else PM="npm"
fi

cd "$AGENTS_DIR"

echo ""
echo -e "${BOLD}Building Marketing OS agent for production...${NC}"
echo ""

log_info "Step 1/3: Linting..."
$PM run lint 2>/dev/null && log_success "Lint passed" || log_warning "Lint issues (continuing)"

log_info "Step 2/3: Type checking..."
npx --yes tsc --noEmit 2>/dev/null && log_success "Types OK" || log_warning "TypeScript errors (continuing)"

log_info "Step 3/3: Building..."
if $PM run build; then
  echo ""
  log_success "${BOLD}Build complete!${NC}"
  [ -d ".next" ] && echo -e "  ${DIM}Output: .next/ ($(du -sh .next 2>/dev/null | cut -f1))${NC}"
  echo ""
  echo -e "  Next: ${GREEN}./agents.sh deploy${NC}   — deploy to Vercel"
  echo ""
else
  echo ""
  log_error "Build failed."
  exit 1
fi
