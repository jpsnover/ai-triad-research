# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Install-GraphDatabase {
    <#
    .SYNOPSIS
        Sets up a Neo4j instance via Docker for graph visualization and Cypher queries.
    .DESCRIPTION
        Pulls and runs the Neo4j Community Edition Docker container with persistent
        storage at ~/ai-triad-graphdb/. The container exposes:
        - Bolt protocol on port 7687 (for Cypher queries)
        - HTTP browser on port 7474 (for Neo4j Browser UI)

        If a container named 'ai-triad-neo4j' already exists, it will be started
        (not recreated) unless -Force is specified.
    .PARAMETER Force
        Remove and recreate the container even if it already exists.
    .PARAMETER Credential
        Neo4j credential (PSCredential — same type as Invoke-CypherQuery / Export-TaxonomyToGraph).
        Username defaults to 'neo4j'. Falls back to the NEO4J_PASSWORD env var (user 'neo4j'). If neither
        is provided, a random password is generated and printed ONCE — copy it to $env:NEO4J_PASSWORD or
        re-run with -Credential to reuse it.

        SECURITY NOTE (t/3830): typing this as PSCredential keeps the password out of $PSBoundParameters,
        PowerShell transcripts, and shell history, and satisfies PSSA PSAvoidUsingPlainTextForPassword — it
        is NOT an encryption boundary. The password is still handed to `docker run` as the NEO4J_AUTH env
        value, so it remains visible in the docker process args and in `docker inspect` (Config.Env). Closing
        that residual is tracked in t/3833.
    .PARAMETER DataPath
        Path for persistent database storage. Default: ~/ai-triad-graphdb.
    .EXAMPLE
        Install-GraphDatabase
    .EXAMPLE
        Install-GraphDatabase -Credential (Get-Credential neo4j)
    .EXAMPLE
        Install-GraphDatabase -Force
    .LINK
        Show-AITriadHelp
    .LINK
        Find-GraphPath
    .LINK
        Find-Conflict
    .LINK
        Invoke-GraphQuery
    .LINK
        Invoke-CypherQuery
    .LINK
        Invoke-QbafConflictAnalysis
    .LINK
        Show-GraphOverview
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [switch]$Force,

        [PSCredential]$Credential,

        [string]$DataPath = (Join-Path $HOME 'ai-triad-graphdb')
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # Resolve credential → ($Neo4jUser, $Neo4jPassword): -Credential > NEO4J_PASSWORD env > generate once.
    # $Neo4jPassword is the materialized plaintext; it is used ONLY at the docker NEO4J_AUTH point-of-use
    # below (and printed once on the generate branch). See the SECURITY NOTE in the help — this typing
    # keeps the secret out of transcripts/history/$PSBoundParameters, it does NOT encrypt it.
    $Neo4jUser = 'neo4j'
    $Generated = $false
    if ($Credential) {
        $Neo4jUser = $Credential.UserName
        $Neo4jPassword = $Credential.GetNetworkCredential().Password   # point-of-use materialization
    } elseif ($env:NEO4J_PASSWORD) {
        # Env fallback matches the sibling cmdlets. NOTE: the env value is already plaintext in this
        # process (and inherited by children) — this path is not hardened by the retype; it is unchanged.
        $Neo4jPassword = $env:NEO4J_PASSWORD
    } else {
        $Neo4jPassword = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(18))
        $Generated = $true
        # The ONE sanctioned print of the secret — the generated password is otherwise unrecoverable.
        Write-Host ''
        Write-Host '  Neo4j password generated (not persisted):' -ForegroundColor Yellow
        Write-Host "    $Neo4jUser / $Neo4jPassword" -ForegroundColor Cyan
        Write-Host '  Set $env:NEO4J_PASSWORD = ''<above>'' or re-run with -Credential to reuse it.' -ForegroundColor Yellow
        Write-Host ''
    }

    $ContainerName = 'ai-triad-neo4j'

    # ── Step 1: Check Docker ──
    Write-Step 'Checking Docker'
    try {
        $null = & docker version 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'Docker not responding' }
        Write-OK 'Docker is available'
    } catch {
        Write-Fail 'Docker is not installed or not running.'
        Write-Info 'Install Docker Desktop from https://www.docker.com/products/docker-desktop'
        return
    }

    # ── Step 2: Check for existing container ──
    $Existing = & docker ps -a --filter "name=$ContainerName" --format '{{.Names}}' 2>&1
    if ($Existing -eq $ContainerName) {
        if ($Force) {
            if ($PSCmdlet.ShouldProcess($ContainerName, 'Remove existing container')) {
                Write-Step 'Removing existing container'
                & docker rm -f $ContainerName 2>&1 | Out-Null
                Write-OK 'Removed'
            }
        } else {
            # Check if running
            $Running = & docker ps --filter "name=$ContainerName" --format '{{.Names}}' 2>&1
            if ($Running -eq $ContainerName) {
                Write-OK "Container '$ContainerName' is already running"
                Write-Info "Neo4j Browser: http://localhost:7474"
                Write-Info "Bolt URI: bolt://localhost:7687"
                return
            } else {
                Write-Step 'Starting existing container'
                & docker start $ContainerName 2>&1 | Out-Null
                Write-OK "Container '$ContainerName' started"
                Write-Info "Neo4j Browser: http://localhost:7474"
                Write-Info "Bolt URI: bolt://localhost:7687"
                return
            }
        }
    }

    # ── Step 3: Create data directory ──
    if (-not (Test-Path $DataPath)) {
        if ($PSCmdlet.ShouldProcess($DataPath, 'Create data directory')) {
            New-Item -ItemType Directory -Path $DataPath -Force | Out-Null
            New-Item -ItemType Directory -Path (Join-Path $DataPath 'data') -Force | Out-Null
            New-Item -ItemType Directory -Path (Join-Path $DataPath 'logs') -Force | Out-Null
            Write-OK "Created $DataPath"
        }
    }

    # ── Step 4: Pull Neo4j image ──
    Write-Step 'Pulling Neo4j image'
    & docker pull neo4j:community 2>&1 | ForEach-Object { Write-Info $_ }
    Write-OK 'Image ready'

    # ── Step 5: Run container ──
    Write-Step 'Starting Neo4j container'
    if ($PSCmdlet.ShouldProcess($ContainerName, 'Create and start Neo4j container')) {
        & docker run -d `
            --name $ContainerName `
            -p 7474:7474 `
            -p 7687:7687 `
            -v "$DataPath/data:/data" `
            -v "$DataPath/logs:/logs" `
            -e "NEO4J_AUTH=$Neo4jUser/$Neo4jPassword" `
            -e "NEO4J_PLUGINS=[""apoc""]" `
            neo4j:community 2>&1 | Out-Null

        if ($LASTEXITCODE -eq 0) {
            Write-OK "Neo4j container '$ContainerName' started"
        } else {
            Write-Fail 'Failed to start Neo4j container'
            return
        }
    }

    # ── Step 6: Wait for readiness ──
    Write-Step 'Waiting for Neo4j to initialize'
    $MaxWait = 30
    $Ready = $false
    for ($i = 0; $i -lt $MaxWait; $i++) {
        Start-Sleep -Seconds 2
        try {
            $null = Invoke-RestMethod -Uri 'http://localhost:7474' -TimeoutSec 2 -ErrorAction Stop
            $Ready = $true
            break
        } catch {
            Write-Host '.' -NoNewline -ForegroundColor DarkGray
        }
    }
    Write-Host ''

    if ($Ready) {
        Write-OK 'Neo4j is ready'
    } else {
        Write-Warn 'Neo4j may still be starting. Check docker logs ai-triad-neo4j'
    }

    Write-Host ''
    Write-Host '=== Neo4j Installation Complete ===' -ForegroundColor Cyan
    Write-Host "  Neo4j Browser: http://localhost:7474" -ForegroundColor Green
    Write-Host "  Bolt URI:      bolt://localhost:7687" -ForegroundColor Green
    Write-Host "  Username:      $Neo4jUser" -ForegroundColor Green
    # Deliberately NOT printing the password here (t/3830 cond.1): the only sanctioned print is the
    # one-time generate-branch output above. Reprinting the resolved secret in this summary would leak a
    # provided/env password into console scrollback + any active transcript.
    $PwHint = if ($Generated) { 'see generated value above' } elseif ($Credential) { 'as provided via -Credential' } else { 'from $env:NEO4J_PASSWORD' }
    Write-Host "  Password:      ($PwHint)" -ForegroundColor Green
    Write-Host "  Data path:     $DataPath" -ForegroundColor Green
    Write-Host ''
    Write-Host 'Next steps:' -ForegroundColor Cyan
    Write-Host '  1. Export-TaxonomyToGraph -Full' -ForegroundColor White
    Write-Host '  2. Open http://localhost:7474 in your browser' -ForegroundColor White
    Write-Host ''
}
