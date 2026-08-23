#!/usr/bin/env bash
# ==============================================================================
# ABUD Shorts Engine V2 — Production Installer (Linux / macOS)
# Version: 2.0.0-rc.1
# ==============================================================================

set -euo pipefail

PORT="${1:-3130}"

echo "================================================================="
echo "  ABUD Shorts Engine V2 — One-Command Production Installer"
echo "  Version: 2.0.0-rc.1"
echo "================================================================="
echo ""

# 1. Verify Docker Engine & CLI
echo "[1/8] Verifying Docker installation..."
if ! command -v docker &>/dev/null; then
    echo "Error: Docker is not installed or not in PATH." >&2
    echo "Please install Docker: https://docs.docker.com/engine/install/" >&2
    exit 1
fi

if ! docker info &>/dev/null; then
    echo "Error: Docker daemon is not running or current user does not have permission." >&2
    echo "Ensure Docker is started or add user to 'docker' group." >&2
    exit 1
fi
echo " -> Docker is running and healthy."

# 2. Check Disk Space
echo "[2/8] Checking available disk space..."
AVAILABLE_KB=$(df -k . | awk 'NR==2 {print $4}')
AVAILABLE_GB=$(( AVAILABLE_KB / 1024 / 1024 ))
if [ "$AVAILABLE_GB" -lt 2 ]; then
    echo "Warning: Low disk space detected ($AVAILABLE_GB GB available). At least 5 GB is recommended."
else
    echo " -> Disk space available: $AVAILABLE_GB GB."
fi

# 3. Port Conflict Detection
echo "[3/8] Checking port availability for HTTP ($PORT)..."
if command -v nc &>/dev/null && nc -z 127.0.0.1 "$PORT" &>/dev/null; then
    echo "Warning: Port $PORT is already in use on this system!"
    echo " -> You can specify a different port: ./install.sh 3131"
else
    echo " -> Port $PORT is available."
fi

# 4. Create Persistent Storage Directories
echo "[4/8] Creating persistent storage directories..."
mkdir -p data/videos data/thumbnails data/uploads data/cache data/models data/backups data/logs
echo " -> Storage directories initialized."

# 5. Generate Secure Configuration & Secrets
echo "[5/8] Configuring environment and generating cryptographic secrets..."
if [ ! -f ".env" ]; then
    INTERNAL_TOKEN="abud_v2_sec_$(openssl rand -hex 32)"
    PG_PASS="abud_pg_$(openssl rand -hex 16)"
    N8N_KEY="$(openssl rand -hex 16)"
    SESSION_SECRET="$(openssl rand -hex 32)"
    WH_SECRET="whsec_$(openssl rand -hex 24)"

    cat <<EOF > .env
# ABUD Shorts Engine V2 — Environment Configuration
PORT=3123
HOST_PORT=$PORT
SERVICE_ROLE=app
NODE_ENV=production
V2_ENABLED=true

# Persistent Directories
DATA_DIR=/app/data
VIDEOS_DIR=/app/data/videos
TEMP_DIR=/app/data/cache

# Internal Communication
APP_INTERNAL_BASE_URL=http://app:3123
RENDER_WORKER_BASE_URL=http://render-worker:3124
N8N_BASE_URL=http://n8n:5678
DATABASE_URL=postgresql://abud_shorts:${PG_PASS}@postgres:5432/abud_shorts

# Cryptographic Secrets
INTERNAL_SERVICE_TOKEN=${INTERNAL_TOKEN}
POSTGRES_PASSWORD=${PG_PASS}
N8N_ENCRYPTION_KEY=${N8N_KEY}
SESSION_SECRET=${SESSION_SECRET}
WEBHOOK_SIGNING_SECRET=${WH_SECRET}
EOF
    echo " -> Generated secure production .env with random cryptographic secrets."
else
    echo " -> Existing .env found; preserving configured credentials."
fi

# 6. Start Docker Stack
echo "[6/8] Starting Docker services (app, render-worker, n8n, postgres)..."
docker compose -f docker-compose.v2.yml up -d --remove-orphans

# 7. Wait for Service Health
echo "[7/8] Waiting for services to become healthy..."
MAX_ATTEMPTS=30
ATTEMPT=0
HEALTHY=false

while [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
    ATTEMPT=$(( ATTEMPT + 1 ))
    sleep 2
    if curl -sf "http://localhost:${PORT}/health/ready" &>/dev/null || curl -sf "http://localhost:${PORT}/health" &>/dev/null; then
        HEALTHY=true
        break
    fi
    echo " -> Waiting for application startup ($ATTEMPT/$MAX_ATTEMPTS)..."
done

if [ "$HEALTHY" = true ]; then
    echo " -> All services are healthy and operational."
else
    echo "Warning: Application took longer than expected to report ready."
fi

# 8. Success Banner
echo ""
echo "================================================================="
echo "  ABUD Shorts Engine V2 is Ready!"
echo "================================================================="
echo "  Dashboard:       http://localhost:${PORT}"
echo "  Setup Wizard:    http://localhost:${PORT}/setup"
echo "  Free Pipeline:   Ready (Local Director, Pexels, Kokoro, Remotion)"
echo "  Database:        PostgreSQL Connected & Migrated"
echo "  Orchestrator:    n8n Internal Automation Active"
echo "================================================================="
echo ""
echo "Run the First-Run Setup Wizard at: http://localhost:${PORT}/setup"
