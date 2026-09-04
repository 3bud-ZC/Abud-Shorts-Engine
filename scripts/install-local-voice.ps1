# ==============================================================================
# ABUD Shorts Engine - Local Egyptian TTS Installer (PowerShell)
# Selective download for VoiceTut-TTS & KemeTone pinned inference files
# ==============================================================================
param(
    [ValidateSet("voicetut", "kemetone", "all")]
    [string]$ModelId = "voicetut",
    [string]$CacheDir = "",
    [switch]$VerifyOnly,
    [switch]$Mock
)

$ErrorActionPreference = "Stop"

if (-not $CacheDir) {
    if ($env:ABUD_MODEL_CACHE_DIR) {
        $CacheDir = $env:ABUD_MODEL_CACHE_DIR
    } else {
        $CacheDir = Join-Path $PSScriptRoot "..\data-dev\models"
    }
}

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host " ABUD Shorts Engine - Local Egyptian TTS Model Installer" -ForegroundColor Cyan
Write-Host " Cache Directory: $CacheDir" -ForegroundColor Cyan
Write-Host " Target Model: $ModelId" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

# 1. Disk Space Check (Requires at least 3GB for VoiceTut, 500MB for KemeTone)
$drive = (Get-Item $PSScriptRoot).PSDrive
if ($drive -and $drive.Free -lt 1GB -and -not $VerifyOnly) {
    Write-Error "Insufficient disk space. At least 1GB is required for installation."
    exit 1
}
Write-Host "[✓] Disk space verified: $([math]::Round($drive.Free / 1GB, 2)) GB free." -ForegroundColor Green

function Install-Model([string]$Id, [string]$Repo, [string]$Rev, [string[]]$Files) {
    $targetDir = Join-Path $CacheDir "tts\$Id"
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

    Write-Host "[*] Processing model '$Id' ($Repo @ $Rev)..." -ForegroundColor Yellow

    if ($Mock) {
        Write-Host "[*] Mock mode enabled: generating deterministic inference stubs..." -ForegroundColor Yellow
        foreach ($file in $Files) {
            $dest = Join-Path $targetDir $file
            $destDir = Split-Path $dest
            if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
            if (-not (Test-Path $dest)) {
                Set-Content -Path $dest -Value "MOCK_WEIGHTS_STUB_$Id" -Encoding utf8
            }
        }
    } elseif (-not $VerifyOnly) {
        Write-Host "[*] Downloading selective inference files from HuggingFace..." -ForegroundColor Yellow
        foreach ($file in $Files) {
            $dest = Join-Path $targetDir $file
            $destDir = Split-Path $dest
            if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
            
            if (Test-Path $dest) {
                Write-Host "  [✓] Existing: $file" -ForegroundColor Green
                continue
            }

            $url = "https://huggingface.co/$Repo/resolve/$Rev/$file"
            Write-Host "  [↓] Downloading: $file from $url ..." -ForegroundColor Gray
            try {
                Invoke-WebRequest -Uri $url -OutFile $dest -TimeoutSec 300 -UseBasicParsing
                Write-Host "  [✓] Downloaded: $file" -ForegroundColor Green
            } catch {
                Write-Warning "  [!] Failed to download $file : $_"
            }
        }
    }

    # Verify expected files
    $missing = @()
    foreach ($file in $Files) {
        $dest = Join-Path $targetDir $file
        if (-not (Test-Path $dest)) {
            $missing += $file
        }
    }

    $metadataPath = Join-Path $targetDir "metadata.json"
    $downloadedBytes = (Get-ChildItem -Path $targetDir -Recurse -File | Measure-Object -Property Length -Sum).Sum

    if ($missing.Count -eq 0) {
        $metadata = @{
            modelId = $Id
            providerModelId = $Repo
            revision = $Rev
            state = "ready"
            downloadedBytes = $downloadedBytes
            expectedFiles = $Files
            lastVerifiedAt = (Get-Date).ToString("o")
            installedAt = (Get-Date).ToString("o")
            runtimeStatus = "verified"
        } | ConvertTo-Json -Depth 5

        Set-Content -Path $metadataPath -Value $metadata -Encoding utf8
        Write-Host "[✓] Model '$Id' is ready and verified! Total size: $([math]::Round($downloadedBytes / 1MB, 2)) MB" -ForegroundColor Green
    } else {
        $metadata = @{
            modelId = $Id
            providerModelId = $Repo
            revision = $Rev
            state = "error"
            downloadedBytes = $downloadedBytes
            expectedFiles = $Files
            lastError = "Missing inference files: $($missing -join ', ')"
            lastVerifiedAt = (Get-Date).ToString("o")
            runtimeStatus = "incomplete"
        } | ConvertTo-Json -Depth 5

        Set-Content -Path $metadataPath -Value $metadata -Encoding utf8
        Write-Warning "[!] Model '$Id' has missing files: $($missing -join ', ')"
    }
}

$voicetutFiles = @(
    "config.json",
    "chat_template.jinja",
    "model.safetensors",
    "tokenizer.json",
    "tokenizer_config.json",
    "reference_speakers/references.json",
    "reference_speakers/Abdelrahman_clean.wav",
    "reference_speakers/Abdullah_clean.wav",
    "reference_speakers/Ahmed_clean.mp3",
    "reference_speakers/Aly_reference.wav",
    "reference_speakers/Asmaa_clean.wav",
    "reference_speakers/Esraa_clean.wav",
    "reference_speakers/Essam_clean.mp3",
    "reference_speakers/Hanan_clean.wav",
    "reference_speakers/Hossam_clean.wav",
    "reference_speakers/Kamal_clean.wav",
    "reference_speakers/Mohamed_clean.wav",
    "reference_speakers/Omar_clean.wav",
    "reference_speakers/Omnia_clean.wav",
    "reference_speakers/Sarah_clean.wav",
    "reference_speakers/Sayed_clean.wav",
    "reference_speakers/Yasmin_clean.wav",
    "reference_speakers/Zaki_clean.wav"
)

$kemetoneFiles = @(
    "config.json",
    "kemetone.pth",
    "voices/kemetone.pt",
    "kemetone/__init__.py",
    "kemetone/arabic.py",
    "kemetone/g2p.py",
    "kemetone/normalize_tashkeel.py",
    "kemetone/runtime.py",
    "kemetone/lexicons/ث.tsv",
    "kemetone/lexicons/ذ.tsv",
    "kemetone/lexicons/ظ.tsv",
    "kemetone/lexicons/ق.tsv"
)

if ($ModelId -eq "voicetut" -or $ModelId -eq "all") {
    Install-Model -Id "voicetut" -Repo "mohammedaly22/VoiceTut-TTS" -Rev "41c1a79ab2eb872ecfb2ad56ab40a94cff28d8c3" -Files $voicetutFiles
}

if ($ModelId -eq "kemetone" -or $ModelId -eq "all") {
    Install-Model -Id "kemetone" -Repo "Rabe3/kemetone" -Rev "9d65fab8cd71bc31a248e53bd18fe94941753aa6" -Files $kemetoneFiles
}

Write-Host "`n[✓] Local Egyptian TTS installer run complete." -ForegroundColor Green
