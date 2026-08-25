# ==============================================================================
# ABUD Shorts Engine - Quality Runtime Pack Installer (PowerShell)
# Installs PySceneDetect, rembg, librosa, edge-tts in isolated .venv-quality
# ==============================================================================
param(
    [string]$TargetDir = "$PSScriptRoot\..\.venv-quality",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host " ABUD Shorts Engine - Quality Runtime Pack (CPU) Setup" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

# 1. Disk Space Check
$drive = (Get-Item $PSScriptRoot).PSDrive
if ($drive -and $drive.Free -lt 500MB) {
    Write-Error "Insufficient disk space. At least 500MB is required."
    exit 1
}
Write-Host "[✓] Disk space verified: $([math]::Round($drive.Free / 1GB, 2)) GB free." -ForegroundColor Green

# 2. Python Check
$pythonExe = Get-Command "python" -ErrorAction SilentlyContinue
if (-not $pythonExe) {
    Write-Error "Python 3.10+ is required on PATH but was not found."
    exit 1
}
$pyVersion = & python --version
Write-Host "[✓] Python detected: $pyVersion" -ForegroundColor Green

# 3. Create or verify virtual environment
$resolvedTarget = (Resolve-Path -Path $TargetDir -ErrorAction SilentlyContinue)
if (-not $resolvedTarget -or $Force) {
    Write-Host "[*] Creating isolated virtual environment at $TargetDir ..." -ForegroundColor Yellow
    & python -m venv $TargetDir
} else {
    Write-Host "[✓] Virtual environment exists at $TargetDir" -ForegroundColor Green
}

$venvPython = Join-Path $TargetDir "Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    $venvPython = Join-Path $TargetDir "bin/python"
}

if (-not (Test-Path $venvPython)) {
    Write-Error "Failed to locate virtual environment python at $venvPython"
    exit 1
}

# 4. Install pinned packages
Write-Host "[*] Installing Quality Runtime Pack dependencies..." -ForegroundColor Yellow
& $venvPython -m pip install --quiet --upgrade pip
& $venvPython -m pip install --quiet `
    "scenedetect==0.7.1" `
    "rembg==2.0.81" `
    "onnxruntime==1.29.0" `
    "librosa==0.11.0" `
    "soundfile==0.14.0" `
    "edge-tts==7.2.8" `
    "pillow" `
    "fastapi" `
    "uvicorn" `
    "opencv-python"

# 5. Sanity Check
Write-Host "[*] Running verification sanity checks..." -ForegroundColor Yellow
$verifyScript = @"
import scenedetect
import rembg
import librosa
import edge_tts
print('Quality Pack verified successfully.')
"@
$checkResult = & $venvPython -c $verifyScript
if ($checkResult -match "Quality Pack verified") {
    Write-Host "[✓] All Quality Pack components (PySceneDetect, rembg, librosa, edge-tts) verified!" -ForegroundColor Green
} else {
    Write-Error "Sanity verification check failed."
    exit 1
}

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host " Quality Runtime Pack is ready for production." -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan
exit 0
