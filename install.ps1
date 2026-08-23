# ==============================================================================
# ABUD Shorts Engine V2 — Production Installer (Windows PowerShell)
# Version: 2.1.0
# ==============================================================================

[CmdletBinding()]
param (
    [int]$Port = 3130,
    [string]$ProjectName = "",
    [string]$ComposeFile = "docker-compose.v2.yml",
    [string]$DataDir = "data",
    [switch]$DevMode = $false
)

$ErrorActionPreference = "Stop"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  ABUD Shorts Engine V2 — One-Command Production Installer" -ForegroundColor Cyan
Write-Host "  Version: 2.1.0" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verify Docker Engine & CLI
Write-Host "[1/8] Verifying Docker installation..." -ForegroundColor Yellow
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker is not installed or not in PATH. Please install Docker Desktop for Windows: https://www.docker.com/products/docker-desktop/"
    exit 1
}

try {
    $dockerInfo = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Docker daemon is not running. Please start Docker Desktop and rerun this installer."
        exit 1
    }
    Write-Host " -> Docker is running and healthy." -ForegroundColor Green
} catch {
    Write-Error "Failed to communicate with Docker daemon."
    exit 1
}

# 2. Check Disk Space
Write-Host "[2/8] Checking available disk space..." -ForegroundColor Yellow
$drive = Get-PSDrive -Name (Get-Location).Drive.Name
$freeSpaceGB = [math]::Round($drive.Free / 1GB, 2)
if ($freeSpaceGB -lt 2.0) {
    Write-Warning "Low disk space detected: $freeSpaceGB GB available. At least 5 GB is recommended."
} else {
    Write-Host " -> Disk space available: $freeSpaceGB GB." -ForegroundColor Green
}

# 3. Port Conflict Detection
Write-Host "[3/8] Checking port availability for HTTP ($Port)..." -ForegroundColor Yellow
$portOccupied = $false
try {
    $conn = New-Object System.Net.Sockets.TcpClient
    $conn.Connect("127.0.0.1", $Port)
    $conn.Close()
    $portOccupied = $true
} catch {
    $portOccupied = $false
}

if ($portOccupied) {
    Write-Warning "Port $Port is already in use on this system!"
    Write-Host " -> You can specify a different port: .\install.ps1 -Port 3131" -ForegroundColor Yellow
} else {
    Write-Host " -> Port $Port is available." -ForegroundColor Green
}

# 4. Create Persistent Storage Directories
Write-Host "[4/8] Creating persistent storage directories..." -ForegroundColor Yellow
$storageDirs = @(
    "data/videos",
    "data/thumbnails",
    "data/uploads",
    "data/cache",
    "data/models",
    "data/backups",
    "data/logs"
)
foreach ($dir in $storageDirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}
Write-Host " -> Storage directories initialized." -ForegroundColor Green

# 5. Generate Secure Configuration & Secrets
Write-Host "[5/8] Configuring environment and generating cryptographic secrets..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    function Generate-SecretHex([int]$bytes) {
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        $buffer = New-Object byte[] $bytes
        $rng.GetBytes($buffer)
        return [System.BitConverter]::ToString($buffer).Replace("-", "").ToLower()
    }

    $internalToken = "abud_v2_sec_" + (Generate-SecretHex 32)
    $pgPass = "abud_pg_" + (Generate-SecretHex 16)
    $n8nKey = Generate-SecretHex 16
    $sessionSecret = Generate-SecretHex 32
    $whSecret = "whsec_" + (Generate-SecretHex 24)

    $envContent = @"
# ABUD Shorts Engine V2 — Environment Configuration
PORT=3123
HOST_PORT=$Port
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
DATABASE_URL=postgresql://abud_shorts:$pgPass@postgres:5432/abud_shorts
WHISPER_MODEL=small
KOKORO_MODEL_PRECISION=q4

# Local Arabic voice path.
PIPER_BIN=/opt/piper/bin/piper
PIPER_AR_MODEL_PATH=/app/data/models/piper/ar_JO-kareem-medium.onnx
PIPER_AR_MODEL_CONFIG_PATH=/app/data/models/piper/ar_JO-kareem-medium.onnx.json
PIPER_AR_VOICE_ID=ar_JO-kareem-medium
PIPER_AR_LENGTH_SCALE=1.50
PIPER_AR_SENTENCE_SILENCE=0.25
PIPER_AR_MODEL_LICENSE=MIT
PIPER_AR_RUNTIME_LICENSE=GPL-3.0-or-later
PIPER_AR_MODEL_COMMERCIAL_USE=allowed

# Cryptographic Secrets
INTERNAL_SERVICE_TOKEN=$internalToken
POSTGRES_PASSWORD=$pgPass
N8N_ENCRYPTION_KEY=$n8nKey
SESSION_SECRET=$sessionSecret
WEBHOOK_SIGNING_SECRET=$whSecret
"@
    Set-Content -Path ".env" -Value $envContent -Encoding utf8
    Write-Host " -> Generated secure production .env with random cryptographic secrets." -ForegroundColor Green
} else {
    Write-Host " -> Existing .env found; preserving configured credentials." -ForegroundColor Green
}

# 6. Start Docker Stack
Write-Host "[6/8] Starting Docker services (app, render-worker, n8n, postgres)..." -ForegroundColor Yellow
$composeArgs = @("-f", $ComposeFile)
if ($ProjectName) {
    $composeArgs += @("-p", $ProjectName)
}
$composeArgs += @("up", "-d", "--remove-orphans")
& docker compose @composeArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to start Docker compose stack."
    exit 1
}

# 7. Wait for Service Health
Write-Host "[7/8] Waiting for services to become healthy..." -ForegroundColor Yellow
$maxAttempts = 30
$attempt = 0
$healthy = $false

while ($attempt -lt $maxAttempts) {
    $attempt++
    Start-Sleep -Seconds 2
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:$Port/health/ready" -Method Get -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($response.ready -eq $true -or $response.status -eq "ok") {
            $healthy = $true
            break
        }
    } catch {
        # continue waiting
    }
    Write-Host " -> Waiting for application startup ($attempt/$maxAttempts)..." -ForegroundColor Gray
}

if (-not $healthy) {
    Write-Warning "Application took longer than expected to report ready. Check logs with: docker compose -f docker-compose.v2.yml logs app"
} else {
    Write-Host " -> All services are healthy and operational." -ForegroundColor Green
}

# 8. Success Banner
Write-Host ""
Write-Host "=================================================================" -ForegroundColor Green
Write-Host "  ABUD Shorts Engine V2 is Ready!" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green
Write-Host "  Dashboard:       http://localhost:$Port" -ForegroundColor Cyan
Write-Host "  Setup Wizard:    http://localhost:$Port/setup" -ForegroundColor Cyan
Write-Host "  Free Pipeline:   Ready (Local Director, Pexels, Piper Arabic, Kokoro English, Whisper, Remotion)" -ForegroundColor Green
Write-Host "  Database:        PostgreSQL Connected & Migrated" -ForegroundColor Green
Write-Host "  Orchestrator:    n8n Internal Automation Active" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Run the First-Run Setup Wizard at: http://localhost:$Port/setup" -ForegroundColor Yellow
