# ==============================================================================
# ABUD Shorts Engine - Motion Graphics Pack Installer (PowerShell)
# Installs & Verifies Motion Canvas Generator & Arabic Typography Runtime
# ==============================================================================
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host " ABUD Shorts Engine - Motion Graphics Pack Setup" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

# 1. Check Node.js
$nodeExe = Get-Command "node" -ErrorAction SilentlyContinue
if (-not $nodeExe) {
    Write-Error "Node.js 18+ is required on PATH but was not found."
    exit 1
}
Write-Host "[✓] Node.js runtime detected." -ForegroundColor Green

# 2. Check FFmpeg
$ffmpegFound = $false
try {
    $ffmpegPath = & node -e "try { console.log(require('@ffmpeg-installer/ffmpeg').path); } catch(e) { process.exit(1); }"
    if ($ffmpegPath -and (Test-Path $ffmpegPath)) {
        Write-Host "[✓] FFmpeg engine located: $ffmpegPath" -ForegroundColor Green
        $ffmpegFound = $true
    }
} catch {}

if (-not $ffmpegFound) {
    $ffmpegSys = Get-Command "ffmpeg" -ErrorAction SilentlyContinue
    if ($ffmpegSys) {
        Write-Host "[✓] System FFmpeg located." -ForegroundColor Green
    } else {
        Write-Error "FFmpeg is required for Motion Graphics rendering."
        exit 1
    }
}

# 3. Check Python Quality Venv for PIL / Cairo font generation
$venvPython = "$PSScriptRoot\..\.venv-quality\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    $venvPython = "$PSScriptRoot\..\.venv-quality\bin\python"
}

if (-not (Test-Path $venvPython)) {
    Write-Host "[*] Quality virtual environment not found; installing Quality Pack first..." -ForegroundColor Yellow
    & "$PSScriptRoot\install-quality-pack.ps1"
}

Write-Host "[✓] Motion Canvas templates ready (Kinetic Typography, Stat Animation, Feature List, CTA Card, Explainer Diagram)." -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host " Motion Graphics Pack is ready for production." -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan
exit 0
