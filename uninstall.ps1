# ==============================================================================
# ABUD Shorts Engine V2 — Safe Uninstaller (Windows PowerShell)
# Version: 2.0.0
# ==============================================================================

[CmdletBinding()]
param (
    [string]$ProjectName = "",
    [string]$ComposeFile = "docker-compose.v2.yml",
    [string]$DataDir = "data",
    [switch]$RemoveData = $false
)

$ErrorActionPreference = "Stop"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  ABUD Shorts Engine V2 — Safe Uninstaller" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# 1. Stop and remove containers
Write-Host "[1/2] Stopping and removing Docker containers..." -ForegroundColor Yellow
$composeArgs = @("-f", $ComposeFile)
if ($ProjectName) {
    $composeArgs += @("-p", $ProjectName)
}
$composeArgs += @("down")
& docker compose @composeArgs

# 2. Handle Persistent Data
if ($RemoveData) {
    Write-Warning "DESTRUCTIVE MODE: Removing all persistent volumes and data..."
    $downVArgs = @("-f", $ComposeFile)
    if ($ProjectName) {
        $downVArgs += @("-p", $ProjectName)
    }
    $downVArgs += @("down", "-v")
    & docker compose @downVArgs
    if (Test-Path $DataDir) {
        Remove-Item -Path $DataDir -Recurse -Force
    }
    Write-Host " -> Persistent data removed." -ForegroundColor Red
} else {
    Write-Host " -> Persistent database volumes and data/ directory PRESERVED." -ForegroundColor Green
    Write-Host "    (To completely remove all data, rerun with: .\uninstall.ps1 -RemoveData)" -ForegroundColor Gray
}

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  Uninstallation complete." -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
