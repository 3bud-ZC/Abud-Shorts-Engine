#!/usr/bin/env bash
# ==============================================================================
# ABUD Shorts Engine V2 - Safe Uninstaller (Linux / macOS)
# ==============================================================================
# The default removes the running software and leaves every byte the customer
# produced exactly where it is. Destroying data requires typing an explicit flag
# and confirming a second time.
# ==============================================================================

set -euo pipefail

ABUD_HOME="${ABUD_HOME:-/opt/abud-shorts}"
ABUD_SHARED="$ABUD_HOME/shared"
ABUD_ENV_FILE="$ABUD_SHARED/config/.env"
ABUD_DATA_DIR="$ABUD_SHARED/data"
COMPOSE_FILE="$ABUD_HOME/current/docker-compose.prod.yml"
REMOVE_DATA=false

while [ $# -gt 0 ]; do
  case "$1" in
    --remove-data) REMOVE_DATA=true; shift ;;
    --home) ABUD_HOME="${2:-}"; shift 2 ;;
    --home=*) ABUD_HOME="${1#*=}"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Fall back to the in-place layout used by a developer checkout.
if [ ! -f "$COMPOSE_FILE" ] && [ -f "docker-compose.prod.yml" ]; then
  COMPOSE_FILE="docker-compose.prod.yml"
elif [ ! -f "$COMPOSE_FILE" ] && [ -f "docker-compose.v2.yml" ]; then
  COMPOSE_FILE="docker-compose.v2.yml"
fi

echo "================================================================="
echo "  ABUD Shorts Engine - Uninstaller"
echo "================================================================="

compose() {
  ABUD_DATA_DIR="$ABUD_DATA_DIR" ABUD_RELEASE_DIR="$ABUD_HOME/current" \
  docker compose --project-name abud-shorts \
    ${ABUD_ENV_FILE:+--env-file "$ABUD_ENV_FILE"} \
    --file "$COMPOSE_FILE" "$@"
}

echo "[1/2] Stopping and removing the application containers..."
compose down 2>/dev/null || docker compose --project-name abud-shorts down 2>/dev/null || true
echo "      Containers removed."

if [ "$REMOVE_DATA" != true ]; then
  echo "[2/2] Keeping your data."
  echo ""
  echo "  PRESERVED:"
  echo "    Videos, uploads and media   $ABUD_DATA_DIR"
  echo "    Database                    Docker volume abud-shorts_abud-shorts-postgres-data"
  echo "    Backups                     $ABUD_SHARED/backups"
  echo "    Configuration and secrets   $ABUD_SHARED/config"
  echo ""
  echo "  Reinstalling over this directory picks everything up again."
  echo "  To erase all of it permanently: sudo ./uninstall.sh --remove-data"
  echo "================================================================="
  exit 0
fi

echo ""
echo "  WARNING - DESTRUCTIVE"
echo "  This permanently deletes every video, upload, brand, publication record,"
echo "  backup and setting on this machine. It cannot be undone."
echo ""
if [ -t 0 ]; then
  read -r -p "  Type DELETE to confirm: " reply
  [ "$reply" = "DELETE" ] || { echo "  Cancelled. Nothing was removed."; exit 1; }
else
  echo "  Refusing to delete data without an interactive confirmation." >&2
  exit 1
fi

echo "[2/2] Removing all data..."
compose down -v 2>/dev/null || true
rm -rf "$ABUD_SHARED"
rm -f /usr/local/bin/abud-shorts
echo "      All data removed."
echo "================================================================="
