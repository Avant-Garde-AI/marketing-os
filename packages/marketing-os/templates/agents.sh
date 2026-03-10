#!/usr/bin/env bash

# Marketing OS — Agents CLI
# Manage your Marketing OS agent (Next.js + Mastra) from the project root.
#
# Usage:
#   ./agents.sh <command>              # shortcut
#   ./agents.sh <namespace>:<command>  # full form

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="${ROOT_DIR}/agents/scripts"
AGENTS_DIR="${ROOT_DIR}/agents"

log_info()    { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error()   { echo -e "${RED}✗${NC} $1" >&2; }

resolve_shortcut() {
  case "$1" in
    setup)   echo "dev:setup" ;;
    dev)     echo "dev:start" ;;
    start)   echo "dev:start" ;;
    clean)   echo "dev:clean" ;;
    build)   echo "deploy:build" ;;
    deploy)  echo "deploy:vercel" ;;
    preview) echo "deploy:preview" ;;
    doctor)  echo "ops:doctor" ;;
    env)     echo "ops:env" ;;
    *)       echo "" ;;
  esac
}

show_help() {
  cat << EOF

${BOLD}${CYAN}Marketing OS${NC} ${DIM}— Agents CLI${NC}

${YELLOW}USAGE${NC}
  ./agents.sh <command> [args]

${YELLOW}SHORTCUTS${NC}  ${DIM}(most common operations)${NC}

  ${GREEN}setup${NC}       Install deps, validate .env, check prerequisites
  ${GREEN}dev${NC}         Start agent dev server (Next.js + Mastra)
  ${GREEN}build${NC}       Production build
  ${GREEN}deploy${NC}      Deploy to Vercel
  ${GREEN}doctor${NC}      Check configuration & connectivity
  ${GREEN}clean${NC}       Remove build artifacts & node_modules
  ${GREEN}env${NC}         Validate environment variables

${YELLOW}FULL COMMANDS${NC}  ${DIM}(namespace:command)${NC}

  ${GREEN}dev:setup${NC}       Install deps, validate .env, check prerequisites
  ${GREEN}dev:start${NC}       Start agent + Shopify theme dev servers
  ${GREEN}dev:clean${NC}       Remove build artifacts & node_modules

  ${GREEN}deploy:build${NC}    Production build of the agent app
  ${GREEN}deploy:vercel${NC}   Deploy to Vercel (production)
  ${GREEN}deploy:preview${NC}  Deploy a Vercel preview branch

  ${GREEN}ops:doctor${NC}      Check configuration & connectivity
  ${GREEN}ops:env${NC}         Validate environment variables

${YELLOW}FLAGS${NC}
  -h, --help      Show this help message

${YELLOW}EXAMPLES${NC}
  ./agents.sh setup                   # first-time setup
  ./agents.sh dev                     # start developing
  ./agents.sh dev --shopify           # start agent + Shopify theme dev
  ./agents.sh deploy                  # ship to Vercel
  ./agents.sh doctor                  # diagnose issues

EOF
}

if [ $# -eq 0 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  show_help
  exit 0
fi

RAW="$1"
shift

EXPANDED=$(resolve_shortcut "$RAW")
if [ -n "$EXPANDED" ]; then
  RAW="$EXPANDED"
fi

if [[ "$RAW" =~ ^([a-z]+):([a-z-]+)$ ]]; then
  NAMESPACE="${BASH_REMATCH[1]}"
  CMD="${BASH_REMATCH[2]}"
else
  log_error "Unknown command: ${RAW}"
  echo ""
  echo "Run ./agents.sh --help for usage."
  exit 1
fi

SCRIPT_PATH="${SCRIPTS_DIR}/${NAMESPACE}/${CMD}.sh"

if [ ! -f "$SCRIPT_PATH" ]; then
  log_error "Command not found: ${NAMESPACE}:${CMD}"
  echo ""
  echo "Available commands:"
  if [ -d "$SCRIPTS_DIR" ]; then
    find "$SCRIPTS_DIR" -name "*.sh" -type f | sort | while read -r script; do
      rel="${script#$SCRIPTS_DIR/}"
      ns=$(dirname "$rel")
      c=$(basename "$rel" .sh)
      echo "  ${ns}:${c}"
    done
  fi
  exit 1
fi

if [ ! -x "$SCRIPT_PATH" ]; then
  chmod +x "$SCRIPT_PATH"
fi

export AGENTS_ROOT_DIR="$ROOT_DIR"
export AGENTS_APP_DIR="$AGENTS_DIR"

exec "$SCRIPT_PATH" "$@"
