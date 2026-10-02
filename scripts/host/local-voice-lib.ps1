# ==============================================================================
# Short Studio Server - Local Voice (VoiceTut / KemeTone) lifecycle library
# ==============================================================================
# One canonical implementation of the host-native Local Voice lifecycle, dot-
# sourced by both entry points so there is a single place that knows how to
# detect hardware, install the Python runtime, install a model, and run the
# service - install.ps1 (first-run setup) and scripts\host\short-studio.ps1
# (the `local-voice` command family: install/start/stop/restart/status/repair/
# uninstall).
#
# Every function takes its paths as parameters instead of reading globals,
# because the two callers use differently-scoped variables with the same
# names. Callers must define Write-TextFile (UTF-8, no BOM) before dot-
# sourcing this file - both entry points already do, for the same reason
# every other file in this product writes config through it: Windows
# PowerShell's own UTF-8 encoders emit a BOM that breaks JSON.parse and
# docker's .env parsing.
#
# VoiceTut is the accepted, human-reviewed local high-quality Egyptian Arabic
# route (see ABUD_SHORTS_ENGINE_STATUS.md Pass 9.7-9.9); KemeTone is the
# lightweight CPU fallback. Neither is a new model choice - this file only
# productizes the lifecycle around the already-accepted pair. ElevenLabs is
# never started, installed or called from here.
# ==============================================================================

$script:LocalVoicePinned = [ordered]@{
    PythonVersion      = "3.11"
    TorchVersion       = "2.5.1+cu121"
    TorchaudioVersion  = "2.5.1+cu121"
    VoicetutTtsVersion = "0.1.1"
    OmniVoiceSource    = "git+https://github.com/k2-fsa/OmniVoice.git"
    TorchIndexUrl      = "https://download.pytorch.org/whl/cu121"
}

$script:LocalVoiceHighQualityMinVramMb = 4096
$script:LocalVoiceHighQualityMinDiskGb = 10
$script:LocalVoiceLightweightMinDiskGb = 2
$script:LocalVoiceTaskName = "Short Studio - Local Voice"
# The scheduled task / Startup shortcut name used by every ABUD Shorts Engine
# 2.4 installation. Detection and cleanup below always check both names, so an
# upgraded install's existing registration is found (instead of reporting
# "not registered" next to one that is, in fact, already running) and never
# duplicated under the new name.
$script:LegacyLocalVoiceTaskName = "ABUD Shorts - Local Voice"

<#
Runs a native executable (py, python, pip, nvidia-smi, schtasks...) and
returns its stdout+stderr, with $LASTEXITCODE set to its real exit code.

Both install.ps1 and short-studio.ps1 set $ErrorActionPreference = "Stop"
before dot-sourcing this file. Under that preference, Windows PowerShell
wraps ANY text a native executable writes to stderr in an ErrorRecord and
throws - the `py` launcher's own "no matching runtime" message, or pip's
progress output, would otherwise abort the whole Local Voice setup as an
uncaught exception instead of the caller seeing a normal non-zero exit code.
This is the exact issue install.ps1's own Invoke-Docker already works around;
every native call in this file goes through here for the same reason.
#>
function Invoke-LocalVoiceNative {
    param(
        [Parameter(Mandatory = $true, Position = 0)][string]$Path,
        [Parameter(Position = 1)][string[]]$ArgumentList = @()
    )
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $Path @ArgumentList 2>&1 | ForEach-Object { "$_" }
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

# ---------------------------------------------------------------------------
# Hardware detection
# ---------------------------------------------------------------------------
<#
Truthful, best-effort hardware read. Never throws - a detection failure must
degrade to "unknown" (which Resolve-LocalVoiceMode treats conservatively),
never abort the installer that called it.
#>
function Get-LocalVoiceHardwareProfile {
    $cpuCount = [Environment]::ProcessorCount
    $ramTotalMb = $null
    try {
        $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
        $ramTotalMb = [math]::Round($cs.TotalPhysicalMemory / 1MB)
    }
    catch { }

    $gpuName = $null
    $cudaCapable = $false
    try {
        $gpus = Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop
        $nvidia = $gpus | Where-Object { $_.Name -match "NVIDIA" } | Select-Object -First 1
        if ($nvidia) { $gpuName = $nvidia.Name; $cudaCapable = $true }
    }
    catch { }

    $vramMb = $null
    $driverVersion = $null
    $nvidiaSmiPath = $null
    $cmd = Get-Command "nvidia-smi.exe" -ErrorAction SilentlyContinue
    if ($cmd) { $nvidiaSmiPath = $cmd.Source }
    elseif (Test-Path (Join-Path $env:SystemRoot "System32\nvidia-smi.exe")) {
        $nvidiaSmiPath = Join-Path $env:SystemRoot "System32\nvidia-smi.exe"
    }
    if ($nvidiaSmiPath -and $cudaCapable) {
        try {
            $csv = Invoke-LocalVoiceNative $nvidiaSmiPath @("--query-gpu=memory.total,driver_version", "--format=csv,noheader,nounits")
            if ($LASTEXITCODE -eq 0 -and $csv) {
                $first = @($csv)[0]
                $parts = $first -split ","
                if ($parts.Count -ge 2) {
                    $vramMb = [int]($parts[0].Trim())
                    $driverVersion = $parts[1].Trim()
                }
            }
        }
        catch { }
    }

    return [ordered]@{
        osVersion      = [System.Environment]::OSVersion.VersionString
        cpuCount       = $cpuCount
        ramTotalMb     = $ramTotalMb
        gpuName        = $gpuName
        cudaCapable    = $cudaCapable
        vramMb         = $vramMb
        driverVersion  = $driverVersion
        nvidiaSmiFound = [bool]$nvidiaSmiPath
    }
}

function Get-LocalVoiceDiskFreeGb {
    param([Parameter(Mandatory = $true)][string]$Path)
    try {
        $qualifier = (Split-Path -Qualifier $Path -ErrorAction Stop).TrimEnd(":")
        $drive = Get-PSDrive -Name $qualifier -ErrorAction Stop
        return [math]::Round($drive.Free / 1GB, 1)
    }
    catch {
        return 0
    }
}

<#
AUTO decision. Never recommends HIGH_QUALITY on unverified VRAM - a GPU whose
memory could not be read is treated the same as no GPU, because overstating
compatibility here means promising a multi-gigabyte download that then fails
partway through.
#>
function Resolve-LocalVoiceMode {
    param(
        [ValidateSet("AUTO", "HIGH_QUALITY", "LIGHTWEIGHT", "SKIP")]
        [string]$Requested = "AUTO",
        [Parameter(Mandatory = $true)]$Hardware,
        [Parameter(Mandatory = $true)][double]$DiskFreeGb
    )
    if ($Requested -eq "SKIP") {
        return [ordered]@{ mode = "SKIP"; reason = "Local Voice setup was explicitly skipped." }
    }
    if ($Requested -eq "HIGH_QUALITY" -or $Requested -eq "LIGHTWEIGHT") {
        return [ordered]@{ mode = $Requested; reason = "Explicitly requested." }
    }

    $vramVerifiedOk = ($null -ne $Hardware.vramMb) -and ($Hardware.vramMb -ge $script:LocalVoiceHighQualityMinVramMb)
    if ($Hardware.cudaCapable -and $vramVerifiedOk -and $DiskFreeGb -ge $script:LocalVoiceHighQualityMinDiskGb) {
        return [ordered]@{ mode = "HIGH_QUALITY"; reason = "Compatible NVIDIA GPU detected ($($Hardware.gpuName), $($Hardware.vramMb) MB VRAM)." }
    }
    if ($DiskFreeGb -ge $script:LocalVoiceLightweightMinDiskGb) {
        $why = if (-not $Hardware.cudaCapable) { "No NVIDIA GPU detected." }
        elseif (-not $vramVerifiedOk) { "GPU VRAM could not be verified." }
        else { "Not enough free disk space for the high-quality model." }
        return [ordered]@{ mode = "LIGHTWEIGHT"; reason = "$why Lightweight local voice is supported instead." }
    }
    return [ordered]@{ mode = "SKIP"; reason = "Not enough free disk space for any local voice option ($DiskFreeGb GB free)." }
}

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
<#
Runtime (venv) and model cache both live under shared\, never under a
versioned release directory, so an update - which replaces the release
directory - never touches either. This is the same invariant install.ps1
already applies to data\, config\ and backups\.
#>
function Get-LocalVoicePaths {
    param(
        [Parameter(Mandatory = $true)][string]$AbudShared,
        [Parameter(Mandatory = $true)][string]$AbudDataDir,
        [int]$Port = 8765
    )
    $runtimeDir = Join-Path $AbudShared "runtime\local-tts"
    return [ordered]@{
        RuntimeDir    = $runtimeDir
        VenvDir       = Join-Path $runtimeDir "venv"
        ManifestFile  = Join-Path $runtimeDir "runtime-manifest.json"
        ModelCacheDir = Join-Path $AbudDataDir "models"
        LogFile       = Join-Path $AbudShared "logs\local-tts.log"
        PidFile       = Join-Path $AbudShared "state\local-tts.pid"
        Port          = $Port
    }
}

# ---------------------------------------------------------------------------
# Port selection
# ---------------------------------------------------------------------------
<#
True only when the process listening on $Port is THIS installation's Local
Voice service. A Short Studio Local Voice health response proves "some Local
Voice is alive on this port"; it does NOT prove which installation it belongs
to - every install serves the same /health shape. The only durable ownership
marker is the listener process itself: a Local Voice service is always its
own installation's venv python (shared\runtime\local-tts\venv\Scripts\
python*.exe), so the executable path is checked against this install's
runtime directory. Anything else answering - even a perfectly healthy Local
Voice belonging to a *different* install root - is foreign and the port must
be treated as taken, never adopted.

This is the check that keeps a second installation from silently binding its
.env to the first installation's service (observed on the 2.6 fresh-install
run: the fresh install recorded LOCAL_TTS_PORT=8765 - the primary install's
port - because the running primary service answered /health).
#>
<#
Decides whether a python process belongs to this install's Local Voice runtime.
The naive check (executable lives under RuntimeDir) fails for redirector-style
CPython builds (python-build-standalone / uv): venv\Scripts\python.exe is only
a launcher - it delegates to the real interpreter in its own "home" directory,
so the process actually owning the listening socket sits outside RuntimeDir.
The venv records that directory in venv\pyvenv.cfg's "home" key, so accept both
roots. Anything else is still treated as a foreign listener.
#>
function Test-LocalVoiceOwnedProcess {
    param(
        [Parameter(Mandatory = $true)]$Process,
        [Parameter(Mandatory = $true)][string]$RuntimeDir
    )
    $exe = [string]$Process.ExecutablePath
    if (-not $exe) { return $false }
    $roots = @([System.IO.Path]::GetFullPath($RuntimeDir).TrimEnd('\'))
    $cfg = Join-Path $RuntimeDir 'venv\pyvenv.cfg'
    if (Test-Path $cfg) {
        $homeLine = Get-Content $cfg -ErrorAction SilentlyContinue |
        Where-Object { $_ -match '^\s*home\s*=' } | Select-Object -First 1
        if ($homeLine) {
            $homeDir = ($homeLine -replace '^\s*home\s*=\s*', '').Trim().TrimEnd('\')
            if ($homeDir) { $roots += $homeDir }
        }
    }
    foreach ($root in $roots) {
        if ($exe.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return $false
}

function Test-LocalVoiceOwnedByInstall {
    param(
        [int]$Port,
        [Parameter(Mandatory = $true)][string]$RuntimeDir
    )
    try {
        $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
        Where-Object { $_.OwningProcess -gt 0 } |
        Select-Object -First 1
        if (-not $listener) { return $false }
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction Stop
        if ($process.Name -notmatch '^pythonw?\.exe$') { return $false }
        return (Test-LocalVoiceOwnedProcess -Process $process -RuntimeDir $RuntimeDir)
    }
    catch {
        return $false
    }
}

<#
Ports durably claimed by OTHER Short Studio installations. A port can belong
to another install even while its Local Voice service is stopped - the claim
lives in that install's shared\config\.env, not in a live listener. Skipping
only live ports would let a fresh install steal a port the primary install
still owns on paper, and whichever service started second would silently
serve both installs.

Sibling roots are found three ways so no shape of install is missed:
  1. the two convention roots (%ProgramData%\ShortStudio, %ProgramData%\AbudShorts),
  2. Inno uninstall registry InstallLocation entries for Short Studio,
  3. any %ProgramData% directory carrying the Short Studio install markers
     (shared\config\.env + current.txt) - covers install.ps1-only roots that
     never registered an uninstall entry.
Our own root is always excluded: re-running setup on the same install must
keep its existing port.
#>
function Get-LocalVoiceSiblingInstallRoots {
    param([Parameter(Mandatory = $true)][string]$AbudShared)
    $myRoot = [System.IO.Path]::GetFullPath((Split-Path $AbudShared -Parent)).TrimEnd('\')
    $candidates = @(
        (Join-Path $env:ProgramData "ShortStudio"),
        (Join-Path $env:ProgramData "AbudShorts")
    )
    foreach ($hive in @(
            "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
            "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall")) {
        Get-ChildItem $hive -ErrorAction SilentlyContinue | ForEach-Object {
            $loc = $_.GetValue("InstallLocation")
            $name = [string]$_.GetValue("DisplayName")
            if ($loc -and $name -match "Short Studio|ABUD Shorts") { $candidates += [string]$loc }
        }
    }
    Get-ChildItem $env:ProgramData -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        if ((Test-Path (Join-Path $_.FullName "shared\config\.env")) -and
            (Test-Path (Join-Path $_.FullName "current.txt"))) {
            $candidates += $_.FullName
        }
    }
    return @($candidates | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\') } |
        Where-Object { $_ -ine $myRoot } | Select-Object -Unique)
}

<#
Reads each sibling install root's shared\config\.env for its claimed
LOCAL_TTS_PORT. -InstallRoots is injectable so the claim/exclusion logic is
testable without this machine's real installations; omitted, it discovers
real siblings via Get-LocalVoiceSiblingInstallRoots.
#>
function Get-SiblingLocalVoiceReservedPorts {
    param(
        [Parameter(Mandatory = $true)][string]$AbudShared,
        [string[]]$InstallRoots
    )
    $roots = if ($null -ne $InstallRoots) { $InstallRoots } else { Get-LocalVoiceSiblingInstallRoots -AbudShared $AbudShared }
    $myRoot = [System.IO.Path]::GetFullPath((Split-Path $AbudShared -Parent)).TrimEnd('\')
    $ports = @()
    foreach ($root in $roots) {
        if (-not $root) { continue }
        $resolved = $root.TrimEnd('\')
        if ($resolved -ieq $myRoot) { continue }
        $envFile = Join-Path $resolved "shared\config\.env"
        if (-not (Test-Path $envFile)) { continue }
        $line = Get-Content $envFile -ErrorAction SilentlyContinue |
        Where-Object { $_ -match '^LOCAL_TTS_PORT=' } | Select-Object -Last 1
        if ($line) {
            $p = 0
            if ([int]::TryParse($line.Substring("LOCAL_TTS_PORT=".Length).Trim(), [ref]$p) -and $p -gt 0) {
                $ports += $p
            }
        }
    }
    return @($ports | Select-Object -Unique)
}

function Resolve-LocalVoicePort {
    param(
        [int]$PreferredPort = 8765,
        [int]$MaxAttempts = 10,
        # This installation's shared\runtime\local-tts directory. When set, a
        # busy port is only reusable if the listening service's python.exe
        # lives under it - i.e. the service is literally ours.
        [string]$OwnedRuntimeDir = "",
        # Ports other installations have already claimed in their .env. Never
        # handed out to this install even when nothing is listening right now.
        [int[]]$ReservedPorts = @()
    )
    for ($i = 0; $i -lt $MaxAttempts; $i++) {
        $candidate = $PreferredPort + $i
        if ($OwnedRuntimeDir -and (Test-LocalVoiceOwnedByInstall -Port $candidate -RuntimeDir $OwnedRuntimeDir)) {
            return $candidate
        }
        if ($ReservedPorts -contains $candidate) { continue }
        $busy = $true
        try {
            $probe = New-Object System.Net.Sockets.TcpClient
            $probe.Connect("127.0.0.1", $candidate)
            $probe.Close()
        }
        catch {
            $busy = $false
        }
        if (-not $busy) { return $candidate }
        # A busy port that answers like a Local Voice but is NOT this install's
        # own service belongs to another installation - keep scanning instead
        # of adopting it (the previous behavior that caused cross-install
        # borrowing). Non-Local-Voice listeners are likewise skipped.
    }
    throw "Could not find a free port for Local Voice starting at $PreferredPort."
}

# ---------------------------------------------------------------------------
# Runtime (Python venv) install / repair
# ---------------------------------------------------------------------------
function Test-LocalVoiceRuntimeReady {
    param([Parameter(Mandatory = $true)]$Paths)
    $python = Join-Path $Paths.VenvDir "Scripts\python.exe"
    if (-not (Test-Path $python)) { return $false }
    $probe = Invoke-LocalVoiceNative $python @("-c", "import torch, voicetut_tts; print(torch.__version__)")
    if ($LASTEXITCODE -ne 0 -or -not $probe) { return $false }
    $version = (@($probe)[-1]).Trim()
    return (Test-LocalVoiceTorchVersionMatch $version)
}

<#
Decides whether an installed torch.__version__ satisfies the pinned runtime.
The pin fixes the base version ("2.5.1"); the local-version suffix ("+cu121",
"+cpu") only describes which wheel flavor was installed - and PyPI's Windows
CPU wheels report "2.5.1+cpu", so the CPU fallback would never pass a check
that only accepted "2.5.1" or "2.5.1+cu121" verbatim.
#>
function Test-LocalVoiceTorchVersionMatch {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Version)
    if ([string]::IsNullOrWhiteSpace($Version)) { return $false }
    $baseVersion = ($script:LocalVoicePinned.TorchVersion -replace '\+.*$', '')
    $installedBase = ($Version.Trim() -replace '\+.*$', '')
    return ($installedBase -eq $baseVersion)
}

<#
Finds a real Python 3.11 interpreter, not just an official python.org one.

`py -3.11` only ever matches a `PythonCore`-registered install (the
python.org installer). It silently ignores anything registered under a
different Company - which is exactly what common alternatives use: `uv`
registers as `Astral`, some `pyenv-win`/Conda setups use their own tags too.
`py -0p` lists every registered interpreter regardless of company, so this
parses that list for a 3.11.x entry instead of assuming python.org is the
only way 3.11 got onto the machine. Falls back to `py -3.11` for the common
case, since `py -0p`'s exact column layout is not a documented contract.
#>
function Find-LocalVoicePython311 {
    $direct = Get-Command "py" -ErrorAction SilentlyContinue
    if ($direct) {
        $resolved = Invoke-LocalVoiceNative "py" @("-3.11", "-c", "import sys; print(sys.executable)")
        if ($LASTEXITCODE -eq 0 -and $resolved) { return (@($resolved)[-1]).Trim() }

        $listing = Invoke-LocalVoiceNative "py" @("-0p")
        if ($LASTEXITCODE -eq 0 -and $listing) {
            foreach ($line in $listing) {
                if ($line -match "3\.11" -and $line -match "(\S:\\[^\s]+python\.exe)") {
                    $candidate = $Matches[1]
                    if (Test-Path $candidate) { return $candidate }
                }
            }
        }
    }

    foreach ($name in @("python3.11", "python3.11.exe")) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
    }
    return $null
}

function Write-LocalVoiceRuntimeManifest {
    param([Parameter(Mandatory = $true)]$Paths, [Parameter(Mandatory = $true)][string]$Source)
    $manifest = [ordered]@{
        pythonVersion      = $script:LocalVoicePinned.PythonVersion
        torchVersion       = $script:LocalVoicePinned.TorchVersion
        voicetutTtsVersion = $script:LocalVoicePinned.VoicetutTtsVersion
        source             = $Source
        installedAt        = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }
    Write-TextFile $Paths.ManifestFile ($manifest | ConvertTo-Json -Depth 4)
}

<#
Idempotent. Three paths, in order:
  1. Already ready (correct pinned versions importable) -> no-op.
  2. A verified developer venv ships next to the source in this same package
     (services\local-tts\.venv) -> copied into the product-owned location
     instead of re-downloading the multi-gigabyte CUDA wheels.
  3. Neither exists -> a real fresh install, pinned exactly as accepted in
     Pass 9.8.
#>
function Install-LocalVoiceRuntime {
    param(
        [Parameter(Mandatory = $true)]$Paths,
        [Parameter(Mandatory = $true)][string]$AppSourceDir,
        [switch]$Force
    )
    if (-not $Force -and (Test-LocalVoiceRuntimeReady -Paths $Paths)) {
        return [ordered]@{ status = "already_ready"; reused = $true }
    }

    $legacyVenv = Join-Path $AppSourceDir ".venv"
    $legacyPython = Join-Path $legacyVenv "Scripts\python.exe"
    if (Test-Path $legacyPython) {
        $legacyProbe = Invoke-LocalVoiceNative $legacyPython @("-c", "import torch, voicetut_tts; print(torch.__version__)")
        if ($LASTEXITCODE -eq 0 -and $legacyProbe -and (@($legacyProbe)[-1]).Trim() -eq $script:LocalVoicePinned.TorchVersion) {
            New-Item -ItemType Directory -Path $Paths.RuntimeDir -Force | Out-Null
            if (Test-Path $Paths.VenvDir) { Remove-Item $Paths.VenvDir -Recurse -Force }
            Copy-Item $legacyVenv $Paths.VenvDir -Recurse -Force
            Write-LocalVoiceRuntimeManifest -Paths $Paths -Source "reused_verified_dev_runtime"
            return [ordered]@{ status = "reused_existing_runtime"; reused = $true }
        }
    }

    $python311 = Find-LocalVoicePython311
    if (-not $python311) {
        throw "Python 3.11 was not found on this machine. Install it from python.org (or 'winget install Python.Python.3.11') and try again."
    }
    New-Item -ItemType Directory -Path $Paths.RuntimeDir -Force | Out-Null
    if (Test-Path $Paths.VenvDir) { Remove-Item $Paths.VenvDir -Recurse -Force }
    Invoke-LocalVoiceNative $python311 @("-m", "venv", $Paths.VenvDir) | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not create the Local Voice Python 3.11 environment." }

    $python = Join-Path $Paths.VenvDir "Scripts\python.exe"
    # `python -m venv` is supposed to bootstrap pip itself, but some standalone/
    # portable CPython builds (e.g. python-build-standalone, as installed by
    # `uv python install`) silently skip that step - the venv is created (exit
    # 0, real pyvenv.cfg) with no pip module at all. `pip install --upgrade
    # pip` then fails with "No module named pip", and its exit code was never
    # checked here, so that failure was previously invisible until the next
    # step also failed. `ensurepip` is the one operation guaranteed to work
    # against a pip-less venv's own bundled wheels, so run it unconditionally
    # before ever invoking `-m pip`.
    Invoke-LocalVoiceNative $python @("-m", "ensurepip", "--upgrade") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not bootstrap pip inside the Local Voice Python environment." }
    Invoke-LocalVoiceNative $python @("-m", "pip", "install", "--upgrade", "pip", "--quiet") | Out-Null
    Invoke-LocalVoiceNative $python @("-m", "pip", "install", "-r", (Join-Path $AppSourceDir "requirements.txt"), "--quiet") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not install the Local Voice service's base dependencies." }

    # Try CUDA PyTorch first; fall back to CPU PyTorch if the CUDA wheels
    # cannot be installed (no compatible GPU, network issue, or the
    # multi-gigabyte download times out). VoiceTut works on CPU - slower
    # inference, but the service is fully functional and the model loads
    # the same way. The runtime manifest records which variant was installed
    # so the health endpoint reports truthfully.
    $cudaInstalled = $false
    try {
        Invoke-LocalVoiceNative $python @("-m", "pip", "install", "torch==$($script:LocalVoicePinned.TorchVersion)", "torchaudio==$($script:LocalVoicePinned.TorchaudioVersion)", "--index-url", $script:LocalVoicePinned.TorchIndexUrl, "--quiet") | Out-Null
        if ($LASTEXITCODE -eq 0) { $cudaInstalled = $true }
    }
    catch { }

    if (-not $cudaInstalled) {
        Write-Host "      CUDA PyTorch install failed; falling back to CPU PyTorch..." -ForegroundColor Yellow
        $cpuTorchVersion = ($script:LocalVoicePinned.TorchVersion -replace '\+cu121', '')
        Invoke-LocalVoiceNative $python @("-m", "pip", "install", "torch==$cpuTorchVersion", "torchaudio==$cpuTorchVersion", "--quiet") | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not install PyTorch (tried both CUDA and CPU variants)." }
    }

    Invoke-LocalVoiceNative $python @("-m", "pip", "install", $script:LocalVoicePinned.OmniVoiceSource, "voicetut-tts==$($script:LocalVoicePinned.VoicetutTtsVersion)", "--quiet") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not install VoiceTut-TTS $($script:LocalVoicePinned.VoicetutTtsVersion)." }

    if (-not (Test-LocalVoiceRuntimeReady -Paths $Paths)) {
        throw "The Local Voice runtime installed but does not report the expected pinned versions."
    }
    Write-LocalVoiceRuntimeManifest -Paths $Paths -Source $(if ($cudaInstalled) { "fresh_install_cuda" } else { "fresh_install_cpu" })
    return [ordered]@{ status = "installed"; reused = $false; cuda = $cudaInstalled }
}

# ---------------------------------------------------------------------------
# Model install (delegates to the canonical downloader - not duplicated here)
# ---------------------------------------------------------------------------
function Install-LocalVoiceModel {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("voicetut", "kemetone")][string]$ModelId,
        [Parameter(Mandatory = $true)]$Paths,
        [Parameter(Mandatory = $true)][string]$LibRoot
    )
    $installer = Join-Path (Split-Path $LibRoot -Parent) "install-local-voice.ps1"
    if (-not (Test-Path $installer)) { throw "install-local-voice.ps1 is missing from this release." }
    & $installer -ModelId $ModelId -CacheDir $Paths.ModelCacheDir
    return ($LASTEXITCODE -eq 0)
}

# ---------------------------------------------------------------------------
# Host-native service lifecycle
# ---------------------------------------------------------------------------
function Get-LocalVoiceServiceStatus {
    param([Parameter(Mandatory = $true)]$Paths)
    $result = [ordered]@{ running = $false; processId = $null; healthy = $false; modelsReady = @() }
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($Paths.Port)/health" -TimeoutSec 3 -ErrorAction Stop
        $result.healthy = [bool]$health.ok
        if ($health.models_ready) { $result.modelsReady = @($health.models_ready) }
    }
    catch { }
    try {
        $listener = Get-NetTCPConnection -State Listen -LocalPort $Paths.Port -ErrorAction Stop |
        Where-Object { $_.OwningProcess -gt 0 } |
        Select-Object -First 1
        if ($listener) {
            $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction Stop
            $expectedPort = "--port $($Paths.Port)"
            # The listener must also run out of THIS install's runtime
            # (or the venv's recorded base interpreter - redirector-style
            # CPython builds delegate there). A different install's Local
            # Voice serves the same uvicorn/app shape on its own port -
            # treating it as ours would let start/stop/restart adopt or
            # kill a foreign service.
            $ownedExe = Test-LocalVoiceOwnedProcess -Process $process -RuntimeDir $Paths.RuntimeDir
            if ($process.Name -match '^pythonw?\.exe$' -and
                $ownedExe -and
                $process.CommandLine -match '(^|\s)-m\s+uvicorn(\s|$)' -and
                $process.CommandLine -match 'app\.main:app' -and
                $process.CommandLine.Contains($expectedPort)) {
                $result.running = $true
                $result.processId = [int]$listener.OwningProcess
            }
        }
    }
    catch { }
    return $result
}

function Start-LocalVoiceService {
    param(
        [Parameter(Mandatory = $true)]$Paths,
        [Parameter(Mandatory = $true)][string]$AppSourceDir,
        [string]$InternalServiceToken = ""
    )
    $status = Get-LocalVoiceServiceStatus -Paths $Paths
    if ($status.healthy -and $status.running) {
        Set-Content -Path $Paths.PidFile -Value "$($status.processId)" -Encoding ascii -NoNewline
        return [ordered]@{ started = $false; alreadyRunning = $true; ready = $true; processId = $status.processId }
    }

    # The configured port can be live yet belong to a DIFFERENT installation
    # (Get-LocalVoiceServiceStatus above deliberately does not claim it). A
    # blind uvicorn spawn would just fail EADDRINUSE after a long wait and the
    # app would then silently work against the other install's service.
    # Fail fast and say whose port it is.
    if (Test-LocalVoiceOwnedByInstall -Port $Paths.Port -RuntimeDir $Paths.RuntimeDir) {
        # Ours but unhealthy/not-yet-ready - fall through to a normal start.
    }
    else {
        $foreign = $false
        try {
            $probe = New-Object System.Net.Sockets.TcpClient
            $probe.Connect("127.0.0.1", $Paths.Port)
            $probe.Close()
            $foreign = $true
        }
        catch { }
        if ($foreign) {
            throw "Port $($Paths.Port) is already in use by a service that does not belong to this installation (another Short Studio install's Local Voice, or an unrelated app). Re-resolve the port with 'local-voice repair', which never adopts a port another installation owns."
        }
    }

    $python = Join-Path $Paths.VenvDir "Scripts\python.exe"
    if (-not (Test-Path $python)) { $python = Join-Path $Paths.VenvDir "Scripts\pythonw.exe" }
    if (-not (Test-Path $python)) { throw "The Local Voice runtime is not installed." }

    New-Item -ItemType Directory -Path (Split-Path $Paths.LogFile) -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path $Paths.PidFile) -Force | Out-Null

    # Bounded logs: a long-running host service must never grow without limit.
    if ((Test-Path $Paths.LogFile) -and (Get-Item $Paths.LogFile).Length -gt 20MB) {
        Move-Item $Paths.LogFile "$($Paths.LogFile).old" -Force
    }

    $previousPort = $env:PORT
    $previousCache = $env:ABUD_MODEL_CACHE_DIR
    $previousToken = $env:INTERNAL_SERVICE_TOKEN
    $env:PORT = "$($Paths.Port)"
    $env:ABUD_MODEL_CACHE_DIR = $Paths.ModelCacheDir
    $env:INTERNAL_SERVICE_TOKEN = $InternalServiceToken
    try {
        $proc = Start-Process -FilePath $python `
            -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "$($Paths.Port)") `
            -WorkingDirectory $AppSourceDir `
            -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $Paths.LogFile `
            -RedirectStandardError "$($Paths.LogFile).err"
    }
    finally {
        $env:PORT = $previousPort
        $env:ABUD_MODEL_CACHE_DIR = $previousCache
        $env:INTERNAL_SERVICE_TOKEN = $previousToken
    }
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        try { Invoke-RestMethod -Uri "http://127.0.0.1:$($Paths.Port)/health" -TimeoutSec 3 -ErrorAction Stop | Out-Null; $ready = $true; break }
        catch { Start-Sleep -Seconds 2 }
    }
    $running = Get-LocalVoiceServiceStatus -Paths $Paths
    if ($ready -and $running.running -and $running.processId) {
        # venv launchers can delegate to the base interpreter. Persist the PID
        # that actually owns the listening socket, never the short-lived
        # launcher PID (which Windows may later reuse for an unrelated app).
        Set-Content -Path $Paths.PidFile -Value "$($running.processId)" -Encoding ascii -NoNewline
    }
    return [ordered]@{
        started           = $true
        alreadyRunning    = $false
        ready             = ($ready -and $running.running)
        processId         = $running.processId
        launcherProcessId = $proc.Id
    }
}

function Stop-LocalVoiceService {
    param([Parameter(Mandatory = $true)]$Paths)
    $status = Get-LocalVoiceServiceStatus -Paths $Paths
    if ($status.running -and $status.processId) {
        # Status proved this PID owns the Local Voice listener and runs the
        # expected uvicorn command. Never kill an unrelated PID from a stale
        # file after Windows reuses that number.
        Stop-Process -Id ([int]$status.processId) -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $Paths.PidFile -Force -ErrorAction SilentlyContinue
    return [ordered]@{ stopped = $true }
}

function Restart-LocalVoiceService {
    param(
        [Parameter(Mandatory = $true)]$Paths,
        [Parameter(Mandatory = $true)][string]$AppSourceDir,
        [string]$InternalServiceToken = ""
    )
    Stop-LocalVoiceService -Paths $Paths | Out-Null
    Start-Sleep -Seconds 1
    return Start-LocalVoiceService -Paths $Paths -AppSourceDir $AppSourceDir -InternalServiceToken $InternalServiceToken
}

# ---------------------------------------------------------------------------
# Windows auto-start (per-user, no admin, no stored password)
# ---------------------------------------------------------------------------
<#
Both the scheduled task and the Startup-folder fallback point at ONE fixed
path under shared\ instead of a specific release directory. A release
directory can be replaced or pruned on the next update; shared\ never is.
This file itself re-reads current.txt every time Windows runs it, so
whichever mechanism actually got registered keeps starting whichever
release is current - including after an update - without ever needing to
be re-registered.
#>
function Get-LocalVoiceAutoStartLauncherPath {
    param([Parameter(Mandatory = $true)][string]$AbudShared)
    return Join-Path $AbudShared "bin\start-local-voice.ps1"
}

<#
Embeds the exact install root this was registered for (usually the default
%ProgramData%\AbudShorts, but a custom -InstallRoot is a real, supported
override) as a literal, rather than re-deriving the default at run time -
otherwise a non-default install's autostart would silently resolve against
the wrong (or a nonexistent) default location.
#>
function Install-LocalVoiceAutoStartLauncher {
    param([Parameter(Mandatory = $true)][string]$AbudShared)
    $launcherPath = Get-LocalVoiceAutoStartLauncherPath -AbudShared $AbudShared
    $abudHome = Split-Path $AbudShared -Parent
    $escapedHome = $abudHome.Replace("'", "''")
    $content = @"
# Short Studio Server - stable Local Voice autostart launcher.
# Regenerated on every install/repair - do not edit by hand. Re-resolves
# current.txt on every run so it always starts whichever release is
# actually current, never a specific (and eventually obsolete) one.
`$ErrorActionPreference = "SilentlyContinue"
`$abudHome = '$escapedHome'
`$currentFile = Join-Path `$abudHome "current.txt"
if (-not (Test-Path `$currentFile)) { exit 0 }
`$releaseDir = (Get-Content `$currentFile -Raw).Trim()
`$cli = Join-Path `$releaseDir "scripts\host\short-studio.ps1"
if (-not (Test-Path `$cli)) { exit 0 }
`$env:ABUD_HOME = `$abudHome
& `$cli local-voice start
"@
    Write-TextFile $launcherPath $content
    return $launcherPath
}

<#
Scheduled-task and Startup-shortcut names are machine-global, unlike every
other Local Voice path which is scoped under the install's own shared\.
Two installations sharing one name means the second register silently
overwrites the first install's autostart (schtasks /create /f replaces the
task and points it at the second install's launcher), and either install's
unregister removes the other's. The name is therefore derived from the
install root: the two convention roots keep the bare historical name so
existing registrations stay continuous, and any other install root gets a
stable hash suffix so installs never collide.
#>
function Get-LocalVoiceInstallKey {
    param([Parameter(Mandatory = $true)][string]$AbudShared)
    $normalized = [System.IO.Path]::GetFullPath($AbudShared).TrimEnd('\').ToUpperInvariant()
    $defaults = @(
        ([System.IO.Path]::GetFullPath((Join-Path $env:ProgramData "ShortStudio\shared"))).TrimEnd('\').ToUpperInvariant(),
        ([System.IO.Path]::GetFullPath((Join-Path $env:ProgramData "AbudShorts\shared"))).TrimEnd('\').ToUpperInvariant()
    )
    if ($defaults -contains $normalized) { return "" }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($normalized))
    }
    finally { $sha.Dispose() }
    return "-" + (($hash[0..3] | ForEach-Object { $_.ToString("x2") }) -join "")
}

function Get-LocalVoiceTaskNameFor {
    param([string]$AbudShared = "")
    if (-not $AbudShared) { return $script:LocalVoiceTaskName }
    $key = Get-LocalVoiceInstallKey -AbudShared $AbudShared
    if (-not $key) { return $script:LocalVoiceTaskName }
    return "$($script:LocalVoiceTaskName) ($($key.TrimStart('-')))"
}

function Get-LocalVoiceStartupShortcutPath {
    param([string]$Name = $script:LocalVoiceTaskName)
    $startupDir = [System.Environment]::GetFolderPath("Startup")
    return Join-Path $startupDir "$Name.lnk"
}

function Register-LocalVoiceStartupFolderFallback {
    param(
        [Parameter(Mandatory = $true)][string]$LauncherPath,
        [string]$Name = $script:LocalVoiceTaskName
    )
    try {
        $shortcutPath = Get-LocalVoiceStartupShortcutPath -Name $Name
        $startupDir = Split-Path $shortcutPath -Parent
        if ($startupDir -and -not (Test-Path $startupDir)) {
            New-Item -ItemType Directory -Path $startupDir -Force | Out-Null
        }
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = "powershell.exe"
        $shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$LauncherPath`""
        $shortcut.WorkingDirectory = Split-Path $LauncherPath -Parent
        $shortcut.Description = "Starts Short Studio Local Voice at login"
        $shortcut.Save()
        return (Test-Path $shortcutPath)
    }
    catch {
        return $false
    }
}

function Unregister-LocalVoiceStartupFolderFallback {
    param([string[]]$Names = @($script:LocalVoiceTaskName, $script:LegacyLocalVoiceTaskName))
    foreach ($name in $Names) {
        $shortcutPath = Get-LocalVoiceStartupShortcutPath -Name $name
        if (Test-Path $shortcutPath) { Remove-Item $shortcutPath -Force -ErrorAction SilentlyContinue }
    }
    return $true
}

<#
Tries the primary mechanism (a per-user "at logon" scheduled task, no admin,
no stored password) first; if Task Scheduler itself denies task creation for
this account - a real, observed failure mode on some Windows accounts even
though the Task Scheduler service is running normally - falls back to a
Startup-folder shortcut, which needs no Task Scheduler access at all. Never
claims success it did not actually verify.
#>
function Register-LocalVoiceAutoStart {
    param([Parameter(Mandatory = $true)][string]$AbudShared)
    $launcherPath = Install-LocalVoiceAutoStartLauncher -AbudShared $AbudShared
    $action = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcherPath`""

    $taskName = Get-LocalVoiceTaskNameFor -AbudShared $AbudShared
    $isDefaultRoot = ($taskName -eq $script:LocalVoiceTaskName)
    Invoke-LocalVoiceNative "schtasks" @("/create", "/tn", $taskName, "/tr", "powershell.exe $action", "/sc", "onlogon", "/rl", "limited", "/f") | Out-Null
    if ($LASTEXITCODE -eq 0) {
        # Registering under the install-scoped name never leaves an
        # installation with two competing autostart entries. Only the
        # default-root install cleans up the bare/legacy names - those
        # registrations belong to whichever install owns the primary root,
        # and a secondary install must not touch them.
        if ($isDefaultRoot) {
            Invoke-LocalVoiceNative "schtasks" @("/delete", "/tn", $script:LegacyLocalVoiceTaskName, "/f") | Out-Null
            Unregister-LocalVoiceStartupFolderFallback | Out-Null
        }
        else {
            Unregister-LocalVoiceStartupFolderFallback -Names @($taskName) | Out-Null
        }
        return [ordered]@{ registered = $true; mechanism = "scheduled_task" }
    }

    if (Register-LocalVoiceStartupFolderFallback -LauncherPath $launcherPath -Name $taskName) {
        return [ordered]@{ registered = $true; mechanism = "startup_folder" }
    }

    return [ordered]@{ registered = $false; mechanism = "none" }
}

function Unregister-LocalVoiceAutoStart {
    param([Parameter(Mandatory = $true)][string]$AbudShared)
    $taskName = Get-LocalVoiceTaskNameFor -AbudShared $AbudShared
    $taskNames = if ($taskName -eq $script:LocalVoiceTaskName) {
        @($script:LocalVoiceTaskName, $script:LegacyLocalVoiceTaskName)
    }
    else {
        @($taskName)
    }
    foreach ($name in $taskNames) {
        Invoke-LocalVoiceNative "schtasks" @("/delete", "/tn", $name, "/f") | Out-Null
    }
    Unregister-LocalVoiceStartupFolderFallback -Names $taskNames | Out-Null
    $launcherPath = Get-LocalVoiceAutoStartLauncherPath -AbudShared $AbudShared
    if (Test-Path $launcherPath) { Remove-Item $launcherPath -Force -ErrorAction SilentlyContinue }
    return $true
}

function Test-LocalVoiceAutoStartRegistered {
    param([string]$AbudShared = "")
    $taskName = Get-LocalVoiceTaskNameFor -AbudShared $AbudShared
    $isDefaultRoot = ($taskName -eq $script:LocalVoiceTaskName)
    $checkNames = if ($isDefaultRoot) {
        @($taskName, $script:LegacyLocalVoiceTaskName)
    }
    else {
        @($taskName)
    }
    $scheduledTask = $false
    foreach ($name in $checkNames) {
        # Detects an ABUD Shorts Engine 2.4 install's still-registered legacy
        # task for the default-root install, so this reports "registered"
        # truthfully instead of a false "none" next to Local Voice actually
        # auto-starting. A secondary install is checked only under its own
        # scoped name - another install's registration is never ours.
        Invoke-LocalVoiceNative "schtasks" @("/query", "/tn", $name) | Out-Null
        if ($LASTEXITCODE -eq 0) { $scheduledTask = $true }
    }
    $startupFolder = $false
    foreach ($name in $checkNames) {
        if (Test-Path (Get-LocalVoiceStartupShortcutPath -Name $name)) { $startupFolder = $true }
    }
    $mechanism = if ($scheduledTask) { "scheduled_task" } elseif ($startupFolder) { "startup_folder" } else { "none" }
    return [ordered]@{ scheduledTask = $scheduledTask; startupFolder = $startupFolder; any = ($scheduledTask -or $startupFolder); mechanism = $mechanism }
}

# ---------------------------------------------------------------------------
# Orchestration - the single entry point install.ps1 and short-studio.ps1 both
# call, so the two never duplicate the setup sequence itself.
# ---------------------------------------------------------------------------
function Invoke-LocalVoiceSetup {
    param(
        [ValidateSet("AUTO", "HIGH_QUALITY", "LIGHTWEIGHT", "SKIP")]
        [string]$Mode = "AUTO",
        [Parameter(Mandatory = $true)][string]$AbudShared,
        [Parameter(Mandatory = $true)][string]$AbudDataDir,
        [Parameter(Mandatory = $true)][string]$AppSourceDir,
        [Parameter(Mandatory = $true)][string]$LibRoot,
        [string]$InternalServiceToken = "",
        # The port this install already claims in its .env, when it has one.
        # Repair/re-install must keep the existing claim stable rather than
        # drifting to a new port on every run.
        [int]$PreferredPort = 8765,
        [switch]$Repair
    )

    $result = [ordered]@{
        requestedMode       = $Mode
        resolvedMode        = $null
        resolutionReason    = $null
        hardware            = $null
        diskFreeGb          = $null
        runtimeInstalled    = $false
        runtimeDetail       = $null
        modelId             = $null
        modelInstalled      = $false
        serviceStarted      = $false
        modelReady          = $false
        autoStartRegistered = $false
        autoStartMechanism  = "none"
        port                = $null
        baseUrl             = $null
        error               = $null
    }

    $hardware = Get-LocalVoiceHardwareProfile
    $diskFreeGb = Get-LocalVoiceDiskFreeGb -Path $AbudShared
    $result.hardware = $hardware
    $result.diskFreeGb = $diskFreeGb

    $resolution = Resolve-LocalVoiceMode -Requested $Mode -Hardware $hardware -DiskFreeGb $diskFreeGb
    $result.resolvedMode = $resolution.mode
    $result.resolutionReason = $resolution.reason

    if ($resolution.mode -eq "SKIP") {
        return $result
    }

    try {
        $modelId = if ($resolution.mode -eq "HIGH_QUALITY") { "voicetut" } else { "kemetone" }
        $result.modelId = $modelId
        # Build the per-install paths first (the runtime dir is the ownership
        # marker), collect ports other installs have claimed, then resolve -
        # the port handed out must be free AND not owned or claimed by a
        # different installation.
        $paths = Get-LocalVoicePaths -AbudShared $AbudShared -AbudDataDir $AbudDataDir -Port $PreferredPort
        $reserved = Get-SiblingLocalVoiceReservedPorts -AbudShared $AbudShared
        $port = Resolve-LocalVoicePort -PreferredPort $PreferredPort -OwnedRuntimeDir $paths.RuntimeDir -ReservedPorts $reserved
        $paths.Port = $port
        $result.port = $port
        $result.baseUrl = "http://host.docker.internal:$port"

        $runtimeResult = Install-LocalVoiceRuntime -Paths $paths -AppSourceDir $AppSourceDir -Force:$Repair
        $result.runtimeInstalled = $true
        $result.runtimeDetail = $runtimeResult.status

        $result.modelInstalled = Install-LocalVoiceModel -ModelId $modelId -Paths $paths -LibRoot $LibRoot

        $startResult = Start-LocalVoiceService -Paths $paths -AppSourceDir $AppSourceDir -InternalServiceToken $InternalServiceToken
        $result.serviceStarted = $startResult.ready

        $status = Get-LocalVoiceServiceStatus -Paths $paths
        $result.modelReady = ($status.modelsReady -contains $modelId)

        $autoStart = Register-LocalVoiceAutoStart -AbudShared $AbudShared
        $result.autoStartRegistered = $autoStart.registered
        $result.autoStartMechanism = $autoStart.mechanism
    }
    catch {
        $result.error = $_.Exception.Message
    }
    return $result
}
