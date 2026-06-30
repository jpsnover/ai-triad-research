# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Watch-DebateProgress {
    <#
    .SYNOPSIS
        Live-updating display of a debate batch's progress file.
    .DESCRIPTION
        Polls a debate-progress.json file written by Invoke-DebateBatch /
        Invoke-AITDebate -ProgressFile, and renders a table of per-debate
        status. Refreshes every -IntervalSeconds (default 10s). Press Ctrl+C
        to exit.

        A debate whose last_update_at is older than -HungAfterMinutes (default
        5) while still marked 'running' is flagged HUNG? in red — useful for
        catching silent stalls like the 3-hour exp-1069 hang.
    .PARAMETER Path
        Path to the progress file. Defaults to ./debate-progress.json under
        the current directory.
    .PARAMETER IntervalSeconds
        Poll interval (1-300, default 10).
    .PARAMETER HungAfterMinutes
        Threshold in minutes after which a 'running' debate without updates
        is flagged HUNG? (1-60, default 5).
    .EXAMPLE
        Watch-DebateProgress
    .EXAMPLE
        Watch-DebateProgress -Path D:\debates\exp-1069\debate-progress.json -IntervalSeconds 5
    #>
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string]$Path = (Join-Path (Get-Location) 'debate-progress.json'),

        [ValidateRange(1, 300)]
        [int]$IntervalSeconds = 10,

        [ValidateRange(1, 60)]
        [int]$HungAfterMinutes = 5
    )

    Set-StrictMode -Version Latest

    Write-Host "Watching: $Path" -ForegroundColor Cyan
    Write-Host "Refresh: ${IntervalSeconds}s | Hung threshold: ${HungAfterMinutes}m | Ctrl+C to exit" -ForegroundColor DarkGray
    Write-Host ''

    while ($true) {
        if (-not (Test-Path $Path)) {
            Clear-Host
            Write-Host "Waiting for progress file: $Path" -ForegroundColor Yellow
            Start-Sleep -Seconds $IntervalSeconds
            continue
        }

        $State = $null
        try {
            $Raw = Get-Content -Raw -Path $Path -ErrorAction Stop
            if (-not [string]::IsNullOrWhiteSpace($Raw)) {
                $State = $Raw | ConvertFrom-Json
            }
        } catch {
            # Reader race against atomic-rename writer is unlikely but harmless — try next tick
            Start-Sleep -Seconds $IntervalSeconds
            continue
        }

        if (-not $State) {
            Start-Sleep -Seconds $IntervalSeconds
            continue
        }

        Clear-Host

        # Header
        $Now = Get-Date
        $BatchName = if ($State.PSObject.Properties['batch_name']) { $State.batch_name } else { '(unnamed)' }
        $Elapsed = ''
        if ($State.PSObject.Properties['started_at'] -and $State.started_at) {
            try {
                $Started = [DateTimeOffset]::Parse($State.started_at).UtcDateTime
                $Span = $Now.ToUniversalTime() - $Started
                $Elapsed = "  (running {0:hh\:mm\:ss})" -f $Span
            } catch { }
        }
        Write-Host ("[{0:HH:mm:ss}] Debate Batch: {1}{2}" -f $Now, $BatchName, $Elapsed) -ForegroundColor Cyan
        Write-Host ''

        # Table
        $Debates = @()
        if ($State.PSObject.Properties['debates']) { $Debates = @($State.debates) }
        if ($Debates.Count -eq 0) {
            Write-Host '  (no debates registered yet)' -ForegroundColor DarkGray
        } else {
            $NameWidth = [Math]::Max(20, (@($Debates | ForEach-Object { $_.name.Length }) | Measure-Object -Maximum).Maximum)
            $Fmt = "  {0,-$NameWidth}  {1,-9}  {2,-6}  {3,-9}  {4,-15}  {5}"
            Write-Host ($Fmt -f 'Name', 'Status', 'Turn', 'Stage', 'Debater', 'Last Update') -ForegroundColor White
            Write-Host ($Fmt -f ('-' * $NameWidth), '-------', '----', '-----', '-------', '-----------') -ForegroundColor DarkGray

            foreach ($D in $Debates) {
                $Name = $D.name
                $Status = if ($D.PSObject.Properties['status']) { [string]$D.status } else { 'unknown' }
                $Turn = '-'
                if ($D.PSObject.Properties['current_turn'] -and $D.PSObject.Properties['total_turns_expected'] -and $D.total_turns_expected) {
                    $Turn = "$($D.current_turn)/$($D.total_turns_expected)"
                } elseif ($D.PSObject.Properties['current_turn']) {
                    $Turn = [string]$D.current_turn
                }
                $Stage = if ($D.PSObject.Properties['current_stage']) { [string]$D.current_stage } else { '-' }
                $Debater = if ($D.PSObject.Properties['current_debater']) { [string]$D.current_debater } else { '-' }

                # Compute last_update relative time
                $LastUpdateText = '-'
                $IsHung = $false
                if ($D.PSObject.Properties['last_update_at'] -and $D.last_update_at) {
                    try {
                        $LastUpdate = [DateTimeOffset]::Parse($D.last_update_at).UtcDateTime
                        $Age = $Now.ToUniversalTime() - $LastUpdate
                        $LastUpdateText = if ($Age.TotalSeconds -lt 60) {
                            "{0:n0}s ago" -f $Age.TotalSeconds
                        } elseif ($Age.TotalMinutes -lt 60) {
                            "{0:n0}m ago" -f $Age.TotalMinutes
                        } else {
                            "{0:hh\:mm\:ss} ago" -f $Age
                        }
                        if ($Status -eq 'running' -and $Age.TotalMinutes -gt $HungAfterMinutes) {
                            $IsHung = $true
                        }
                    } catch { }
                }

                $StatusText = if ($IsHung) { "HUNG?  " } else { $Status }
                $Color = switch ($Status) {
                    'done'    { 'Green' }
                    'failed'  { 'Red' }
                    'running' { if ($IsHung) { 'Red' } else { 'Yellow' } }
                    'pending' { 'DarkGray' }
                    default   { 'White' }
                }
                Write-Host ($Fmt -f $Name, $StatusText, $Turn, $Stage, $Debater, $LastUpdateText) -ForegroundColor $Color
            }

            # Footer counts
            $StatusCounts = @{}
            foreach ($D in $Debates) {
                $S = if ($D.PSObject.Properties['status']) { [string]$D.status } else { 'unknown' }
                if (-not $StatusCounts.ContainsKey($S)) { $StatusCounts[$S] = 0 }
                $StatusCounts[$S]++
            }
            $Summary = ($StatusCounts.Keys | Sort-Object | ForEach-Object { "$($_)=$($StatusCounts[$_])" }) -join '  '
            Write-Host ''
            Write-Host "  $Summary" -ForegroundColor DarkGray
        }

        Start-Sleep -Seconds $IntervalSeconds
    }
}
