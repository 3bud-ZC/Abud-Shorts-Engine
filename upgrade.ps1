# ==============================================================================
# ABUD Shorts Engine V2 - Upgrade entry point (Windows)
# ==============================================================================
# Kept so existing documentation and habits keep working. The real updater is
# scripts\host\abud-shorts.ps1, which is also what the "ABUD Shorts - Update"
# Start Menu shortcut runs: one code path, one set of safety checks, one
# rollback.
# ==============================================================================

[CmdletBinding()]
param(
    [switch]$Check,
    [string]$TargetVersion = "",
    [switch]$Yes,
    [string]$InstallRoot = ""
)

$ErrorActionPreference = "Stop"

if ($InstallRoot) { $env:ABUD_HOME = $InstallRoot }
if (-not $env:ABUD_HOME) { $env:ABUD_HOME = Join-Path $env:ProgramData "AbudShorts" }

$candidates = @(
    (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "scripts\host\abud-shorts.ps1")
)
$currentFile = Join-Path $env:ABUD_HOME "current.txt"
if (Test-Path $currentFile) {
    $candidates += (Join-Path (Get-Content $currentFile -Raw).Trim() "scripts\host\abud-shorts.ps1")
}

foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
        & $candidate update -Check:$Check -TargetVersion $TargetVersion -Yes:$Yes
        exit $LASTEXITCODE
    }
}

Write-Host "Error: the ABUD Shorts updater was not found." -ForegroundColor Red
Write-Host 'On an installed system, use the Start Menu shortcut "ABUD Shorts - Update".'
exit 1
