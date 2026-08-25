#!/usr/bin/env bash
# ==============================================================================
# ABUD Shorts Engine V2 - Client Installer (Linux / macOS)
# ==============================================================================
# One command, then a browser. Nothing here compiles source, edits YAML by hand
# or asks the customer to know Docker.
#
#   sudo ./install.sh
#   sudo ./install.sh --url https://shorts.example.com
#   sudo ./install.sh --port 3131
#
# What it produces:
#
#   /opt/abud-shorts/
#     current -> releases/<version>    the code
#     releases/<version>/              this release, and every earlier one
#     shared/                          EVERYTHING THE CUSTOMER OWNS
#       data/ config/ backups/ logs/ state/ installation.json
#
# Upgrading replaces a release directory. It never writes inside shared/, which
# is why videos, uploads, brands, settings and backups survive every update.
# ==============================================================================

set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ABUD_HOME="${ABUD_HOME:-/opt/abud-shorts}"
HOST_PORT=3130
PUBLIC_URL=""
IMAGE_OVERRIDE=""
TRUSTED_PROXY_VALUE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --port) HOST_PORT="${2:-3130}"; shift 2 ;;
    --port=*) HOST_PORT="${1#*=}"; shift ;;
    --url) PUBLIC_URL="${2:-}"; shift 2 ;;
    --url=*) PUBLIC_URL="${1#*=}"; shift ;;
    --home) ABUD_HOME="${2:-}"; shift 2 ;;
    --home=*) ABUD_HOME="${1#*=}"; shift ;;
    --image) IMAGE_OVERRIDE="${2:-}"; shift 2 ;;
    --image=*) IMAGE_OVERRIDE="${1#*=}"; shift ;;
    --behind-proxy) TRUSTED_PROXY_VALUE="1"; shift ;;
    -h|--help)
      sed -n '2,25p' "${BASH_SOURCE[0]}"
      exit 0 ;;
    # A bare port keeps the old `./install.sh 3131` form working.
    [0-9]*) HOST_PORT="$1"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

export ABUD_HOME
ABUD_SHARED="$ABUD_HOME/shared"
ABUD_RELEASES="$ABUD_HOME/releases"
ABUD_CURRENT="$ABUD_HOME/current"
ABUD_DATA_DIR="$ABUD_SHARED/data"
ABUD_CONFIG_DIR="$ABUD_SHARED/config"
ABUD_ENV_FILE="$ABUD_CONFIG_DIR/.env"

echo "================================================================="
echo "  ABUD Shorts Engine - Installer"
echo "================================================================="
echo ""

# ---------------------------------------------------------------------------
# 1. Docker
# ---------------------------------------------------------------------------
echo "[1/9] Checking Docker..."
command -v docker >/dev/null 2>&1 || {
  echo "Error: Docker is not installed." >&2
  echo "Install it first: https://docs.docker.com/engine/install/" >&2
  exit 1
}
docker info >/dev/null 2>&1 || {
  echo "Error: the Docker service is not running, or this user cannot reach it." >&2
  echo "Start Docker, or run this installer with sudo." >&2
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "Error: the Docker Compose plugin is missing." >&2
  echo "Install it: https://docs.docker.com/compose/install/" >&2
  exit 1
}
echo "      Docker is running."

# jq is what the updater uses to read a release manifest. Installing it now
# means the customer never meets a missing dependency mid-update.
if ! command -v jq >/dev/null 2>&1; then
  echo "      Installing the 'jq' helper the updater needs..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq jq >/dev/null 2>&1 || true
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q jq >/dev/null 2>&1 || true
  elif command -v yum >/dev/null 2>&1; then
    yum install -y -q jq >/dev/null 2>&1 || true
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache jq >/dev/null 2>&1 || true
  elif command -v brew >/dev/null 2>&1; then
    brew install jq >/dev/null 2>&1 || true
  fi
fi
command -v jq >/dev/null 2>&1 || {
  echo "Error: 'jq' could not be installed automatically." >&2
  echo "Install it manually, then run this installer again: sudo apt-get install -y jq" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# 2. Disk
# ---------------------------------------------------------------------------
echo "[2/9] Checking disk space..."
mkdir -p "$ABUD_HOME"
AVAILABLE_GB=$(( $(df -Pk "$ABUD_HOME" | awk 'NR==2 {print $4}') / 1024 / 1024 ))
if [ "$AVAILABLE_GB" -lt 15 ]; then
  echo "Error: ${AVAILABLE_GB} GB free. ABUD Shorts needs at least 15 GB to install." >&2
  exit 1
fi
echo "      ${AVAILABLE_GB} GB available."

# ---------------------------------------------------------------------------
# 3. Address
# ---------------------------------------------------------------------------
echo "[3/9] Checking the address this installation will serve..."
if command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 "$HOST_PORT" >/dev/null 2>&1; then
  echo "Error: port $HOST_PORT is already in use on this machine." >&2
  echo "Choose another one: sudo ./install.sh --port 3131" >&2
  exit 1
fi
if [ -z "$PUBLIC_URL" ]; then
  PUBLIC_URL="http://localhost:$HOST_PORT"
  echo "      Local installation: $PUBLIC_URL"
  echo "      For a server with a domain, rerun with: --url https://shorts.example.com"
else
  case "$PUBLIC_URL" in
    http://*|https://*) ;;
    *) echo "Error: --url must start with http:// or https://" >&2; exit 1 ;;
  esac
  PUBLIC_URL="${PUBLIC_URL%/}"
  echo "      Public address: $PUBLIC_URL"
  # A public address almost always means a reverse proxy in front, and the
  # application must be told before it will believe any forwarded header.
  [ -n "$TRUSTED_PROXY_VALUE" ] || TRUSTED_PROXY_VALUE="1"
fi

# ---------------------------------------------------------------------------
# 4. Release identity
# ---------------------------------------------------------------------------
echo "[4/9] Reading this release..."
[ -f "$PACKAGE_DIR/release.json" ] || {
  echo "Error: release.json is missing. This does not look like an ABUD Shorts client package." >&2
  exit 1
}
RELEASE_VERSION="$(jq -r '.version // empty' "$PACKAGE_DIR/release.json")"
RELEASE_IMAGE="$(jq -r '.image // empty' "$PACKAGE_DIR/release.json")"
RELEASE_DIGEST="$(jq -r '.imageDigest // empty' "$PACKAGE_DIR/release.json")"
RELEASE_CHANNEL="$(jq -r '.channel // "stable"' "$PACKAGE_DIR/release.json")"
[ -n "$RELEASE_VERSION" ] || { echo "Error: this package does not declare a version." >&2; exit 1; }
[ -n "$IMAGE_OVERRIDE" ] && RELEASE_IMAGE="$IMAGE_OVERRIDE"
echo "      Version $RELEASE_VERSION ($RELEASE_CHANNEL)"

# ---------------------------------------------------------------------------
# 5. The application image: offline archive first, otherwise pull
# ---------------------------------------------------------------------------
echo "[5/9] Preparing the application..."
OFFLINE_ARCHIVE="$(find "$PACKAGE_DIR/images" -maxdepth 1 -name '*.tar*' 2>/dev/null | head -1 || true)"
if [ -n "$OFFLINE_ARCHIVE" ]; then
  echo "      Offline package: loading the bundled image (this takes a few minutes)..."
  docker load -i "$OFFLINE_ARCHIVE" >/dev/null || {
    echo "Error: the bundled application image could not be loaded." >&2
    exit 1
  }
  echo "      Image loaded from the package."
else
  # Pull by digest when the package publishes one: a tag can be moved, a digest
  # cannot, so this is what makes the installed version reproducible.
  PULL_REF="$RELEASE_IMAGE"
  if [ -n "$RELEASE_DIGEST" ] && [ "$RELEASE_DIGEST" != "null" ]; then
    PULL_REF="${RELEASE_IMAGE%%:*}@${RELEASE_DIGEST}"
  fi
  echo "      Downloading the application (this takes a few minutes)..."
  docker pull "$PULL_REF" >/dev/null || {
    echo "Error: the application image could not be downloaded." >&2
    echo "Check this machine's internet connection and try again." >&2
    exit 1
  }
  RELEASE_IMAGE="$PULL_REF"
  echo "      Application downloaded."
fi

# ---------------------------------------------------------------------------
# 6. Persistent layout
# ---------------------------------------------------------------------------
echo "[6/9] Creating the installation..."
mkdir -p \
  "$ABUD_DATA_DIR"/{videos,thumbnails,uploads,cache,models,backups,logs,updates} \
  "$ABUD_CONFIG_DIR" \
  "$ABUD_SHARED"/{backups,logs,state} \
  "$ABUD_RELEASES"

RELEASE_DIR="$ABUD_RELEASES/$RELEASE_VERSION"
rm -rf "$RELEASE_DIR.incoming"
mkdir -p "$RELEASE_DIR.incoming"
# The image archive is not copied into the release directory: it is many
# gigabytes and Docker already holds it.
tar -c --exclude='./images' -C "$PACKAGE_DIR" . | tar -x -C "$RELEASE_DIR.incoming"
rm -rf "$RELEASE_DIR"
mv "$RELEASE_DIR.incoming" "$RELEASE_DIR"
chmod +x "$RELEASE_DIR"/scripts/host/*.sh 2>/dev/null || true
ln -sfn "$RELEASE_DIR" "$ABUD_CURRENT"
echo "      Installed to $RELEASE_DIR"

# ---------------------------------------------------------------------------
# 7. Configuration and secrets
# ---------------------------------------------------------------------------
echo "[7/9] Configuring..."
if [ ! -f "$ABUD_ENV_FILE" ]; then
  secret() { openssl rand -hex "$1"; }
  PG_PASS="abud_pg_$(secret 16)"
  cat > "$ABUD_ENV_FILE" <<ENVEOF
# ABUD Shorts Engine - installation configuration
# Generated by the installer. Every secret below is unique to this machine;
# there is no shared or default password anywhere in the product.

HOST_PORT=$HOST_PORT
V2_PUBLIC_URL=$PUBLIC_URL
TRUSTED_PROXY=$TRUSTED_PROXY_VALUE

ABUD_IMAGE=$RELEASE_IMAGE
ABUD_RELEASE_CHANNEL=$RELEASE_CHANNEL
ABUD_HOST_PLATFORM=linux
ABUD_INSTALL_TYPE=docker_linux

NODE_ENV=production
V2_ENABLED=true
LOG_LEVEL=info
GENERIC_TIMEZONE=Africa/Cairo
WHISPER_MODEL=small
KOKORO_MODEL_PRECISION=q4

POSTGRES_DB=abud_shorts
POSTGRES_USER=abud_shorts
POSTGRES_PASSWORD=$PG_PASS

INTERNAL_SERVICE_TOKEN=abud_v2_sec_$(secret 32)
N8N_ENCRYPTION_KEY=$(secret 16)
SESSION_SECRET=$(secret 32)
PROVIDER_VAULT_MASTER_KEY=$(secret 32)
WEBHOOK_SIGNING_SECRET=whsec_$(secret 24)

# Arabic narration is produced by ElevenLabs and configured from the app:
# Providers -> ElevenLabs -> Configure. The key is held encrypted in the
# provider vault, so editing this file is not required.
ELEVENLABS_API_KEY=
ELEVENLABS_DEFAULT_VOICE_ID=
PEXELS_API_KEY=
ENVEOF
  chmod 600 "$ABUD_ENV_FILE"
  echo "      Generated a unique configuration with fresh secrets."
else
  # An existing installation keeps its secrets and its data. Only the version
  # pointers move.
  update_env() {
    if grep -qE "^$1=" "$ABUD_ENV_FILE"; then
      sed -i "s|^$1=.*|$1=$2|" "$ABUD_ENV_FILE"
    else
      printf '%s=%s\n' "$1" "$2" >> "$ABUD_ENV_FILE"
    fi
  }
  update_env ABUD_IMAGE "$RELEASE_IMAGE"
  update_env ABUD_RELEASE_CHANNEL "$RELEASE_CHANNEL"
  echo "      Existing configuration kept; secrets and data untouched."
fi

jq -n \
  --arg current "$RELEASE_VERSION" \
  --arg image "$RELEASE_IMAGE" \
  --arg channel "$RELEASE_CHANNEL" \
  --arg url "$PUBLIC_URL" \
  --arg home "$ABUD_HOME" \
  --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{product: "ABUD Shorts Engine", currentVersion: $current, previousVersion: null,
    image: $image, channel: $channel, publicUrl: $url, installRoot: $home, updatedAt: $at}' \
  > "$ABUD_SHARED/installation.json"
chmod 600 "$ABUD_SHARED/installation.json"

# ---------------------------------------------------------------------------
# 8. Start
# ---------------------------------------------------------------------------
echo "[8/9] Starting ABUD Shorts..."
ABUD_DATA_DIR="$ABUD_DATA_DIR" ABUD_RELEASE_DIR="$RELEASE_DIR" \
docker compose \
  --project-name abud-shorts \
  --env-file "$ABUD_ENV_FILE" \
  --file "$RELEASE_DIR/docker-compose.prod.yml" \
  up -d --remove-orphans

# The operator command. After this the customer never needs a Docker command.
install -m 0755 "$RELEASE_DIR/scripts/host/abud-shorts.sh" /usr/local/bin/abud-shorts 2>/dev/null || {
  echo "      Note: /usr/local/bin is not writable, so the 'abud-shorts' command was not installed."
  echo "      Run it from: $ABUD_CURRENT/scripts/host/abud-shorts.sh"
}

echo "[9/9] Waiting for the system to become ready..."
READY=false
for attempt in $(seq 1 90); do
  if curl -fsS --max-time 5 "http://127.0.0.1:$HOST_PORT/health/ready" >/dev/null 2>&1; then
    READY=true
    break
  fi
  sleep 2
done

# ---------------------------------------------------------------------------
# Health summary
# ---------------------------------------------------------------------------
health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo missing
}
friendly() {
  case "$1" in healthy|running) echo "Healthy" ;; starting) echo "Starting" ;; *) echo "Problem" ;; esac
}

echo ""
echo "================================================================="
if [ "$READY" = true ]; then
  echo "  ABUD Shorts Engine $RELEASE_VERSION is installed and running"
else
  echo "  ABUD Shorts Engine $RELEASE_VERSION is installed"
fi
echo "================================================================="
echo ""
echo "  ABUD Shorts:   $([ "$READY" = true ] && echo Healthy || echo "Still starting")"
echo "  Application:   $(friendly "$(health abud-shorts-app)")"
echo "  Video Engine:  $(friendly "$(health abud-shorts-render-worker)")"
echo "  Database:      $(friendly "$(health abud-shorts-postgres)")"
echo "  Automation:    $(friendly "$(health abud-shorts-n8n)")"
echo "  URL:           $PUBLIC_URL"
echo ""
echo "  Next step - open this address and create your administrator account:"
echo "      $PUBLIC_URL/setup"
echo ""
echo "  Day-to-day commands:"
echo "      abud-shorts status      Health and version"
echo "      abud-shorts update      Install the latest version, safely"
echo "      abud-shorts backup      Create a backup now"
echo ""
if [ "$READY" != true ]; then
  echo "  The system is taking longer than usual to start. Check it with:"
  echo "      abud-shorts status"
  echo ""
fi
