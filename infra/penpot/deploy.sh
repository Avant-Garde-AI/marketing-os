#!/usr/bin/env bash
# Deploy the production Penpot stack to the GCE box (spec 23 §3).
#
#   ./deploy.sh              # sync compose + Caddyfile, docker compose up -d
#   ./deploy.sh lock         # flip PENPOT_FLAGS to the locked (no-registration)
#                            # set and restart — run once after bootstrap
#   ./deploy.sh logs [svc]   # tail logs
#
# Secrets: /opt/penpot/.env on the VM only (created by first deploy if absent;
# PENPOT_SECRET_KEY generated on the VM, never leaves it).

set -euo pipefail

PROJECT=avant-garde-platform
ZONE=us-central1-a
VM=penpot-design
DIR=/opt/penpot

FLAGS_BOOTSTRAP="enable-prepl-server enable-access-tokens enable-backend-api-doc enable-registration enable-login-with-password disable-email-verification enable-secure-session-cookies enable-mcp enable-webhooks disable-onboarding disable-telemetry"
FLAGS_LOCKED="enable-prepl-server enable-access-tokens enable-backend-api-doc disable-registration enable-login-with-password disable-email-verification enable-secure-session-cookies enable-mcp enable-webhooks disable-onboarding disable-telemetry"

gssh() { gcloud compute ssh "$VM" --project="$PROJECT" --zone="$ZONE" --command="$1"; }

case "${1:-deploy}" in
  deploy)
    gssh "sudo mkdir -p $DIR && sudo chown \$(whoami) $DIR"
    gcloud compute scp docker-compose.prod.yaml "$VM:$DIR/docker-compose.yaml" --project="$PROJECT" --zone="$ZONE"
    gcloud compute scp Caddyfile "$VM:$DIR/Caddyfile" --project="$PROJECT" --zone="$ZONE"
    gssh "cd $DIR && if [ ! -f .env ]; then umask 077; { echo \"PENPOT_SECRET_KEY=\$(openssl rand -base64 48 | tr -d '\n')\"; echo 'PENPOT_FLAGS=$FLAGS_BOOTSTRAP'; echo 'PENPOT_PUBLIC_URI=https://design.avant-garde.ai'; } > .env; echo 'created .env (bootstrap flags)'; fi"
    gssh "cd $DIR && sudo docker compose --env-file .env up -d --remove-orphans && sudo docker compose ps --format 'table {{.Name}}\t{{.Status}}'"
    ;;
  lock)
    gssh "cd $DIR && sed -i 's|^PENPOT_FLAGS=.*|PENPOT_FLAGS=$FLAGS_LOCKED|' .env && sudo docker compose --env-file .env up -d penpot-frontend penpot-backend && echo locked"
    ;;
  logs)
    gssh "cd $DIR && sudo docker compose logs --tail=100 ${2:-}"
    ;;
  *)
    echo "usage: deploy.sh [deploy|lock|logs [service]]" >&2; exit 1;;
esac
