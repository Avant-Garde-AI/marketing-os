#!/usr/bin/env bash

# agents deploy:build — Production build of the Marketing OS agent app.

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

log_info()    { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error()   { echo -e "${RED}✗${NC} $1" >&2; }

if [ ! -d "$AGENTS_DIR" ]; then
  log_error "agents/ directory not found"
  exit 1
fi

if [ -f "$AGENTS_DIR/pnpm-lock.yaml" ]; then PM="pnpm"
elif [ -f "$AGENTS_DIR/yarn.lock" ];     then PM="yarn"
else PM="npm"
fi

cd "$AGENTS_DIR"

echo ""
echo -e "${BOLD}Building Marketing OS agent for production...${NC}"
echo ""

# Step 1: Lint
log_info "Step 1/3: Linting..."
if $PM run lint 2>/dev/null; then
  log_success "Lint passed"
else
  log_warning "Lint issues detected (continuing)"
fi

# Step 2: Type check
log_info "Step 2/3: Type checking..."
if npx --yes tsc --noEmit 2>/dev/null; then
  log_success "Types OK"
else
  log_warning "TypeScript errors detected (continuing)"
fi

# Step 3: Build
log_info "Step 3/3: Building Next.js app..."
if $PM run build; then
  echo ""
  log_success "${BOLD}Build complete!${NC}"

  if [ -d ".next" ]; then
    BUILD_SIZE=$(du -sh .next 2>/dev/null | cut -f1)
    echo -e "  ${DIM}Output: .next/ (${BUILD_SIZE})${NC}"
  fi

  echo ""
  echo -e "  Next: ${GREEN}./agents.sh deploy${NC}   — deploy to Vercel"
  echo -e "        ${GREEN}./agents.sh preview${NC}  — preview deployment"
  echo ""
else
  echo ""
  log_error "Build failed. Fix the errors above and try again."
  exit 1
fi
