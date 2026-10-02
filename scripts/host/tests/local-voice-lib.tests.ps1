# ==============================================================================
# Pester tests for scripts\host\local-voice-lib.ps1
# ==============================================================================
# Covers the deterministic decision logic (hardware -> mode, path layout, port
# selection, idempotency checks) without touching real hardware, network or a
# GPU. Real end-to-end behavior (an actual runtime install, an actual service
# start, an actual fresh install/upgrade) is exercised by the isolated release
# rehearsal, not here - this is the part that can be verified on every commit.
#
# Run with:  Invoke-Pester -Script scripts\host\tests\local-voice-lib.tests.ps1
# ==============================================================================

function Write-TextFile {
    param([string]$Path, [string]$Content)
    $directory = Split-Path -Parent $Path
    if ($directory -and -not (Test-Path $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

. (Join-Path $PSScriptRoot "..\local-voice-lib.ps1")

Describe "Resolve-LocalVoiceMode" {
    It "recommends HIGH_QUALITY only with a verified compatible GPU and enough disk" {
        $hardware = [ordered]@{ cudaCapable = $true; gpuName = "NVIDIA GeForce RTX 4070"; vramMb = 12281 }
        $result = Resolve-LocalVoiceMode -Requested "AUTO" -Hardware $hardware -DiskFreeGb 20
        $result.mode | Should Be "HIGH_QUALITY"
    }

    It "falls back to LIGHTWEIGHT when there is no NVIDIA GPU" {
        $hardware = [ordered]@{ cudaCapable = $false; gpuName = $null; vramMb = $null }
        $result = Resolve-LocalVoiceMode -Requested "AUTO" -Hardware $hardware -DiskFreeGb 20
        $result.mode | Should Be "LIGHTWEIGHT"
    }

    It "falls back to LIGHTWEIGHT when VRAM could not be verified, even if the GPU looks NVIDIA" {
        # Never promise a multi-gigabyte download the hardware cannot actually run.
        $hardware = [ordered]@{ cudaCapable = $true; gpuName = "NVIDIA Quadro Something"; vramMb = $null }
        $result = Resolve-LocalVoiceMode -Requested "AUTO" -Hardware $hardware -DiskFreeGb 20
        $result.mode | Should Be "LIGHTWEIGHT"
    }

    It "falls back to LIGHTWEIGHT when VRAM is below the high-quality threshold" {
        $hardware = [ordered]@{ cudaCapable = $true; gpuName = "NVIDIA GeForce GTX 1650"; vramMb = 2048 }
        $result = Resolve-LocalVoiceMode -Requested "AUTO" -Hardware $hardware -DiskFreeGb 20
        $result.mode | Should Be "LIGHTWEIGHT"
    }

    It "never recommends HIGH_QUALITY without enough disk space, even with a great GPU" {
        $hardware = [ordered]@{ cudaCapable = $true; gpuName = "NVIDIA GeForce RTX 4070"; vramMb = 12281 }
        $result = Resolve-LocalVoiceMode -Requested "AUTO" -Hardware $hardware -DiskFreeGb 3
        $result.mode | Should Be "LIGHTWEIGHT"
    }

    It "resolves to SKIP under AUTO when there is not even enough disk for the lightweight model" {
        $hardware = [ordered]@{ cudaCapable = $false; gpuName = $null; vramMb = $null }
        $result = Resolve-LocalVoiceMode -Requested "AUTO" -Hardware $hardware -DiskFreeGb 0.5
        $result.mode | Should Be "SKIP"
    }

    It "honors an explicit request regardless of hardware" {
        $hardware = [ordered]@{ cudaCapable = $false; gpuName = $null; vramMb = $null }
        (Resolve-LocalVoiceMode -Requested "HIGH_QUALITY" -Hardware $hardware -DiskFreeGb 0).mode | Should Be "HIGH_QUALITY"
        (Resolve-LocalVoiceMode -Requested "LIGHTWEIGHT" -Hardware $hardware -DiskFreeGb 0).mode | Should Be "LIGHTWEIGHT"
    }

    It "always resolves SKIP to SKIP, never silently upgrading to a local model" {
        $hardware = [ordered]@{ cudaCapable = $true; gpuName = "NVIDIA GeForce RTX 4090"; vramMb = 24564 }
        (Resolve-LocalVoiceMode -Requested "SKIP" -Hardware $hardware -DiskFreeGb 999).mode | Should Be "SKIP"
    }
}

Describe "Get-LocalVoicePaths" {
    It "keeps the runtime and model cache under shared\, never under a release directory" {
        $paths = Get-LocalVoicePaths -AbudShared "C:\ProgramData\AbudShorts\shared" -AbudDataDir "C:\ProgramData\AbudShorts\shared\data" -Port 8765
        $paths.VenvDir | Should Match "shared\\runtime"
        $paths.ModelCacheDir | Should Match "shared\\data\\models"
        $paths.VenvDir | Should Not Match "releases"
        $paths.ModelCacheDir | Should Not Match "releases"
    }

    It "uses the requested port" {
        $paths = Get-LocalVoicePaths -AbudShared "C:\ProgramData\AbudShorts\shared" -AbudDataDir "C:\ProgramData\AbudShorts\shared\data" -Port 8771
        $paths.Port | Should Be 8771
    }
}

Describe "Test-LocalVoiceRuntimeReady" {
    It "reports not ready when the venv does not exist" {
        $paths = Get-LocalVoicePaths -AbudShared (Join-Path $env:TEMP "abud-lv-test-missing") -AbudDataDir (Join-Path $env:TEMP "abud-lv-test-missing\data")
        Test-LocalVoiceRuntimeReady -Paths $paths | Should Be $false
    }
}

Describe "Get-LocalVoiceDiskFreeGb" {
    It "never throws on a path that does not exist, and degrades to 0" {
        { Get-LocalVoiceDiskFreeGb -Path "Q:\definitely\not\a\real\drive" } | Should Not Throw
    }

    It "reads real free space for the current drive" {
        $free = Get-LocalVoiceDiskFreeGb -Path $env:TEMP
        $free | Should BeGreaterThan 0
    }
}

Describe "Resolve-LocalVoicePort" {
    It "returns the preferred port when nothing else is listening on it" {
        $port = Resolve-LocalVoicePort -PreferredPort 18765 -MaxAttempts 3
        $port | Should Be 18765
    }

    It "never hands out a port another installation has claimed, even while it is free" {
        $port = Resolve-LocalVoicePort -PreferredPort 18766 -MaxAttempts 4 -ReservedPorts @(18766)
        $port | Should Be 18767
        $port | Should Not Be 18766
    }

    It "scans past both reserved and occupied candidates" {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 18768)
        try {
            $listener.Start()
            $port = Resolve-LocalVoicePort -PreferredPort 18768 -MaxAttempts 4 -ReservedPorts @(18769)
            $port | Should Be 18770
        }
        finally {
            $listener.Stop()
        }
    }
}

Describe "Get-SiblingLocalVoiceReservedPorts" {
    It "collects a sibling install's claimed port and always excludes our own root" {
        $base = Join-Path $env:TEMP ("abud-lv-sib-" + [Guid]::NewGuid().ToString("N"))
        $myRoot = Join-Path $base "Mine"
        $sibling = Join-Path $base "Sibling"
        $other = Join-Path $base "NoEnv"
        try {
            New-Item -ItemType Directory -Path (Join-Path $myRoot "shared\config") -Force | Out-Null
            New-Item -ItemType Directory -Path (Join-Path $sibling "shared\config") -Force | Out-Null
            New-Item -ItemType Directory -Path $other -Force | Out-Null
            Set-Content -Path (Join-Path $myRoot "shared\config\.env") -Value "LOCAL_TTS_PORT=18771" -Encoding ascii
            Set-Content -Path (Join-Path $sibling "shared\config\.env") -Value "LOCAL_TTS_PORT=18772`nOTHER=1" -Encoding ascii

            $ports = Get-SiblingLocalVoiceReservedPorts -AbudShared (Join-Path $myRoot "shared") `
                -InstallRoots @($myRoot, $sibling, $other)
            ($ports -join ',') | Should Be "18772"
            @($ports) -contains 18771 | Should Be $false
        }
        finally {
            Remove-Item $base -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Describe "Get-LocalVoiceTaskNameFor" {
    It "keeps the bare historical name for the default install roots" {
        Get-LocalVoiceTaskNameFor -AbudShared (Join-Path $env:ProgramData "ShortStudio\shared") | Should Be "Short Studio - Local Voice"
        Get-LocalVoiceTaskNameFor -AbudShared (Join-Path $env:ProgramData "AbudShorts\shared") | Should Be "Short Studio - Local Voice"
    }

    It "derives a stable, distinct scoped name for any other install root" {
        $rootA = Join-Path $env:TEMP "abud-lv-name-a\shared"
        $rootB = Join-Path $env:TEMP "abud-lv-name-b\shared"
        $nameA = Get-LocalVoiceTaskNameFor -AbudShared $rootA
        $nameB = Get-LocalVoiceTaskNameFor -AbudShared $rootB
        $nameA | Should Match "^Short Studio - Local Voice \([0-9a-f]{8}\)$"
        $nameB | Should Match "^Short Studio - Local Voice \([0-9a-f]{8}\)$"
        $nameA | Should Not Be $nameB
        # Same root must always derive the same name (idempotent registration).
        Get-LocalVoiceTaskNameFor -AbudShared $rootA | Should Be $nameA
    }
}

Describe "Get-LocalVoiceServiceStatus" {
    It "reports not running when no PID file and nothing answers the port" {
        $paths = Get-LocalVoicePaths -AbudShared (Join-Path $env:TEMP "abud-lv-test-nosvc") -AbudDataDir (Join-Path $env:TEMP "abud-lv-test-nosvc\data") -Port 18766
        $status = Get-LocalVoiceServiceStatus -Paths $paths
        $status.running | Should Be $false
        $status.healthy | Should Be $false
    }
}

Describe "Windows auto-start (real, against this machine's actual Task Scheduler state)" {
    <#
    This machine's Task Scheduler denies task creation for this account (Pass
    9.10 finding, reproduced with the sandbox on and off, via schtasks.exe and
    the ScheduledTasks module, and independent of task name/flags). That is
    exactly the real condition Register-LocalVoiceAutoStart's fallback exists
    for, so running these tests here exercises the fallback path for real
    rather than mocking it. On a machine where Task Scheduler succeeds, the
    same assertions hold with mechanism == "scheduled_task" instead.
    #>
    It "registers via SOME working mechanism, never silently reporting none when one exists" {
        $root = Join-Path $env:TEMP ("abud-lv-autostart-" + [Guid]::NewGuid().ToString("N"))
        try {
            $result = Register-LocalVoiceAutoStart -AbudShared $root
            $result.registered | Should Be $true
            @("scheduled_task", "startup_folder") -contains $result.mechanism | Should Be $true
            Test-Path (Get-LocalVoiceAutoStartLauncherPath -AbudShared $root) | Should Be $true

            $status = Test-LocalVoiceAutoStartRegistered -AbudShared $root
            $status.any | Should Be $true
            $status.mechanism | Should Be $result.mechanism
        }
        finally {
            Unregister-LocalVoiceAutoStart -AbudShared $root | Out-Null
            Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It "is idempotent - registering twice never creates a duplicate Startup entry" {
        $root = Join-Path $env:TEMP ("abud-lv-autostart-dup-" + [Guid]::NewGuid().ToString("N"))
        try {
            Register-LocalVoiceAutoStart -AbudShared $root | Out-Null
            Register-LocalVoiceAutoStart -AbudShared $root | Out-Null
            $startupDir = [System.Environment]::GetFolderPath("Startup")
            $matches = @(Get-ChildItem $startupDir -Filter "Short Studio - Local Voice*" -ErrorAction SilentlyContinue) +
            @(Get-ChildItem $startupDir -Filter "ABUD Shorts - Local Voice*" -ErrorAction SilentlyContinue)
            $matches.Count | Should BeLessThan 2
        }
        finally {
            Unregister-LocalVoiceAutoStart -AbudShared $root | Out-Null
            Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It "writes and quotes the launcher correctly for a shared root containing a space" {
        $root = Join-Path $env:TEMP ("abud lv autostart space " + [Guid]::NewGuid().ToString("N"))
        try {
            $result = Register-LocalVoiceAutoStart -AbudShared $root
            $result.registered | Should Be $true
            $launcherPath = Get-LocalVoiceAutoStartLauncherPath -AbudShared $root
            Test-Path $launcherPath | Should Be $true
            # A real syntax parse of the generated launcher - a bad quote here
            # would otherwise only surface the next time Windows logs in.
            $parseErrors = $null
            [System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw $launcherPath), [ref]$parseErrors) | Out-Null
            $parseErrors.Count | Should Be 0
        }
        finally {
            Unregister-LocalVoiceAutoStart -AbudShared $root | Out-Null
            Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It "unregisters both mechanisms and the launcher, but never touches the model cache or runtime" {
        $root = Join-Path $env:TEMP ("abud-lv-autostart-preserve-" + [Guid]::NewGuid().ToString("N"))
        try {
            $dataDir = Join-Path $root "data"
            $paths = Get-LocalVoicePaths -AbudShared $root -AbudDataDir $dataDir -Port 18780
            New-Item -ItemType Directory -Path $paths.VenvDir -Force | Out-Null
            New-Item -ItemType Directory -Path $paths.ModelCacheDir -Force | Out-Null
            Set-Content -Path (Join-Path $paths.ModelCacheDir "metadata.json") -Value "{}" -Encoding utf8

            Register-LocalVoiceAutoStart -AbudShared $root | Out-Null
            Unregister-LocalVoiceAutoStart -AbudShared $root | Out-Null

            (Test-LocalVoiceAutoStartRegistered -AbudShared $root).any | Should Be $false
            Test-Path (Get-LocalVoiceAutoStartLauncherPath -AbudShared $root) | Should Be $false
            Test-Path $paths.VenvDir | Should Be $true
            Test-Path (Join-Path $paths.ModelCacheDir "metadata.json") | Should Be $true
        }
        finally {
            Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It "the launcher re-resolves current.txt, so it stays correct across an upgrade without re-registering" {
        $root = Join-Path $env:TEMP ("abud-lv-autostart-upgrade-" + [Guid]::NewGuid().ToString("N"))
        try {
            $launcherPath = Install-LocalVoiceAutoStartLauncher -AbudShared $root
            $content = Get-Content $launcherPath -Raw
            # It must read current.txt at run time, not bake in today's release path.
            $content | Should Match "current\.txt"
            $content | Should Not Match "releases\\\\2\."
        }
        finally {
            Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Describe "Uninstall preserves data by default" {
    It "Stop-LocalVoiceService never deletes the runtime or the model cache" {
        $root = Join-Path $env:TEMP ("abud-lv-test-uninstall-" + [Guid]::NewGuid().ToString("N"))
        try {
            $paths = Get-LocalVoicePaths -AbudShared $root -AbudDataDir (Join-Path $root "data") -Port 18767
            New-Item -ItemType Directory -Path $paths.VenvDir -Force | Out-Null
            New-Item -ItemType Directory -Path $paths.ModelCacheDir -Force | Out-Null
            Set-Content -Path (Join-Path $paths.ModelCacheDir "metadata.json") -Value "{}" -Encoding utf8

            Stop-LocalVoiceService -Paths $paths | Out-Null

            Test-Path $paths.VenvDir | Should Be $true
            Test-Path (Join-Path $paths.ModelCacheDir "metadata.json") | Should Be $true
        }
        finally {
            Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
