#!/usr/bin/env bash

# NPM Preview Script
# Show what will be published to npm (dry-run)

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PACKAGE_DIR="$REPO_ROOT/packages/marketing-os"

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1" >&2; }

cd "$PACKAGE_DIR"

# Get package info
PACKAGE_NAME=$(node -p "require('./package.json').name")
PACKAGE_VERSION=$(node -p "require('./package.json').version")

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}  ${BLUE}npm Package Preview${NC}                                 ${CYAN}║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

log_info "Package: ${GREEN}$PACKAGE_NAME@$PACKAGE_VERSION${NC}"
echo ""

# Run npm pack dry-run
log_info "Analyzing package contents..."
echo ""

npm pack --dry-run 2>&1 | tee /tmp/npm-pack-preview.txt

# Extract key info
PACKAGE_SIZE=$(grep "package size:" /tmp/npm-pack-preview.txt | awk '{print $4, $5}')
UNPACKED_SIZE=$(grep "unpacked size:" /tmp/npm-pack-preview.txt | awk '{print $4, $5}')
TOTAL_FILES=$(grep "total files:" /tmp/npm-pack-preview.txt | awk '{print $4}')

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BLUE}Package Summary${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  Name:           ${GREEN}$PACKAGE_NAME${NC}"
echo -e "  Version:        ${GREEN}$PACKAGE_VERSION${NC}"
echo -e "  Total Files:    ${GREEN}$TOTAL_FILES${NC}"
echo -e "  Packed Size:    ${GREEN}$PACKAGE_SIZE${NC}"
echo -e "  Unpacked Size:  ${GREEN}$UNPACKED_SIZE${NC}"
echo ""

# Show what's included
log_info "Files included in package:"
echo ""
grep "│" /tmp/npm-pack-preview.txt | grep -v "npm notice" | head -20
FILE_COUNT=$(grep "│" /tmp/npm-pack-preview.txt | grep -v "npm notice" | wc -l | xargs)
if [ "$FILE_COUNT" -gt 20 ]; then
  echo "  ... and $((FILE_COUNT - 20)) more files"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "This is what will be published to npm"
echo ""
log_info "Commands:"
echo "  ./os.sh npm:verify     # Run pre-publish checks"
echo "  ./os.sh npm:publish    # Publish to npm"
echo ""
