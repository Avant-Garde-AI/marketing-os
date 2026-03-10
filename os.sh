#!/usr/bin/env bash

# Marketing OS - Repository CLI
# Usage: ./os.sh <namespace>:<command> [args]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="${SCRIPT_DIR}/scripts"

# Helper functions
log_info() {
  echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
  echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
  echo -e "${RED}✗${NC} $1" >&2
}

# Show help
show_help() {
  cat << EOF
${BLUE}Marketing OS${NC} - Repository CLI

${YELLOW}USAGE${NC}
  ./os.sh <namespace>:<command> [args]

${YELLOW}AVAILABLE COMMANDS${NC}

  ${GREEN}npm:publish${NC}         Publish the CLI package to npm
  ${GREEN}npm:version${NC}         Bump package version (major|minor|patch)
  ${GREEN}npm:verify${NC}          Verify package is ready for publish
  ${GREEN}npm:preview${NC}         Preview what will be published (dry-run)

  ${DIM}For agent commands (dev, deploy, etc.), use${NC} ${GREEN}./agents.sh${NC}

${YELLOW}EXAMPLES${NC}
  ./os.sh npm:publish              # Publish to npm
  ./os.sh npm:version patch        # Bump patch version
  ./os.sh npm:verify               # Check if package is ready

${YELLOW}FLAGS${NC}
  -h, --help                       Show this help message
  -v, --verbose                    Show detailed output

${YELLOW}ADDING NEW COMMANDS${NC}
  Create a new script in ${BLUE}scripts/<namespace>/<command>.sh${NC}
  Make it executable: ${BLUE}chmod +x scripts/<namespace>/<command>.sh${NC}

EOF
}

# Parse command
if [ $# -eq 0 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  show_help
  exit 0
fi

COMMAND="$1"
shift

# Split namespace:command
if [[ "$COMMAND" =~ ^([a-z]+):([a-z-]+)$ ]]; then
  NAMESPACE="${BASH_REMATCH[1]}"
  CMD="${BASH_REMATCH[2]}"
else
  log_error "Invalid command format. Expected <namespace>:<command>"
  echo ""
  echo "Example: ./os.sh npm:publish"
  exit 1
fi

# Find and execute script
SCRIPT_PATH="${SCRIPTS_DIR}/${NAMESPACE}/${CMD}.sh"

if [ ! -f "$SCRIPT_PATH" ]; then
  log_error "Command not found: ${NAMESPACE}:${CMD}"
  echo ""
  echo "Available commands:"
  find "$SCRIPTS_DIR" -name "*.sh" -type f | while read -r script; do
    rel_path="${script#$SCRIPTS_DIR/}"
    namespace=$(dirname "$rel_path")
    cmd=$(basename "$rel_path" .sh)
    echo "  - ${namespace}:${cmd}"
  done
  exit 1
fi

if [ ! -x "$SCRIPT_PATH" ]; then
  log_error "Script is not executable: $SCRIPT_PATH"
  echo "Run: chmod +x $SCRIPT_PATH"
  exit 1
fi

# Execute the command
log_info "Running ${NAMESPACE}:${CMD}..."
echo ""
exec "$SCRIPT_PATH" "$@"
