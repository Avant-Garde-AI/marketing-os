#!/usr/bin/env bash

# NPM Verify Script
# Pre-publish verification checks

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PACKAGE_DIR="$REPO_ROOT/packages/marketing-os"

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1" >&2; }

ERRORS=0

cd "$PACKAGE_DIR"

log_info "Running pre-publish verification checks..."
echo ""

# Check 1: Git status
log_info "Check 1/8: Git working directory..."
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  log_warning "Uncommitted changes detected"
  ERRORS=$((ERRORS + 1))
else
  log_success "Working directory clean"
fi

# Check 2: npm authentication
log_info "Check 2/8: npm authentication..."
if ! npm whoami > /dev/null 2>&1; then
  log_error "Not authenticated with npm"
  ERRORS=$((ERRORS + 1))
else
  NPM_USER=$(npm whoami)
  log_success "Authenticated as: $NPM_USER"
fi

# Check 3: Package.json validity
log_info "Check 3/8: package.json validity..."
if ! node -e "require('./package.json')" 2>/dev/null; then
  log_error "Invalid package.json"
  ERRORS=$((ERRORS + 1))
else
  log_success "package.json is valid"
fi

# Check 4: Required fields
log_info "Check 4/8: Required package.json fields..."
REQUIRED_FIELDS=("name" "version" "description" "license" "bin")
for field in "${REQUIRED_FIELDS[@]}"; do
  if ! node -p "require('./package.json').$field" > /dev/null 2>&1; then
    log_error "Missing required field: $field"
    ERRORS=$((ERRORS + 1))
  fi
done
log_success "All required fields present"

# Check 5: Build output
log_info "Check 5/8: Build output..."
if [ ! -f "dist/index.js" ]; then
  log_error "Build output not found. Run: pnpm build"
  ERRORS=$((ERRORS + 1))
else
  log_success "Build output exists"
fi

# Check 6: TypeScript compilation
log_info "Check 6/8: TypeScript compilation..."
cd "$REPO_ROOT"
if ! pnpm turbo typecheck --filter=@avant-garde/marketing-os > /dev/null 2>&1; then
  log_error "TypeScript compilation failed"
  ERRORS=$((ERRORS + 1))
else
  log_success "TypeScript compiles cleanly"
fi

# Check 7: Linting
log_info "Check 7/8: Linting..."
if ! pnpm turbo lint --filter=@avant-garde/marketing-os > /dev/null 2>&1; then
  log_warning "Linting issues detected"
  ERRORS=$((ERRORS + 1))
else
  log_success "No linting issues"
fi

# Check 8: Tests
log_info "Check 8/8: Running tests..."
if ! pnpm turbo test --filter=@avant-garde/marketing-os > /dev/null 2>&1; then
  log_error "Tests failed"
  ERRORS=$((ERRORS + 1))
else
  log_success "All tests passing"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $ERRORS -eq 0 ]; then
  log_success "All checks passed! Package is ready to publish."
  echo ""
  log_info "Next steps:"
  echo "  ./os.sh npm:preview    # Preview package contents"
  echo "  ./os.sh npm:publish    # Publish to npm"
  exit 0
else
  log_error "Found $ERRORS issue(s). Fix them before publishing."
  exit 1
fi
