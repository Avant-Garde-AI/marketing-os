#!/usr/bin/env bash

# agents dev:clean — Remove build artifacts and node_modules.

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

AGENTS_DIR="${AGENTS_APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

log_info()    { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }

echo ""

for dir in ".next" "node_modules" ".turbo"; do
  if [ -d "$AGENTS_DIR/$dir" ]; then
    [ "$dir" = "node_modules" ] && log_info "Removing $dir/ (this may take a moment)..."
    rm -rf "$AGENTS_DIR/$dir"
    log_success "Removed $dir/"
  fi
done

[ -f "$AGENTS_DIR/tsconfig.tsbuildinfo" ] && rm -f "$AGENTS_DIR/tsconfig.tsbuildinfo" && log_success "Removed tsconfig.tsbuildinfo"

echo ""
log_success "${BOLD}Clean complete.${NC} Run ${GREEN}./agents.sh setup${NC} to reinstall."
echo ""
