#!/usr/bin/env bash

# agents dev:clean — Remove build artifacts and node_modules from agents/.

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

ROOT_DIR="${AGENTS_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
AGENTS_DIR="${AGENTS_APP_DIR:-$ROOT_DIR/agents}"

log_info()    { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }

echo ""

if [ -d "$AGENTS_DIR/.next" ]; then
  rm -rf "$AGENTS_DIR/.next"
  log_success "Removed .next/"
fi

if [ -d "$AGENTS_DIR/node_modules" ]; then
  log_info "Removing node_modules/ (this may take a moment)..."
  rm -rf "$AGENTS_DIR/node_modules"
  log_success "Removed node_modules/"
fi

if [ -d "$AGENTS_DIR/.turbo" ]; then
  rm -rf "$AGENTS_DIR/.turbo"
  log_success "Removed .turbo/"
fi

if [ -f "$AGENTS_DIR/tsconfig.tsbuildinfo" ]; then
  rm -f "$AGENTS_DIR/tsconfig.tsbuildinfo"
  log_success "Removed tsconfig.tsbuildinfo"
fi

echo ""
log_success "${BOLD}Clean complete.${NC} Run ${GREEN}./agents.sh setup${NC} to reinstall."
echo ""
