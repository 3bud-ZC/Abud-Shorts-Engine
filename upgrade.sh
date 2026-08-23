#!/usr/bin/env bash
# ==============================================================================
# ABUD Shorts Engine V2 — Production Upgrade Script (Linux / macOS)
# Version: 2.0.0
# ==============================================================================

set -euo pipefail

echo "================================================================="
echo "  ABUD Shorts Engine V2 — Safe Production Upgrade (v2.0.0)"
echo "================================================================="

# 1. Automatic Pre-Upgrade Safety Backup
echo "[1/4] Triggering pre-upgrade safety backup..."
curl -s -X POST "http://localhost:3130/api/v2/backups" \
  -H "Content-Type: application/json" \
  -d '{"type":"config_db","notes":"Pre-upgrade auto safety backup"}' || echo "Notice: API backup skipped (service may be restarting)"

# 2. Pull / Rebuild Stack
echo "[2/4] Updating Docker images..."
docker compose -f docker-compose.v2.yml pull || true
docker compose -f docker-compose.v2.yml build

# 3. Restart Stack with Migrations
echo "[3/4] Restarting services with latest migrations..."
docker compose -f docker-compose.v2.yml up -d

# 4. Health Verification
echo "[4/4] Verifying upgraded system health..."
sleep 5
if curl -sf "http://localhost:3130/health/ready" &>/dev/null; then
    echo " -> Upgrade completed successfully! System is healthy."
else
    echo "Warning: System reported degraded health after upgrade."
fi
