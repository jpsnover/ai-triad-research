# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Private helper — isolated so tests can mock via InModuleScope
function Get-ViteListeningPid {
    param([int]$Port)
    $lines = & netstat -ano 2>$null
    $match = $lines | Select-String -Pattern "TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)" |
        Select-Object -First 1
    if ($match) { [int]$match.Matches[0].Groups[1].Value } else { $null }
}

function Get-ViteDevStatus {
    <#
    .SYNOPSIS
        Reports the status of a Vite dev server on a given port.
    .DESCRIPTION
        Identifies the process listening on port 5173 (or a custom port),
        resolves its working directory from the process CommandLine, performs
        HTTP health probes against / and /index.tsx, and classifies whether
        the process is running from the main repo, a registered git worktree,
        or an orphaned worktree.

        Background: diagnosing t/2113 Q4 required manual netstat + process
        list + curl + worktree tracing. This cmdlet covers that in one call.
    .PARAMETER Port
        Port to check. Default: 5173 (Vite default).
    .PARAMETER TimeoutSec
        HTTP probe timeout in seconds (1–30). Default: 3.
    .EXAMPLE
        Get-ViteDevStatus
    .EXAMPLE
        Get-ViteDevStatus -Port 5174 | Format-List
    .EXAMPLE
        (Get-ViteDevStatus).IsOrphanedWorktree
    .LINK
        Show-AITriadHelp
    .LINK
        Test-TaxEditorHealth
    #>
    [CmdletBinding()]
    [OutputType('ViteDevStatus')]
    param(
        [ValidateRange(1, 65535)]
        [int]$Port = 5173,

        [ValidateRange(1, 30)]
        [int]$TimeoutSec = 3
    )

    Set-StrictMode -Version Latest
    $PSNativeCommandUseErrorActionPreference = $false

    $Result = [ViteDevStatus]::new()
    $Result.Port = $Port

    # ── Step 1: port check ─────────────────────────────────────────────────────
    $ListeningPid = Get-ViteListeningPid -Port $Port
    if ($null -eq $ListeningPid) {
        $Result.Listening = $false
        $Result.Summary = "Port $Port is not in use."
        return $Result
    }
    $Result.Listening = $true
    $Result.ProcessId = $ListeningPid

    # ── Step 2: process info via CIM ───────────────────────────────────────────
    $CimProc = Get-CimInstance Win32_Process -Filter "ProcessId = $ListeningPid" `
        -ErrorAction SilentlyContinue
    if ($CimProc) {
        $Result.ProcessName = [string]$CimProc.Name
        $CmdLine = if ($CimProc.PSObject.Properties['CommandLine'] -and $CimProc.CommandLine) {
            [string]$CimProc.CommandLine
        } else { '' }

        # Infer working directory: find \node_modules\ in CommandLine.
        # Everything before it is the Vite project dir; git rev-parse gives repo root.
        $NodeModulesIdx = $CmdLine.IndexOf('\node_modules\')
        if ($NodeModulesIdx -lt 0) { $NodeModulesIdx = $CmdLine.IndexOf('/node_modules/') }
        if ($NodeModulesIdx -ge 0) {
            $ProjectDir = $CmdLine.Substring(0, $NodeModulesIdx).Trim('"').Trim("'")
            if ((Test-Path $ProjectDir -ErrorAction SilentlyContinue)) {
                $GitRoot = & git -C $ProjectDir rev-parse --show-toplevel 2>$null
                if ($GitRoot) {
                    $Result.WorkingDirectory = ([string]$GitRoot).Trim()
                } else {
                    $Result.WorkingDirectory = $ProjectDir
                }
            }
        }
    }

    # ── Step 3: HTTP health probes ─────────────────────────────────────────────
    $BaseUrl = "http://localhost:$Port"
    foreach ($Path in @('/', '/index.tsx')) {
        $Code = 0
        try {
            $Resp = Invoke-WebRequest -Uri "$BaseUrl$Path" -UseBasicParsing `
                -TimeoutSec $TimeoutSec -ErrorAction Stop
            $Code = [int]$Resp.StatusCode
        } catch {
            if ($_.Exception.Response) {
                $Code = [int]$_.Exception.Response.StatusCode
            }
        }
        if ($Path -eq '/') {
            $Result.RootHttpStatus = $Code
        } else {
            $Result.IndexHttpStatus = $Code
        }
    }

    # ── Step 4: worktree classification ────────────────────────────────────────
    if ($Result.WorkingDirectory) {
        # $script:RepoRoot is set by AITriad.psm1 during module load
        $MainRoot = $script:RepoRoot.TrimEnd('/\')
        $WorkDir  = $Result.WorkingDirectory.TrimEnd('/\')

        if ($WorkDir -ieq $MainRoot) {
            $Result.IsMainRepo = $true
        } else {
            $WorktreeRaw = & git -C $MainRoot worktree list --porcelain 2>$null
            if ($WorktreeRaw) {
                $RegisteredPaths = @($WorktreeRaw | Select-String '^worktree ' |
                    ForEach-Object { $_.Line.Substring('worktree '.Length) })
                $OtherWorktrees  = @($RegisteredPaths | Where-Object { $_.TrimEnd('/\') -ine $MainRoot })
                $IsRegistered    = @($OtherWorktrees  | Where-Object { $_.TrimEnd('/\') -ieq $WorkDir }).Count -gt 0
                if ($IsRegistered) {
                    $Result.IsRegisteredWorktree = $true
                } else {
                    $Result.IsOrphanedWorktree = $true
                }
            }
        }
    }

    # ── Step 5: summary ────────────────────────────────────────────────────────
    $Location = if     ($Result.IsMainRepo)           { 'main repo' }
                elseif ($Result.IsRegisteredWorktree) { 'registered worktree' }
                elseif ($Result.IsOrphanedWorktree)   { 'ORPHANED worktree' }
                else                                  { 'unknown location' }

    $HttpInfo      = "/ -> $($Result.RootHttpStatus), /index.tsx -> $($Result.IndexHttpStatus)"
    $Result.Summary = "PID $($Result.ProcessId) ($($Result.ProcessName)) | $Location | HTTP: $HttpInfo"

    $Result
}
