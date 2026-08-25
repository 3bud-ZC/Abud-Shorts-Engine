# ==============================================================================
# ABUD Shorts Engine V2 - Safe Uninstaller (Windows)
# ==============================================================================
# The default removes the running software and leaves every byte the customer
# produced exactly where it is. Destroying data requires an explicit switch and
# a typed confirmation.
# ==============================================================================

[CmdletBinding()]
param(
    [string]$InstallRoot = "",
    [string]$ComposeProject = "abud-shorts",
    [switch]$RemoveData
)

$ErrorActionPreference = "Stop"

if (-not $InstallRoot) { $InstallRoot = Join-Path $env:ProgramData "AbudShorts" }
$AbudShared      = Join-Path $InstallRoot "shared"
$AbudDataDir     = Join-Path $AbudShared "data"
$AbudEnvFile     = Join-Path $AbudShared "config\.env"
$AbudCurrentFile = Join-Path $InstallRoot "current.txt"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  ABUD Shorts Engine - Uninstaller" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

$composeFile = ""
if (Test-Path $AbudCurrentFile) {
    $composeFile = Join-Path (Get-Content $AbudCurrentFile -Raw).Trim() "docker-compose.prod.yml"
}
# Fall back to the in-place layout used by a developer checkout.
if (-not (Test-Path $composeFile)) {
    foreach ($candidate in @("docker-compose.prod.yml", "docker-compose.v2.yml")) {
        if (Test-Path $candidate) { $composeFile = (Resolve-Path $candidate).Path; break }
    }
}

function Invoke-ComposeDown([string[]]$ExtraArgs) {
    if (-not (Test-Path $composeFile)) {
        & docker compose --project-name $ComposeProject down @ExtraArgs 2>$null | Out-Null
        return
    }
    $env:ABUD_DATA_DIR = $AbudDataDir
    $env:ABUD_RELEASE_DIR = (Split-Path $composeFile)
    $composeArgs = @("compose", "--project-name", $ComposeProject)
    if (Test-Path $AbudEnvFile) { $composeArgs += @("--env-file", $AbudEnvFile) }
    $composeArgs += @("--file", $composeFile, "down") + $ExtraArgs
    & docker @composeArgs 2>$null | Out-Null
}

Write-Host "[1/2] Stopping and removing the application containers..." -ForegroundColor Yellow
Invoke-ComposeDown @()
Write-Host "      Containers removed." -ForegroundColor Green

if (-not $RemoveData) {
    Write-Host "[2/2] Keeping your data." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  PRESERVED:" -ForegroundColor Green
    Write-Host "    Videos, uploads and media   $AbudDataDir"
    Write-Host "    Database                    Docker volume ${ComposeProject}_abud-shorts-postgres-data"
    Write-Host "    Backups                     $(Join-Path $AbudShared 'backups')"
    Write-Host "    Configuration and secrets   $(Join-Path $AbudShared 'config')"
    Write-Host ""
    Write-Host "  Reinstalling over this directory picks everything up again."
    Write-Host "  To erase all of it permanently: .\uninstall.ps1 -RemoveData"
    Write-Host "=================================================================" -ForegroundColor Cyan
    exit 0
}

Write-Host ""
Write-Host "  WARNING - DESTRUCTIVE" -ForegroundColor Red
Write-Host "  This permanently deletes every video, upload, brand, publication record," -ForegroundColor Red
Write-Host "  backup and setting on this machine. It cannot be undone." -ForegroundColor Red
Write-Host ""
$reply = Read-Host "  Type DELETE to confirm"
if ($reply -ne "DELETE") {
    Write-Host "  Cancelled. Nothing was removed." -ForegroundColor Green
    exit 1
}

Write-Host "[2/2] Removing all data..." -ForegroundColor Yellow
Invoke-ComposeDown @("-v")
if (Test-Path $AbudShared) { Remove-Item $AbudShared -Recurse -Force }
$startMenu = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\ABUD Shorts"
if (Test-Path $startMenu) { Remove-Item $startMenu -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host "      All data removed." -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
