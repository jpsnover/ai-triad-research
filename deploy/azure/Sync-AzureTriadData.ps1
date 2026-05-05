# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Trigger a GitHub data sync on the Azure-hosted Taxonomy Editor.
.DESCRIPTION
    Calls the Taxonomy Editor server's REST API to check for updates and pull
    latest data from GitHub into the Azure-mounted data volume. Requires an
    admin API key (ADMIN_API_KEY) configured on the container.

    The server's /api/data/pull endpoint fetches origin and resets to
    origin/main — the same operation as clicking "Update Data" in the UI.
.PARAMETER ServerUrl
    Base URL of the Azure-hosted Taxonomy Editor.
    Default: https://taxonomy-editor.yellowbush-aeda037d.eastus.azurecontainerapps.io
.PARAMETER AdminKey
    Admin API key matching ADMIN_API_KEY on the server. Falls back to
    $env:AITRIAD_ADMIN_KEY if not specified.
.PARAMETER Action
    What to do:
      CheckUpdates — check if GitHub has newer commits (no changes made)
      Pull         — fetch + reset to origin/main (default)
      SyncStatus   — show git sync status (branch, unsynced count, PR info)
      Diagnostics  — full diagnostics (files, commits, branch state)
.PARAMETER Force
    Skip the "are you sure?" confirmation on Pull.
.EXAMPLE
    ./Sync-AzureTriadData.ps1
    # Checks for updates, then pulls if available.
.EXAMPLE
    ./Sync-AzureTriadData.ps1 -Action CheckUpdates
    # Just checks — no changes.
.EXAMPLE
    ./Sync-AzureTriadData.ps1 -Action Diagnostics
    # Shows full sync diagnostics.
.EXAMPLE
    $env:AITRIAD_ADMIN_KEY = 'your-key-here'
    ./Sync-AzureTriadData.ps1 -Force
    # Pulls without confirmation using env var key.
#>

[CmdletBinding()]
param(
    [string]$ServerUrl = 'https://taxonomy-editor.yellowbush-aeda037d.eastus.azurecontainerapps.io',

    [string]$AdminKey,

    [ValidateSet('CheckUpdates', 'Pull', 'SyncStatus', 'Diagnostics')]
    [string]$Action = 'Pull',

    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Helpers ──

function Write-Step { param([string]$Message) Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-OK   { param([string]$Message) Write-Host "    $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "    $Message" -ForegroundColor Yellow }
function Write-Err  { param([string]$Message) Write-Host "    $Message" -ForegroundColor Red }

function Invoke-ServerApi {
    param(
        [Parameter(Mandatory)][string]$Method,
        [Parameter(Mandatory)][string]$Path,
        [hashtable]$Body
    )

    $uri = "$ServerUrl$Path"
    $headers = @{ 'X-Admin-Key' = $resolvedKey }

    $params = @{
        Uri     = $uri
        Method  = $Method
        Headers = $headers
        ContentType = 'application/json'
        UseBasicParsing = $true
    }

    if ($Body) {
        $params.Body = ($Body | ConvertTo-Json -Compress)
    }

    try {
        $response = Invoke-WebRequest @params -TimeoutSec 300
        $ct = $response.Headers['Content-Type']

        # /api/data/pull streams text (heartbeats + final JSON line)
        if ($ct -and $ct -like 'text/plain*') {
            $lines = $response.Content -split "`n" | Where-Object { $_.Trim() }
            foreach ($line in $lines) {
                if ($line.StartsWith('progress:')) {
                    Write-Host "    $($line.Substring(9).Trim())" -ForegroundColor DarkGray
                } elseif ($line.StartsWith('{')) {
                    return $line | ConvertFrom-Json
                }
            }
            return $null
        }

        return $response.Content | ConvertFrom-Json
    }
    catch {
        $status = $null
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
        }
        if ($status -eq 401 -or $status -eq 403) {
            throw "Authentication failed (HTTP $status). Check your ADMIN_API_KEY."
        }
        throw $_
    }
}

# ── Resolve admin key ──

$resolvedKey = if ($AdminKey) { $AdminKey } else { $env:AITRIAD_ADMIN_KEY }

if (-not $resolvedKey) {
    Write-Err 'No admin key provided.'
    Write-Host ''
    Write-Host '  Set the key with either:' -ForegroundColor White
    Write-Host '    -AdminKey <key>                 (parameter)' -ForegroundColor White
    Write-Host '    $env:AITRIAD_ADMIN_KEY = <key>  (environment variable)' -ForegroundColor White
    Write-Host ''
    Write-Host '  The key must match ADMIN_API_KEY on the Azure container.' -ForegroundColor White
    Write-Host '  Set it with:' -ForegroundColor Yellow
    Write-Host '    az containerapp update --name taxonomy-editor -g ai-triad \' -ForegroundColor Yellow
    Write-Host '      --set-env-vars "ADMIN_API_KEY=<your-secret-key>"' -ForegroundColor Yellow
    exit 1
}

# ── Pre-flight: verify server is reachable ──

Write-Step "Connecting to $ServerUrl"

try {
    $health = Invoke-ServerApi -Method GET -Path '/health'
    Write-OK "Server v$($health.version), up $($health.uptime)s, data: $($health.dataRoot)"
}
catch {
    Write-Err "Cannot reach server: $_"
    exit 1
}

# ── Action dispatch ──

switch ($Action) {
    'CheckUpdates' {
        Write-Step 'Checking for updates from GitHub'
        $result = Invoke-ServerApi -Method POST -Path '/api/data/check-updates'

        if ($result.PSObject.Properties['error']) {
            Write-Err "Check failed: $($result.error)"
            exit 1
        }

        if ($result.available) {
            Write-Warn "Updates available: $($result.behindCount) commit(s) behind origin/main"
            Write-Host "    Local:  $($result.currentCommit)" -ForegroundColor White
            Write-Host "    Remote: $($result.remoteCommit)" -ForegroundColor White
            Write-Host ''
            Write-Host '  Run with -Action Pull to apply updates.' -ForegroundColor Cyan
        } else {
            Write-OK 'Already up to date.'
        }
    }

    'Pull' {
        # Check first
        Write-Step 'Checking for updates from GitHub'
        $check = Invoke-ServerApi -Method POST -Path '/api/data/check-updates'

        if ($check.PSObject.Properties['error']) {
            Write-Err "Check failed: $($check.error)"
            exit 1
        }

        if (-not $check.available) {
            Write-OK 'Already up to date. Nothing to pull.'
            return
        }

        Write-Warn "$($check.behindCount) commit(s) behind origin/main"

        if (-not $Force) {
            $confirm = Read-Host "    Pull latest data? [y/N]"
            if ($confirm -notin @('y', 'Y', 'yes')) {
                Write-Host '    Cancelled.' -ForegroundColor DarkGray
                return
            }
        }

        Write-Step 'Pulling latest data from GitHub'
        $result = Invoke-ServerApi -Method POST -Path '/api/data/pull'

        if ($result -and $result.PSObject.Properties['success'] -and $result.success) {
            Write-OK $result.message
        } elseif ($result -and $result.PSObject.Properties['message']) {
            Write-Err "Pull failed: $($result.message)"
            exit 1
        } else {
            Write-Err 'Pull returned no response.'
            exit 1
        }
    }

    'SyncStatus' {
        Write-Step 'Fetching sync status'
        $status = Invoke-ServerApi -Method GET -Path '/api/sync/status'

        Write-Host ''
        Write-Host "    Sync enabled:       $($status.enabled)" -ForegroundColor White
        Write-Host "    Session branch:     $($status.session_branch ?? '(none)')" -ForegroundColor White
        Write-Host "    Unsynced files:     $($status.unsynced_count)" -ForegroundColor $(if ($status.unsynced_count -gt 0) { 'Yellow' } else { 'Green' })
        Write-Host "    Push pending:       $($status.push_pending)" -ForegroundColor White
        Write-Host "    GitHub configured:  $($status.github_configured)" -ForegroundColor White
        Write-Host "    Main update avail:  $($status.main_updated_available)" -ForegroundColor $(if ($status.main_updated_available) { 'Yellow' } else { 'White' })
        Write-Host "    Rebase in progress: $($status.rebase_in_progress)" -ForegroundColor $(if ($status.rebase_in_progress) { 'Red' } else { 'White' })

        if ($status.pr_number) {
            Write-Host "    Open PR:            #$($status.pr_number) — $($status.pr_url)" -ForegroundColor Cyan
        }
    }

    'Diagnostics' {
        Write-Step 'Fetching full diagnostics'
        $diag = Invoke-ServerApi -Method GET -Path '/api/sync/diagnostics'

        Write-Host ''
        Write-Host '  Git Configuration' -ForegroundColor Cyan
        Write-Host "    Git sync enabled:   $($diag.git_sync_enabled)" -ForegroundColor White
        Write-Host "    Data root:          $($diag.data_root)" -ForegroundColor White
        Write-Host "    Has .git:           $($diag.data_root_has_git)" -ForegroundColor White
        Write-Host "    GitHub repo:        $($diag.github_repo ?? '(not set)')" -ForegroundColor White
        Write-Host "    Credentials valid:  $($diag.github_credentials_valid)" -ForegroundColor White
        Write-Host "    Active taxonomy:    $($diag.active_taxonomy_dir)" -ForegroundColor White

        Write-Host ''
        Write-Host '  Branch State' -ForegroundColor Cyan
        Write-Host "    Current branch:     $($diag.current_branch ?? '(detached)')" -ForegroundColor White
        Write-Host "    HEAD:               $($diag.head_sha)" -ForegroundColor White
        Write-Host "    origin/main:        $($diag.origin_main_sha)" -ForegroundColor White
        Write-Host "    Ahead of main:      $($diag.ahead_of_main)" -ForegroundColor $(if ($diag.ahead_of_main -gt 0) { 'Yellow' } else { 'Green' })
        Write-Host "    Behind main:        $($diag.behind_main)" -ForegroundColor $(if ($diag.behind_main -gt 0) { 'Yellow' } else { 'Green' })

        if ($diag.files -and $diag.files.Count -gt 0) {
            Write-Host ''
            Write-Host "  Changed Files ($($diag.files.Count))" -ForegroundColor Cyan
            foreach ($f in $diag.files) {
                $statusChar = if ($f.git_status) { $f.git_status } else { ' ' }
                $color = switch ($statusChar) {
                    'M' { 'Yellow' }
                    'A' { 'Green' }
                    'D' { 'Red' }
                    '?' { 'DarkGray' }
                    default { 'White' }
                }
                Write-Host "    [$statusChar] $($f.relative_path)" -ForegroundColor $color
            }
        }

        if ($diag.recent_commits -and $diag.recent_commits.Count -gt 0) {
            Write-Host ''
            Write-Host "  Recent Commits ($($diag.recent_commits.Count))" -ForegroundColor Cyan
            foreach ($c in $diag.recent_commits) {
                $shortSha = $c.sha.Substring(0, 7)
                Write-Host "    $shortSha $($c.message)" -ForegroundColor White
            }
        }
    }
}

Write-Host ''
