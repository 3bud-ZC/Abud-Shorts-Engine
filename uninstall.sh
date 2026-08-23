#!/usr/bin/env bash
# ==============================================================================
# ABUD Shorts Engine V2 — Safe Uninstaller (Linux / macOS)
# Version: 2.0.0
# ==============================================================================

set -euo pipefail

REMOVE_DATA=false
if [ "${1:-}" = "--remove-data" ]; then
    REMOVE_DATA=true
fi

echo "================================================================="
echo "  ABUD Shorts Engine V2 — Safe Uninstaller"
echo "================================================================="

# 1. Stop and remove containers
echo "[1/2] Stopping and removing Docker containers..."
docker compose -f docker-compose.v2.yml down

# 2. Handle Persistent Data
if [ "$REMOVE_DATA" = true ]; then
    echo "Warning: DESTRUCTIVE MODE: Removing all persistent volumes and data..."
    docker compose -f docker-compose.v2.yml down -v
    rm -rf data/
    echo " -> Persistent data removed."
else
    echo " -> Persistent database volumes and data/ directory PRESERVED."
    echo "    (To completely remove all data, rerun with: ./uninstall.sh --remove-data)"
fi

echo "================================================================="
echo "  Uninstallation complete."
echo "================================================================="
