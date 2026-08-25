# ==============================================================================
# ABUD Shorts Engine V2 - Client Installer (Windows)
# ==============================================================================
# Right-click install.ps1 -> Run with PowerShell, or:
#
#   .\install.ps1
#   .\install.ps1 -Port 3131
#   .\install.ps1 -PublicUrl https://shorts.example.com
#
# What it produces:
#
#   %ProgramData%\AbudShorts\
#     current.txt                 the release directory in use
#     releases\<version>\         this release, and every earlier one
#     shared\                     EVERYTHING THE CUSTOMER OWNS
#       data\ config\ backups\ logs\ state\ installation.json
#
# Updating replaces a release directory. It never writes inside shared\, which
# is why videos, uploads, brands, settings and backups survive every update.
# ==============================================================================

[CmdletBinding()]
param(
    [int]$Port = 3130,
    [string]$PublicUrl = "",
    [string]$InstallRoot = "",
    [string]$Image = "",
    [switch]$BehindProxy,
    # Used by the isolated F4 rehearsal so a test installation cannot collide
    # with a real one on the same machine.
    [string]$ComposeProject = "abud-shorts",
    [switch]$NoShortcuts,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$PackageDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $InstallRoot) { $InstallRoot = Join-Path $env:ProgramData "AbudShorts" }
$AbudShared      = Join-Path $InstallRoot "shared"
$AbudReleases    = Join-Path $InstallRoot "releases"
$AbudCurrentFile = Join-Path $InstallRoot "current.txt"
$AbudDataDir     = Join-Path $AbudShared "data"
$AbudConfigDir   = Join-Path $AbudShared "config"
$AbudEnvFile     = Join-Path $AbudConfigDir ".env"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  ABUD Shorts Engine - Installer" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

function Fail([string]$Message) {
    Write-Host ""
    Write-Host "  $Message" -ForegroundColor Red
    Write-Host ""
    exit 1
}

<#
Writes UTF-8 WITHOUT a byte order mark.

Windows PowerShell 5.1 emits a BOM from both Out-File -Encoding utf8 and
Set-Content -Encoding utf8. Everything that reads these files afterwards is
not PowerShell: the application parses the update record with JSON.parse,
which rejects a leading BOM outright, and docker compose reads the .env file,
where a BOM would corrupt the first variable name. So every file this script
produces is written through here.
#>
function Write-TextFile {
    param([string]$Path, [string]$Content)
    $directory = Split-Path -Parent $Path
    if ($directory -and -not (Test-Path $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

<#
Runs docker and returns its exit code in $LASTEXITCODE.

Windows PowerShell wraps anything a native program writes to stderr in an
ErrorRecord, and with $ErrorActionPreference = 'Stop' that aborts the script.
Docker writes all of its normal progress - "Pulling", "Waiting", layer
progress - to stderr, so without this every successful image pull would kill
the installer partway through. The exit code is the only thing that actually
says whether docker succeeded, and each caller checks it.
#>
function Invoke-Docker {
    # A single array, not ValueFromRemainingArguments: PowerShell would try to
    # bind tokens like -f, -i and --project-name as parameters of this function
    # instead of passing them through to docker.
    param([Parameter(Mandatory = $true, Position = 0)][string[]]$DockerArgs)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & docker @DockerArgs 2>&1 | ForEach-Object { "$_" }
    } finally {
        $ErrorActionPreference = $previous
    }
}

# ---------------------------------------------------------------------------
# 1. Docker
# ---------------------------------------------------------------------------
Write-Host "[1/9] Checking Docker..." -ForegroundColor Yellow
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail "Docker Desktop is not installed. Install it from https://www.docker.com/products/docker-desktop/ and run this installer again."
}
Invoke-Docker @("info") | Out-Null
if ($LASTEXITCODE -ne 0) {
    Fail "Docker Desktop is not running. Start it, wait for the whale icon to settle, then run this installer again."
}
Invoke-Docker @("compose", "version") | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "The Docker Compose plugin is missing from this Docker Desktop installation." }
Write-Host "      Docker is running." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 2. Disk
# ---------------------------------------------------------------------------
Write-Host "[2/9] Checking disk space..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
$driveLetter = (Split-Path -Qualifier $InstallRoot).TrimEnd(":")
$freeGb = [math]::Round((Get-PSDrive -Name $driveLetter).Free / 1GB, 1)
if ($freeGb -lt 15) { Fail "$freeGb GB free. ABUD Shorts needs at least 15 GB to install." }
Write-Host "      $freeGb GB available." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 3. Address
# ---------------------------------------------------------------------------
Write-Host "[3/9] Checking the address this installation will serve..." -ForegroundColor Yellow
$portBusy = $false
try {
    $probe = New-Object System.Net.Sockets.TcpClient
    $probe.Connect("127.0.0.1", $Port)
    $probe.Close()
    $portBusy = $true
} catch { $portBusy = $false }
if ($portBusy) {
    # The port being busy is only a problem if something ELSE has it. Re-running
    # the installer over an existing ABUD Shorts installation - to repair it, or
    # to move it to a newer package - is a legitimate action, and it must not be
    # refused just because that installation is currently running.
    $ownedByUs = $false
    try {
        $probe = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v2/system/info" -TimeoutSec 5 -ErrorAction Stop
        $ownedByUs = ($probe.name -like "ABUD Shorts Engine*")
    } catch { $ownedByUs = $false }

    if ($ownedByUs) {
        Write-Host "      Port $Port is serving an existing ABUD Shorts installation; reinstalling over it." -ForegroundColor Yellow
        Write-Host "      Your videos, settings and backups are not touched."
    } else {
        Fail "Port $Port is already in use by another program on this machine. Choose another one: .\install.ps1 -Port 3131"
    }
}

$TrustedProxyValue = ""
if ($BehindProxy) { $TrustedProxyValue = "1" }
if (-not $PublicUrl) {
    $PublicUrl = "http://localhost:$Port"
    Write-Host "      Local installation: $PublicUrl" -ForegroundColor Green
    Write-Host "      For a server with a domain, rerun with: -PublicUrl https://shorts.example.com"
} else {
    if ($PublicUrl -notmatch '^https?://') { Fail "-PublicUrl must start with http:// or https://" }
    $PublicUrl = $PublicUrl.TrimEnd("/")
    Write-Host "      Public address: $PublicUrl" -ForegroundColor Green
    if (-not $BehindProxy) {
        Write-Host "      Forwarded proxy headers will stay ignored. Add -BehindProxy only when a trusted reverse proxy is in front." -ForegroundColor Yellow
    }
}

# ---------------------------------------------------------------------------
# 4. Release identity
# ---------------------------------------------------------------------------
Write-Host "[4/9] Reading this release..." -ForegroundColor Yellow
$releaseJsonPath = Join-Path $PackageDir "release.json"
if (-not (Test-Path $releaseJsonPath)) {
    Fail "release.json is missing. This does not look like an ABUD Shorts client package."
}
$releaseInfo = Get-Content $releaseJsonPath -Raw | ConvertFrom-Json
$ReleaseVersion = $releaseInfo.version
$ReleaseImage   = if ($Image) { $Image } else { $releaseInfo.image }
$ReleaseDigest  = $releaseInfo.imageDigest
$ReleaseChannel = if ($releaseInfo.channel) { $releaseInfo.channel } else { "stable" }
if (-not $ReleaseVersion) { Fail "This package does not declare a version." }
Write-Host "      Version $ReleaseVersion ($ReleaseChannel)" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 5. The application image: offline archive first, otherwise pull
# ---------------------------------------------------------------------------
Write-Host "[5/9] Preparing the application..." -ForegroundColor Yellow
$offlineArchive = $null
$imagesDir = Join-Path $PackageDir "images"
if (Test-Path $imagesDir) {
    $offlineArchive = Get-ChildItem $imagesDir -Filter "*.tar*" -ErrorAction SilentlyContinue | Select-Object -First 1
}
$imageAlreadyLocal = $false
if ($ReleaseImage) {
    Invoke-Docker @("image", "inspect", $ReleaseImage) | Out-Null
    $imageAlreadyLocal = ($LASTEXITCODE -eq 0)
}

if ($offlineArchive) {
    Write-Host "      Offline package: loading the bundled image (this takes a few minutes)..."
    Invoke-Docker @("load", "-i", $offlineArchive.FullName) | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "The bundled application image could not be loaded." }
    Write-Host "      Image loaded from the package." -ForegroundColor Green
} elseif ($imageAlreadyLocal) {
    # Already present locally - the case an offline reinstall and the isolated
    # F4 rehearsal both hit. No download needed.
    Write-Host "      The application image is already on this machine." -ForegroundColor Green
} else {
    # Pull by digest when the package publishes one: a tag can be moved, a
    # digest cannot, so this is what makes the installed version reproducible.
    $pullRef = $ReleaseImage
    if ($ReleaseDigest -and $ReleaseDigest -ne "null") {
        $pullRef = "$(($ReleaseImage -split ':')[0])@$ReleaseDigest"
    }
    Write-Host "      Downloading the application (this takes a few minutes)..."
    Invoke-Docker @("pull", $pullRef) | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Fail "The application image could not be downloaded. Check this machine's internet connection and try again."
    }
    $ReleaseImage = $pullRef
    Write-Host "      Application downloaded." -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 6. Persistent layout
# ---------------------------------------------------------------------------
Write-Host "[6/9] Creating the installation..." -ForegroundColor Yellow
foreach ($dir in @("videos", "thumbnails", "uploads", "cache", "models", "backups", "logs", "updates")) {
    New-Item -ItemType Directory -Path (Join-Path $AbudDataDir $dir) -Force | Out-Null
}
foreach ($dir in @($AbudConfigDir, (Join-Path $AbudShared "backups"), (Join-Path $AbudShared "logs"), (Join-Path $AbudShared "state"), $AbudReleases)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

$ReleaseDir = Join-Path $AbudReleases $ReleaseVersion
if (Test-Path "$ReleaseDir.incoming") { Remove-Item "$ReleaseDir.incoming" -Recurse -Force }
New-Item -ItemType Directory -Path "$ReleaseDir.incoming" -Force | Out-Null
# The image archive is not copied into the release directory: it is many
# gigabytes and Docker already holds it.
Get-ChildItem $PackageDir -Exclude "images" | Copy-Item -Destination "$ReleaseDir.incoming" -Recurse -Force
if (Test-Path $ReleaseDir) { Remove-Item $ReleaseDir -Recurse -Force }
Move-Item "$ReleaseDir.incoming" $ReleaseDir
Write-TextFile $AbudCurrentFile $ReleaseDir
Write-Host "      Installed to $ReleaseDir" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 7. Configuration and secrets
# ---------------------------------------------------------------------------
Write-Host "[7/9] Configuring..." -ForegroundColor Yellow
function New-SecretHex([int]$Bytes) {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $buffer = New-Object byte[] $Bytes
    $rng.GetBytes($buffer)
    return [System.BitConverter]::ToString($buffer).Replace("-", "").ToLower()
}

if (-not (Test-Path $AbudEnvFile)) {
    $pgPass = "abud_pg_" + (New-SecretHex 16)
    $envContent = @"
# ABUD Shorts Engine - installation configuration
# Generated by the installer. Every secret below is unique to this machine;
# there is no shared or default password anywhere in the product.

HOST_PORT=$Port
V2_PUBLIC_URL=$PublicUrl
TRUSTED_PROXY=$TrustedProxyValue

ABUD_IMAGE=$ReleaseImage
ABUD_RELEASE_CHANNEL=$ReleaseChannel
ABUD_HOST_PLATFORM=windows
ABUD_INSTALL_TYPE=docker_windows
ABUD_COMPOSE_PROJECT=$ComposeProject
ABUD_CONTAINER_PREFIX=$ComposeProject

NODE_ENV=production
V2_ENABLED=true
LOG_LEVEL=info
GENERIC_TIMEZONE=Africa/Cairo
WHISPER_MODEL=small
KOKORO_MODEL_PRECISION=q4

POSTGRES_DB=abud_shorts
POSTGRES_USER=abud_shorts
POSTGRES_PASSWORD=$pgPass

INTERNAL_SERVICE_TOKEN=abud_v2_sec_$(New-SecretHex 32)
N8N_ENCRYPTION_KEY=$(New-SecretHex 16)
SESSION_SECRET=$(New-SecretHex 32)
PROVIDER_VAULT_MASTER_KEY=$(New-SecretHex 32)
WEBHOOK_SIGNING_SECRET=whsec_$(New-SecretHex 24)

# Arabic narration is produced by ElevenLabs and configured from the app:
# Providers -> ElevenLabs -> Configure. The key is held encrypted in the
# provider vault, so editing this file is not required.
ELEVENLABS_API_KEY=
ELEVENLABS_DEFAULT_VOICE_ID=
PEXELS_API_KEY=
"@
    Write-TextFile $AbudEnvFile $envContent
    Write-Host "      Generated a unique configuration with fresh secrets." -ForegroundColor Green
} else {
    # An existing installation keeps its secrets and its data. Only the version
    # pointers move.
    $lines = Get-Content $AbudEnvFile
    function Update-EnvLine([string[]]$Lines, [string]$Key, [string]$Value) {
        $found = $false
        $out = foreach ($line in $Lines) {
            if ($line -match "^$([regex]::Escape($Key))=") { $found = $true; "$Key=$Value" } else { $line }
        }
        if (-not $found) { $out = @($out) + "$Key=$Value" }
        return $out
    }
    $lines = Update-EnvLine $lines "ABUD_IMAGE" $ReleaseImage
    $lines = Update-EnvLine $lines "ABUD_RELEASE_CHANNEL" $ReleaseChannel
    $lines = Update-EnvLine $lines "ABUD_COMPOSE_PROJECT" $ComposeProject
    $lines = Update-EnvLine $lines "ABUD_CONTAINER_PREFIX" $ComposeProject
    Write-TextFile $AbudEnvFile (($lines -join "`r`n") + "`r`n")
    Write-Host "      Existing configuration kept; secrets and data untouched." -ForegroundColor Green
}

[ordered]@{
    product         = "ABUD Shorts Engine"
    currentVersion  = $ReleaseVersion
    previousVersion = $null
    image           = $ReleaseImage
    channel         = $ReleaseChannel
    publicUrl       = $PublicUrl
    installRoot     = $InstallRoot
    updatedAt       = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
} | ConvertTo-Json -Depth 6 | ForEach-Object { Write-TextFile (Join-Path $AbudShared "installation.json") $_ }

# ---------------------------------------------------------------------------
# 8. Start
# ---------------------------------------------------------------------------
Write-Host "[8/9] Starting ABUD Shorts..." -ForegroundColor Yellow
$env:ABUD_DATA_DIR = $AbudDataDir
$env:ABUD_RELEASE_DIR = $ReleaseDir
$env:ABUD_CONTAINER_PREFIX = $ComposeProject
$composeFile = Join-Path $ReleaseDir "docker-compose.prod.yml"
Invoke-Docker @("compose", "--project-name", $ComposeProject, "--env-file", $AbudEnvFile, "--file", $composeFile, "up", "-d", "--remove-orphans")
if ($LASTEXITCODE -ne 0) { Fail "The system could not be started. Check that Docker Desktop has enough memory assigned." }

# Start Menu shortcuts, so the customer never types a Docker command.
if (-not $NoShortcuts) {
    $cliPath = Join-Path $ReleaseDir "scripts\host\abud-shorts.ps1"
    $startMenu = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\ABUD Shorts"
    try {
        New-Item -ItemType Directory -Path $startMenu -Force | Out-Null
        $shell = New-Object -ComObject WScript.Shell
        $shortcuts = @(
            @{ Name = "ABUD Shorts - Open";        Cmd = "start";       Desc = "Start ABUD Shorts and open the dashboard" },
            @{ Name = "ABUD Shorts - Update";      Cmd = "update";      Desc = "Install the latest version, safely" },
            @{ Name = "ABUD Shorts - Backup";      Cmd = "backup";      Desc = "Create a backup now" },
            @{ Name = "ABUD Shorts - Diagnostics"; Cmd = "diagnostics"; Desc = "Write a support bundle" },
            @{ Name = "ABUD Shorts - Status";      Cmd = "status";      Desc = "Show system health and version" }
        )
        foreach ($entry in $shortcuts) {
            $link = $shell.CreateShortcut((Join-Path $startMenu "$($entry.Name).lnk"))
            $link.TargetPath = "powershell.exe"
            $link.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$cliPath`" $($entry.Cmd) -Pause"
            $link.WorkingDirectory = $ReleaseDir
            $link.Description = $entry.Desc
            $link.Save()
        }
        Write-Host "      Start Menu shortcuts created under 'ABUD Shorts'." -ForegroundColor Green
    } catch {
        Write-Host "      Note: Start Menu shortcuts could not be created (run as administrator to add them)." -ForegroundColor Yellow
        Write-Host "      Run operations from: $cliPath"
    }
}

Write-Host "[9/9] Waiting for the system to become ready..." -ForegroundColor Yellow
$ready = $false
for ($attempt = 0; $attempt -lt 90; $attempt++) {
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health/ready" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop | Out-Null
        $ready = $true
        break
    } catch { Start-Sleep -Seconds 2 }
}

# ---------------------------------------------------------------------------
# Health summary
# ---------------------------------------------------------------------------
function Get-Health([string]$Name) {
    $state = Invoke-Docker @("inspect", "-f", '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', $Name)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($state)) { return "missing" }
    return $state.Trim()
}
function Friendly([string]$s) {
    switch ($s) {
        "healthy" { "Healthy" } "running" { "Healthy" } "starting" { "Starting" } default { "Problem" }
    }
}

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Green
if ($ready) {
    Write-Host "  ABUD Shorts Engine $ReleaseVersion is installed and running" -ForegroundColor Green
} else {
    Write-Host "  ABUD Shorts Engine $ReleaseVersion is installed" -ForegroundColor Green
}
Write-Host "=================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  ABUD Shorts:   $(if ($ready) { 'Healthy' } else { 'Still starting' })"
Write-Host "  Application:   $(Friendly (Get-Health "$ComposeProject-app"))"
Write-Host "  Video Engine:  $(Friendly (Get-Health "$ComposeProject-render-worker"))"
Write-Host "  Database:      $(Friendly (Get-Health "$ComposeProject-postgres"))"
Write-Host "  Automation:    $(Friendly (Get-Health "$ComposeProject-n8n"))"
Write-Host "  URL:           $PublicUrl"
Write-Host ""
Write-Host "  Next step - open this address and create your administrator account:" -ForegroundColor Yellow
Write-Host "      $PublicUrl/setup" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Day-to-day, use the Start Menu shortcuts under 'ABUD Shorts':"
Write-Host "      ABUD Shorts - Status, Update, Backup, Diagnostics"
Write-Host ""
if (-not $ready) {
    Write-Host "  The system is taking longer than usual to start. Check it with the Status shortcut." -ForegroundColor Yellow
    Write-Host ""
}

# Leave the customer at the Setup Wizard rather than a terminal window - this is
# the one moment a double-click installer has to hand off to a browser tab.
if ($ready -and -not $NoBrowser) {
    try { Start-Process "$PublicUrl/setup" | Out-Null } catch { }
}
