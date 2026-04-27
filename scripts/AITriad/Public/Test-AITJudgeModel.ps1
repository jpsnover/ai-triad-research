# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Tests whether a different AI model improves debate turn validation by replaying
    the Stage-B judge prompt across multiple models and comparing verdicts.
.DESCRIPTION
    Runs a cross-model audit on completed debates. For each statement turn, the
    judge prompt is sent to every specified model and the verdicts are compared.
    Surfaces blind spots (turns one model flags but others pass), agreement rates,
    and per-model statistics.

    This is a one-off experiment tool — it does not modify any debate files.
.EXAMPLE
    Test-AITJudgeModel -DebateCount 3
    # Audits the 3 debates with the most validated turns using haiku + gemini-3.1-flash-lite-preview
.EXAMPLE
    Test-AITJudgeModel -DebatePath ../ai-triad-data/debates/debate-4bc8ae8a-1459-4d33-b306-4bdb2308d423.json -Models haiku,sonnet,gemini
.EXAMPLE
    Test-AITJudgeModel -DebateCount 5 -Models haiku,gemini,groq -MaxTurnsPerDebate 10 -OutputPath ./judge-audit.json
.EXAMPLE
    Test-AITJudgeModel -All -Models haiku,gemini -MaxTurnsPerDebate 5
    # Quick sweep across all debates with turn validations
#>
function Test-AITJudgeModel {
    [CmdletBinding(DefaultParameterSetName = 'Auto')]
    param(
        [Parameter(ParameterSetName = 'Auto')]
        [ValidateRange(1, 50)]
        [int]$DebateCount = 3,

        [Parameter(ParameterSetName = 'Auto')]
        [switch]$All,

        [Parameter(Mandatory, ParameterSetName = 'Explicit')]
        [string[]]$DebatePath,

        [Parameter()]
        [string]$Models = 'haiku,gemini',

        [Parameter()]
        [ValidateRange(1, 100)]
        [int]$MaxTurnsPerDebate = 50,

        [Parameter()]
        [string]$OutputPath
    )

    Set-StrictMode -Version Latest

    # ── Verify prerequisites ─────────────────────────────
    $NpxCmd = Get-Command npx.cmd -ErrorAction SilentlyContinue
    if (-not $NpxCmd) { $NpxCmd = Get-Command npx -ErrorAction SilentlyContinue }
    if (-not $NpxCmd) {
        throw "npx is required. Install Node.js (v18+): https://nodejs.org"
    }

    $RepoRoot = Get-CodeRoot
    $CliPath = Join-Path $RepoRoot 'lib' 'debate' 'judgeAudit.ts'
    if (-not (Test-Path $CliPath)) {
        throw "Judge audit CLI not found at: $CliPath"
    }

    # ── Resolve debate files ─────────────────────────────
    if ($PSCmdlet.ParameterSetName -eq 'Auto') {
        try {
            $DebatesDir = Get-DebatesDir
        } catch {
            throw "Cannot locate debates directory. Set AI_TRIAD_DATA_ROOT or check .aitriad.json."
        }

        $AllDebateFiles = Get-ChildItem -Path $DebatesDir -Filter 'debate-*.json' -File
        if ($AllDebateFiles.Count -eq 0) {
            throw "No debate files found in $DebatesDir"
        }

        # Rank by number of validated turns (debates with turn_validations are most interesting)
        $Ranked = $AllDebateFiles | ForEach-Object {
            try {
                $D = Get-Content $_.FullName -Raw | ConvertFrom-Json -ErrorAction Stop
                $StmtCount = ($D.transcript | Where-Object { $_.type -eq 'statement' -or $_.type -eq 'opening' }).Count
                $TvCount = if ($D.turn_validations) { ($D.turn_validations.PSObject.Properties).Count } else { 0 }
                [PSCustomObject]@{
                    Path       = $_.FullName
                    Title      = ($D.title ?? '').Substring(0, [Math]::Min(60, ($D.title ?? '').Length))
                    Statements = $StmtCount
                    Validated  = $TvCount
                }
            } catch {
                $null
            }
        } | Where-Object { $_ -ne $null -and $_.Statements -ge 6 } |
            Sort-Object -Property Validated -Descending

        if ($All) {
            $Selected = $Ranked | Where-Object { $_.Validated -gt 0 }
        } else {
            $Selected = $Ranked | Select-Object -First $DebateCount
        }

        if ($Selected.Count -eq 0) {
            throw "No debates with enough statement turns found."
        }

        Write-Host "Selected $($Selected.Count) debate(s):" -ForegroundColor Cyan
        $Selected | ForEach-Object {
            Write-Host "  $($_.Statements) turns | $($_.Validated) validated | $($_.Title)" -ForegroundColor DarkCyan
        }
        Write-Host ""

        $DebatePaths = $Selected | ForEach-Object { $_.Path }
    } else {
        $DebatePaths = $DebatePath | ForEach-Object {
            $Resolved = Resolve-Path $_ -ErrorAction SilentlyContinue
            if (-not $Resolved) { throw "Debate file not found: $_" }
            $Resolved.Path
        }
    }

    # ── Build CLI arguments ──────────────────────────────
    $DebateArgs = ($DebatePaths | ForEach-Object { "--debate `"$_`"" }) -join ' '
    $FullArgs = "tsx `"$CliPath`" $DebateArgs --models $Models --max-turns $MaxTurnsPerDebate"

    if ($OutputPath) {
        $ResolvedOutput = Join-Path $PWD $OutputPath
        $FullArgs += " --output `"$ResolvedOutput`""
    }

    Write-Host "Running judge audit: $($DebatePaths.Count) debate(s), models=$Models" -ForegroundColor Yellow
    Write-Host ""

    # ── Execute ──────────────────────────────────────────
    $Psi = [System.Diagnostics.ProcessStartInfo]::new()
    $Psi.FileName = $NpxCmd.Source
    $Psi.Arguments = $FullArgs
    $Psi.WorkingDirectory = $RepoRoot
    $Psi.RedirectStandardOutput = $true
    $Psi.RedirectStandardError = $true
    $Psi.UseShellExecute = $false
    $Psi.CreateNoWindow = $true

    try {
        $Proc = [System.Diagnostics.Process]::Start($Psi)
    } catch {
        throw "Failed to start judge audit process: $_"
    }

    # Stream progress from stderr
    while (-not $Proc.StandardError.EndOfStream) {
        $Line = $Proc.StandardError.ReadLine()
        if ($Line) { Write-Host $Line -ForegroundColor DarkGray }
    }

    $StdOut = $Proc.StandardOutput.ReadToEnd()
    if (-not $Proc.WaitForExit(1200000)) {
        try { $Proc.Kill() } catch { }
        throw "Judge audit timed out after 20 minutes."
    }

    if ($Proc.ExitCode -ne 0 -and -not $StdOut) {
        throw "Judge audit failed with exit code $($Proc.ExitCode)."
    }

    # ── Return result ────────────────────────────────────
    if ($OutputPath) {
        Write-Host "`nReport saved to: $ResolvedOutput" -ForegroundColor Green
        return Get-Item $ResolvedOutput
    }

    if ($StdOut) {
        try {
            return $StdOut | ConvertFrom-Json
        } catch {
            return $StdOut
        }
    }
}
