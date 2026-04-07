# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Show-TaxonomyEditor {
    <#
    .SYNOPSIS
        Launch the Taxonomy Editor.
    .DESCRIPTION
        Starts the Taxonomy Editor and opens it in your default web browser.

        By default, runs in container mode (Docker): all dependencies are
        encapsulated in a Docker image, so nothing beyond Docker needs to be
        installed on the host.

        Falls back to legacy dev mode (Electron via npm run dev) if Docker is
        not available but Node.js is installed.

        Use -Dev to force legacy Electron dev mode even when Docker is available.
    .PARAMETER Port
        Port for the web server. Default: 7862.
    .PARAMETER DataPath
        Override the data directory path. By default, resolved via .aitriad.json
        or $env:AI_TRIAD_DATA_ROOT.
    .PARAMETER NoBrowser
        Start the server without opening a browser.
    .PARAMETER Pull
        Force-pull the latest Docker image even if one is already cached.
    .PARAMETER Detach
        Run the container in the background and return immediately.
    .PARAMETER Stop
        Stop a detached Taxonomy Editor container.
    .PARAMETER Status
        Show whether a Taxonomy Editor container is running.
    .PARAMETER Dev
        Force legacy Electron dev mode (npm run dev) instead of container mode.
    .EXAMPLE
        Show-TaxonomyEditor
        # Opens in browser via Docker container
    .EXAMPLE
        Show-TaxonomyEditor -Port 8080 -DataPath ~/research-data
        # Custom port and data directory
    .EXAMPLE
        Show-TaxonomyEditor -Detach
        # ... later ...
        Show-TaxonomyEditor -Stop
    .EXAMPLE
        Show-TaxonomyEditor -Dev
        # Legacy Electron desktop app (requires Node.js)
    #>
    [CmdletBinding(DefaultParameterSetName = 'Run')]
    param(
        [Parameter(ParameterSetName = 'Run')]
        [Parameter(ParameterSetName = 'Dev')]
        [int]$Port = 7862,

        [Parameter(ParameterSetName = 'Run')]
        [string]$DataPath,

        [Parameter(ParameterSetName = 'Run')]
        [Parameter(ParameterSetName = 'Dev')]
        [switch]$NoBrowser,

        [Parameter(ParameterSetName = 'Run')]
        [switch]$Pull,

        [Parameter(ParameterSetName = 'Run')]
        [switch]$Detach,

        [Parameter(ParameterSetName = 'Stop')]
        [switch]$Stop,

        [Parameter(ParameterSetName = 'Status')]
        [switch]$Status,

        [Parameter(ParameterSetName = 'Dev')]
        [switch]$Dev
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── Handle -Stop and -Status immediately ──────────────────────────────────
    if ($Stop) {
        Stop-TaxonomyContainer -Port $Port
        return
    }
    if ($Status) {
        Get-TaxonomyContainerStatus -Port $Port
        return
    }

    # ── Decide launch mode ────────────────────────────────────────────────────
    $UseDocker = $false
    if ($Dev) {
        # Forced legacy mode
        $UseDocker = $false
    }
    elseif (Get-Command docker -ErrorAction SilentlyContinue) {
        # Docker available — try it
        try {
            $null = docker info 2>&1
            if ($LASTEXITCODE -eq 0) {
                $UseDocker = $true
            }
        }
        catch { }
    }

    if (-not $UseDocker -and -not $Dev) {
        # Docker not available — check if we can fall back to dev mode
        if (Get-Command npm -ErrorAction SilentlyContinue) {
            Write-Info 'Docker not available. Falling back to Electron dev mode.'
            $Dev = $true
        }
        else {
            throw (New-ActionableError `
                -Goal 'Launch Taxonomy Editor' `
                -Problem 'Neither Docker nor Node.js/npm is available' `
                -Location 'Show-TaxonomyEditor' `
                -NextSteps @(
                    'Install Docker Desktop: https://www.docker.com/products/docker-desktop/'
                    'Or install Node.js: https://nodejs.org/'
                ))
        }
    }

    # ── Legacy Electron dev mode ──────────────────────────────────────────────
    if ($Dev) {
        Start-LegacyElectronMode -NoBrowser:$NoBrowser
        return
    }

    # ── Container mode ────────────────────────────────────────────────────────
    Start-ContainerMode -Port $Port -DataPath $DataPath -NoBrowser:$NoBrowser `
        -Pull:$Pull -Detach:$Detach
}

# ── Private: Legacy Electron mode ─────────────────────────────────────────────

function Start-LegacyElectronMode {
    [CmdletBinding()]
    param([switch]$NoBrowser)

    $AppDir = Join-Path (Get-CodeRoot) 'taxonomy-editor'
    if (-not (Test-Path $AppDir)) {
        Write-Fail "App directory not found: $AppDir"
        return
    }

    # Check data
    $TaxDir  = Get-TaxonomyDir
    $DataOk  = Test-Path (Join-Path $TaxDir 'accelerationist.json')
    if (-not $DataOk) {
        Write-Warn "AI Triad data not found at: $TaxDir"
        $Choice = $Host.UI.PromptForChoice(
            'Missing Data',
            'Run Install-AITriadData to clone the data repository?',
            @('&Yes', '&No'),
            0
        )
        if ($Choice -eq 0) {
            Install-AITriadData
            if (-not (Test-Path (Join-Path $TaxDir 'accelerationist.json'))) {
                Write-Fail 'Data installation did not complete. Cannot launch Taxonomy Editor.'
                return
            }
        }
        else {
            Write-Warn 'Launching without data — the app may not function correctly.'
        }
    }

    # Check npm
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Warn 'npm not found — Node.js is required for Electron dev mode.'
        $Choice = $Host.UI.PromptForChoice(
            'Missing Dependency',
            'Run Install-AIDependencies to install Node.js and other dependencies?',
            @('&Yes', '&No'),
            0
        )
        if ($Choice -eq 0) {
            Install-AIDependencies -SkipPython
        }
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
            Write-Fail 'npm still not found after install attempt. Cannot launch Taxonomy Editor.'
            return
        }
    }

    # Check node_modules
    $NodeModules = Join-Path $AppDir 'node_modules'
    if (-not (Test-Path $NodeModules)) {
        Write-Warn "Node modules not installed in taxonomy-editor/."
        $Choice = $Host.UI.PromptForChoice(
            'Missing Node Modules',
            "Run 'npm install' in the taxonomy-editor directory?",
            @('&Yes', '&No'),
            0
        )
        if ($Choice -eq 0) {
            Write-Step 'Installing Node modules'
            Push-Location $AppDir
            try {
                npm install
                if ($LASTEXITCODE -ne 0) {
                    Write-Fail "npm install failed (exit code $LASTEXITCODE)."
                    return
                }
                Write-OK 'Node modules installed.'
            }
            finally { Pop-Location }
        }
        else {
            Write-Warn "Proceeding without node_modules — 'npm run dev' will likely fail."
        }
    }

    # Launch
    Push-Location $AppDir
    try {
        npm run dev
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "npm run dev exited with code $LASTEXITCODE."
        }
    }
    finally { Pop-Location }
}

# ── Private: Container mode ───────────────────────────────────────────────────

function Start-ContainerMode {
    [CmdletBinding()]
    param(
        [int]$Port,
        [string]$DataPath,
        [switch]$NoBrowser,
        [switch]$Pull,
        [switch]$Detach
    )

    $ImageName     = 'aitriad/taxonomy-editor:latest'
    $ContainerName = Get-ContainerName -Port $Port

    # ── Resolve data path ─────────────────────────────────────────────────
    if (-not $DataPath) {
        # Use the same resolution logic as the module
        if ($env:AI_TRIAD_DATA_ROOT) {
            $DataPath = $env:AI_TRIAD_DATA_ROOT
        }
        else {
            try {
                $DataPath = Resolve-DataPath '.'
            }
            catch {
                # Last resort: sibling directory
                $CodeRoot = Get-CodeRoot
                $DataPath = Join-Path (Split-Path $CodeRoot -Parent) 'ai-triad-data'
            }
        }
    }

    $DataPath = (Resolve-Path -Path $DataPath -ErrorAction SilentlyContinue)?.Path
    if (-not $DataPath -or -not (Test-Path $DataPath)) {
        Write-Warn "Data directory not found: $DataPath"
        Write-Info  'The editor will show the First Run dialog to set up data.'
        # Create the directory so Docker can mount it
        $DataPath = if ($env:AI_TRIAD_DATA_ROOT) { $env:AI_TRIAD_DATA_ROOT }
                    else { Join-Path (Split-Path (Get-CodeRoot) -Parent) 'ai-triad-data' }
        $null = New-Item -ItemType Directory -Path $DataPath -Force -ErrorAction SilentlyContinue
    }

    Write-Info "Data directory: $DataPath"

    # ── Check for existing container on this port ─────────────────────────
    if (Test-TaxonomyContainerRunning -Port $Port) {
        Write-OK "Taxonomy Editor is already running at http://localhost:$Port"
        if (-not $NoBrowser) {
            Start-Process "http://localhost:$Port"
        }
        return
    }

    # ── Clean up stale container with same name ──────────────────────────
    $stale = docker ps -a --filter "name=$ContainerName" --format '{{.Names}}' 2>&1
    if ($stale -eq $ContainerName) {
        docker rm $ContainerName 2>&1 | Out-Null
    }

    # ── Pull image if needed ──────────────────────────────────────────────
    if ($Pull -or -not (Test-DockerImageExists -ImageName $ImageName)) {
        Pull-TaxonomyEditorImage -ImageName $ImageName
    }

    # ── Build docker run arguments ────────────────────────────────────────
    $envArgs = Get-ApiKeyEnvArgs

    # UID/GID for bind mount and tmpfs ownership
    $uid = $null
    $gid = $null
    if ($IsLinux -or $IsMacOS) {
        $uid = id -u 2>$null
        $gid = id -g 2>$null
    }
    $tmpfsUidOpt = if ($uid -and $gid) { ",uid=$uid,gid=$gid" } else { '' }

    $runArgs = @(
        'run', '--rm'
        '--name', $ContainerName
        '-p', "${Port}:7862"
        '-v', "${DataPath}:/data"
        # Security hardening
        '--cap-drop', 'ALL'
        '--read-only'
        '--tmpfs', "/tmp:rw,noexec,nosuid,size=256m${tmpfsUidOpt}"
        '--tmpfs', "/app/.cache:rw,noexec,nosuid,size=512m${tmpfsUidOpt}"
        # Writable home for PowerShell config/cache (needed with --read-only)
        '--tmpfs', "/home/aitriad:rw,noexec,nosuid,size=64m${tmpfsUidOpt}"
        '-e', 'HOME=/home/aitriad'
        # Resource limits
        '--memory', '4g'
        '--cpus', '2'
    )

    # UID/GID matching — prevent file permission mismatches on the bind mount
    if ($uid -and $gid) {
        $runArgs += '--user'
        $runArgs += "${uid}:${gid}"
    }

    $runArgs += $envArgs

    if ($Detach) {
        $runArgs += '-d'
    }

    $runArgs += $ImageName

    # ── Launch ────────────────────────────────────────────────────────────
    if ($Detach) {
        Write-Step 'Starting Taxonomy Editor (detached)'
        $dockerOutput = docker @runArgs 2>&1
        if ($LASTEXITCODE -ne 0) {
            $errorText = ($dockerOutput | Out-String).Trim()
            Write-Fail "Failed to start container (exit code $LASTEXITCODE)."
            if ($errorText -match 'port is already allocated|address already in use') {
                Write-Warn "Port $Port is already in use by another process."
                Write-Info "Fix: Stop whatever is using port ${Port}:"
                Write-Info "  docker ps                          # find the container"
                Write-Info "  docker stop <container-id>         # stop it"
                Write-Info "  lsof -i :$Port                     # or find non-Docker process"
                Write-Info "Or use a different port: Show-TaxonomyEditor -Port 8080"
            }
            elseif ($errorText -match 'is already in use by container') {
                Write-Warn "A container named '$ContainerName' already exists."
                Write-Info "Fix: Remove the stale container and retry:"
                Write-Info "  docker rm $ContainerName"
                Write-Info "  Show-TaxonomyEditor"
            }
            elseif ($errorText -match 'No such image') {
                Write-Warn 'Docker image not found locally.'
                Write-Info "Fix: Pull the image first:"
                Write-Info "  Show-TaxonomyEditor -Pull"
            }
            else {
                Write-Info "Docker error: $errorText"
                Write-Info "Try: docker logs $ContainerName"
            }
            return
        }

        $ready = Wait-ForHealthEndpoint -Port $Port -TimeoutSeconds 30
        if ($ready) {
            Test-ContainerVersionCompat -Port $Port
            if (-not $NoBrowser) {
                Start-Process "http://localhost:$Port"
            }
        }
        Write-OK "Taxonomy Editor running at http://localhost:$Port (detached)"
        Write-Info "Stop with: Show-TaxonomyEditor -Stop"
    }
    else {
        Write-Step 'Starting Taxonomy Editor'

        # Start the container detached, then block here until Ctrl+C
        $fgArgs = $runArgs.Clone()
        # Insert -d flag before the image name (last element)
        $fgArgs = @($fgArgs[0..($fgArgs.Count - 2)]) + @('-d') + @($fgArgs[-1])

        $dockerOutput = docker @fgArgs 2>&1
        if ($LASTEXITCODE -ne 0) {
            $errorText = ($dockerOutput | Out-String).Trim()
            Write-Fail "Failed to start container (exit code $LASTEXITCODE)."
            if ($errorText -match 'port is already allocated|address already in use') {
                Write-Warn "Port $Port is already in use by another process."
                Write-Info "Fix: Stop whatever is using port ${Port}:"
                Write-Info "  docker ps                          # find the container"
                Write-Info "  docker stop <container-id>         # stop it"
                Write-Info "  lsof -i :$Port                     # or find non-Docker process"
                Write-Info "Or use a different port: Show-TaxonomyEditor -Port 8080"
            }
            elseif ($errorText -match 'is already in use by container') {
                Write-Warn "A container named '$ContainerName' already exists."
                Write-Info "Fix: Remove the stale container and retry:"
                Write-Info "  docker rm $ContainerName"
                Write-Info "  Show-TaxonomyEditor"
            }
            elseif ($errorText -match 'No such image') {
                Write-Warn 'Docker image not found locally.'
                Write-Info "Fix: Pull the image first:"
                Write-Info "  Show-TaxonomyEditor -Pull"
            }
            else {
                Write-Info "Docker error: $errorText"
                Write-Info "Try: docker logs $ContainerName"
            }
            return
        }

        # Wait for the health endpoint
        $ready = Wait-ForHealthEndpoint -Port $Port -TimeoutSeconds 30
        if ($ready) {
            Test-ContainerVersionCompat -Port $Port
            if (-not $NoBrowser) {
                Start-Process "http://localhost:$Port"
            }
            Write-OK "Taxonomy Editor running at http://localhost:$Port"
            Write-Info 'Press Ctrl+C to stop.'
        }

        # Block until the user presses Ctrl+C
        try {
            while (Test-TaxonomyContainerRunning -Port $Port) {
                Start-Sleep -Seconds 2
            }
        }
        catch {
            # Ctrl+C
        }
        finally {
            if (Test-TaxonomyContainerRunning -Port $Port) {
                Write-Step 'Stopping container...'
                docker stop $ContainerName 2>&1 | Out-Null
            }
            # Clean up the stopped container
            docker rm $ContainerName 2>&1 | Out-Null
            Write-OK 'Stopped.'
        }
    }
}
