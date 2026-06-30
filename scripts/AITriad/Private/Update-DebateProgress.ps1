# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Atomic per-turn progress writer for debate runs.
# Dot-sourced by AITriad.psm1 — do NOT export.

function Update-DebateProgress {
    <#
    .SYNOPSIS
        Atomically updates a debate-progress.json status file.
    .DESCRIPTION
        Read-modify-write of a JSON status file shared between a debate runner
        and Watch-DebateProgress. Writes via a temp file + Move-Item so the
        watcher never reads a half-written document.

        Caller supplies the debate identity (BatchName + DebateName) and a
        hashtable of fields to merge onto that debate's entry. Initializes the
        file on first write. Always stamps last_update_at to now (UTC).
    .PARAMETER Path
        Absolute path to debate-progress.json.
    .PARAMETER BatchName
        Top-level batch identifier. Set on first write; subsequent writes leave
        it alone unless explicitly overridden.
    .PARAMETER DebateName
        Per-debate identifier. The function upserts the entry with this name.
    .PARAMETER Fields
        Hashtable of fields to merge onto the debate entry. Common keys:
        status, started_at, current_turn, total_turns_expected, current_stage,
        current_debater, error.
    .PARAMETER Debates
        Optional. List of debate names to seed the file with as 'pending' on
        first write. Used by Invoke-DebateBatch to publish the full work list.
    .EXAMPLE
        Update-DebateProgress -Path $p -BatchName 'b1' -DebateName 'd1' -Fields @{
            status = 'running'; current_turn = 4; current_stage = 'draft'
        }
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        [string]$DebateName,

        [Parameter()]
        [string]$BatchName,

        [Parameter()]
        [hashtable]$Fields = @{},

        [Parameter()]
        [string[]]$Debates
    )

    Set-StrictMode -Version Latest

    $NowUtc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

    # ── Load or initialize ──────────────────────────────────
    $State = $null
    if (Test-Path $Path) {
        try {
            $Raw = Get-Content -Raw -Path $Path -ErrorAction Stop
            if (-not [string]::IsNullOrWhiteSpace($Raw)) {
                $State = $Raw | ConvertFrom-Json -AsHashtable
            }
        } catch {
            # Corrupted file (e.g. crash mid-write) — start fresh rather than fail the debate
            Write-Verbose "Update-DebateProgress: existing file unreadable, reinitializing ($($_.Exception.Message))"
        }
    }
    if (-not $State) {
        $State = @{
            batch_name = if ($BatchName) { $BatchName } else { '' }
            started_at = $NowUtc
            debates    = @()
        }
    }

    # Late-arriving BatchName overrides empty initial value
    if ($BatchName -and [string]::IsNullOrWhiteSpace($State['batch_name'])) {
        $State['batch_name'] = $BatchName
    }

    # Seed pending debates on first write
    if ($Debates -and @($State['debates']).Count -eq 0) {
        $Seeded = [System.Collections.Generic.List[hashtable]]::new()
        foreach ($Name in $Debates) {
            $Seeded.Add(@{ name = $Name; status = 'pending' })
        }
        $State['debates'] = $Seeded.ToArray()
    }

    # ── Upsert the named debate ─────────────────────────────
    $List = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($D in @($State['debates'])) { $List.Add([hashtable]$D) }

    $Entry = $null
    foreach ($D in $List) {
        if ($D['name'] -eq $DebateName) { $Entry = $D; break }
    }
    if (-not $Entry) {
        $Entry = @{ name = $DebateName; status = 'pending' }
        $List.Add($Entry)
    }

    foreach ($Key in $Fields.Keys) {
        $Entry[$Key] = $Fields[$Key]
    }
    $Entry['last_update_at'] = $NowUtc

    $State['debates'] = $List.ToArray()

    # ── Atomic write ────────────────────────────────────────
    $Dir = Split-Path -Parent $Path
    if ($Dir -and -not (Test-Path $Dir)) {
        $null = New-Item -ItemType Directory -Path $Dir -Force
    }
    $TempPath = "$Path.tmp"
    $Json = $State | ConvertTo-Json -Depth 10
    Set-Content -Path $TempPath -Value $Json -Encoding utf8NoBOM -NoNewline
    # Move-Item -Force on Windows replaces atomically when source/dest are on the same volume
    Move-Item -Path $TempPath -Destination $Path -Force
}
