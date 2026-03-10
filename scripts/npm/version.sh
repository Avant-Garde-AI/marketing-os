#!/usr/bin/env bash

# NPM Version Script
# Bump package version (major, minor, or patch)

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

# Parse arguments
BUMP_TYPE="${1:-patch}"

if [[ ! "$BUMP_TYPE" =~ ^(major|minor|patch)$ ]]; then
  log_error "Invalid bump type: $BUMP_TYPE"
  echo ""
  echo "Usage: ./os.sh npm:version <major|minor|patch>"
  echo ""
  echo "Examples:"
  echo "  ./os.sh npm:version patch    # 0.1.0 → 0.1.1"
  echo "  ./os.sh npm:version minor    # 0.1.0 → 0.2.0"
  echo "  ./os.sh npm:version major    # 0.1.0 → 1.0.0"
  exit 1
fi

cd "$PACKAGE_DIR"

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
log_info "Current version: $CURRENT_VERSION"

# Calculate new version
IFS='.' read -ra VERSION_PARTS <<< "$CURRENT_VERSION"
MAJOR=${VERSION_PARTS[0]}
MINOR=${VERSION_PARTS[1]}
PATCH=${VERSION_PARTS[2]}

case "$BUMP_TYPE" in
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  patch)
    PATCH=$((PATCH + 1))
    ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"

log_info "New version: $NEW_VERSION ($BUMP_TYPE bump)"
echo ""

# Confirm
read -p "Bump version from $CURRENT_VERSION → $NEW_VERSION? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  log_error "Aborted by user"
  exit 1
fi

# Update package.json
log_info "Updating package.json..."
npm version "$NEW_VERSION" --no-git-tag-version
log_success "Updated to v$NEW_VERSION"
echo ""

# Update root package.json if it references the version
ROOT_PACKAGE="$REPO_ROOT/package.json"
if [ -f "$ROOT_PACKAGE" ]; then
  log_info "Checking root package.json..."
  if grep -q "\"version\":" "$ROOT_PACKAGE"; then
    log_info "Updating root package.json..."
    cd "$REPO_ROOT"
    npm version "$NEW_VERSION" --no-git-tag-version
    log_success "Root package.json updated"
  fi
fi

echo ""
log_success "Version bump complete!"
echo ""
log_info "Next steps:"
echo "  1. Review changes: git diff"
echo "  2. Commit changes: git add . && git commit -m 'chore: bump version to $NEW_VERSION'"
echo "  3. Publish: ./os.sh npm:publish"
