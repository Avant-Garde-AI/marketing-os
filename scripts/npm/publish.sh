#!/usr/bin/env bash

# NPM Publish Script
# Handles the complete npm publish lifecycle with safety checks

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

# Check if we're in the right directory
if [ ! -d "$PACKAGE_DIR" ]; then
  log_error "Package directory not found: $PACKAGE_DIR"
  exit 1
fi

cd "$PACKAGE_DIR"

log_info "Starting npm publish workflow..."
echo ""

# Step 1: Check git status
log_info "Step 1/6: Checking git status..."
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  log_warning "You have uncommitted changes. Consider committing them first."
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_error "Aborted by user"
    exit 1
  fi
else
  log_success "Working directory is clean"
fi
echo ""

# Step 2: Run tests and build
log_info "Step 2/6: Running tests and build..."
cd "$REPO_ROOT"
if ! pnpm turbo lint typecheck test build; then
  log_error "Tests or build failed. Fix errors before publishing."
  exit 1
fi
log_success "All checks passed"
echo ""

# Step 3: Verify package
log_info "Step 3/6: Verifying package contents..."
cd "$PACKAGE_DIR"
npm pack --dry-run > /tmp/npm-pack-output.txt 2>&1
if grep -q "error" /tmp/npm-pack-output.txt; then
  log_error "Package verification failed"
  cat /tmp/npm-pack-output.txt
  exit 1
fi
PACKAGE_SIZE=$(grep "package size:" /tmp/npm-pack-output.txt | awk '{print $3, $4}')
FILE_COUNT=$(grep "total files:" /tmp/npm-pack-output.txt | awk '{print $3}')
log_success "Package verified: $FILE_COUNT files, $PACKAGE_SIZE"
echo ""

# Step 4: Check npm authentication
log_info "Step 4/6: Checking npm authentication..."
if ! npm whoami > /dev/null 2>&1; then
  log_error "Not logged into npm. Run: npm login"
  exit 1
fi
NPM_USER=$(npm whoami)
log_success "Authenticated as: $NPM_USER"
echo ""

# Step 5: Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
log_info "Step 5/6: Publishing version $CURRENT_VERSION..."
echo ""
log_warning "You are about to publish:"
echo "  Package: @avant-garde/marketing-os"
echo "  Version: $CURRENT_VERSION"
echo "  Registry: https://registry.npmjs.org/"
echo ""
read -p "Continue with publish? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  log_error "Aborted by user"
  exit 1
fi
echo ""

# Step 6: Publish
log_info "Step 6/6: Publishing to npm..."
if npm publish; then
  log_success "Successfully published @avant-garde/marketing-os@$CURRENT_VERSION"
  echo ""
  log_info "View on npm: https://www.npmjs.com/package/@avant-garde/marketing-os"
  echo ""

  # Tag git commit
  log_info "Creating git tag..."
  if git tag "v$CURRENT_VERSION" 2>/dev/null; then
    git push origin "v$CURRENT_VERSION"
    log_success "Tagged and pushed v$CURRENT_VERSION to git"
  else
    log_warning "Git tag v$CURRENT_VERSION already exists"
  fi
else
  log_error "Publish failed"
  exit 1
fi
