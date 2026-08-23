# ==============================================================================
# ABUD Shorts Engine V2 — Production Upgrade Script (Windows PowerShell)
# Version: 2.0.1
# ==============================================================================

[CmdletBinding()]
param (
    [int]$Port = 3130,
    [string]$ProjectName = "",
    [string]$ComposeFile = "docker-compose.v2.yml"
)

$ErrorActionPreference = "Stop"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  ABUD Shorts Engine V2 — Safe Production Upgrade (v2.0.1)" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# 1. Automatic Pre-Upgrade Safety Backup
Write-Host "[1/4] Triggering pre-upgrade safety backup..." -ForegroundColor Yellow
try {
    $res = Invoke-RestMethod -Uri "http://localhost:$Port/api/v2/backups" -Method Post -Body '{"type":"config_db","notes":"Pre-upgrade auto safety backup"}' -ContentType "application/json" -TimeoutSec 15
    Write-Host " -> Pre-upgrade safety backup created: $($res.backup.filename)" -ForegroundColor Green
} catch {
    Write-Warning "Could not trigger automated API backup (service might be stopped). Proceeding with Docker volume preservation."
}

# 2. Pull / Rebuild Stack
Write-Host "[2/4] Updating Docker images..." -ForegroundColor Yellow
$composeBase = @("-f", $ComposeFile)
if ($ProjectName) {
    $composeBase += @("-p", $ProjectName)
}
& docker compose @composeBase build

# 3. Restart Stack with Migrations
Write-Host "[3/4] Restarting services with latest migrations..." -ForegroundColor Yellow
$upArgs = $composeBase + @("up", "-d")
& docker compose @upArgs

# 4. Health Verification
Write-Host "[4/4] Verifying upgraded system health..." -ForegroundColor Yellow
$healthy = $false
$attempts = 0
while ($attempts -lt 15) {
    $attempts++
    Start-Sleep -Seconds 2
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:$Port/health/ready" -Method Get -TimeoutSec 5 -ErrorAction SilentlyContinue
        if ($response.ready -eq $true) {
            $healthy = $true
            break
        }
    } catch {}
}

if ($healthy) {
    Write-Host " -> Upgrade completed successfully! System is healthy." -ForegroundColor Green
} else {
    Write-Warning "System reported degraded health after upgrade. Check logs with: docker compose logs app"
}
