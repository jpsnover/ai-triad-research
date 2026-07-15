# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Resume-AITDebate {
    <#
    .SYNOPSIS
        Finishes a debate that was interrupted mid-finalization from its
        round checkpoint, running only the missing tail.
    .DESCRIPTION
        Background: a 44-minute expensive debate (exp-brief-cite-flash,
        2026-06-29) was rendered unrecoverable when the host slept during
        finalization. t/1135 made debates crash-recoverable by retaining the
        `-partial.json` checkpoint until the final session JSON is durable +
        adding a `DebateEngine.resume()` static entry point. This cmdlet
        wraps that engine path: load the partial, run synthesis +
        post-synthesis passes only, persist the full session, return the
        normal Invoke-AITDebate result shape.

        Idempotent: if the partial already contains a synthesis transcript
        entry, the engine skips re-running synthesis and just re-persists.
    .PARAMETER From
        Path to the `-partial.json` checkpoint left behind by an interrupted
        debate. The file must contain the structured fields required by the
        engine's resume contract (transcript, argument_network, crux_tracker);
        an ActionableError is raised otherwise.
    .PARAMETER OutputDirectory
        Where to write the resumed session artifacts. Defaults to the
        directory containing the partial.
    .PARAMETER ProgressFile
        Optional. When set, this resumed run reports per-turn status to a
        shared progress file (so Watch-DebateProgress can see it).
    .PARAMETER ProgressDebateName
        Optional. Debate name to use in the progress file. Defaults to the
        partial's base filename (minus `-partial.json`).
    .EXAMPLE
        Resume-AITDebate -From ./debates/cli-runs/my-debate-partial.json
    .EXAMPLE
        # Run measurement on the resumed result
        $r = Resume-AITDebate -From <partial>
        $r | Measure-DebateQuality
    .LINK
        Show-AITriadHelp
    .LINK
        Show-TriadDialogue
    .LINK
        Invoke-AITDebate
    .LINK
        Get-AITDebate
    .LINK
        Repair-DebateOutput
    .LINK
        Watch-DebateProgress
    .LINK
        Invoke-DebateBatch
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [ValidateScript({ Test-Path $_ })]
        [Alias('Path', 'Checkpoint')]
        [string]$From,

        [Parameter()]
        [Alias('OutputPath')]
        [string]$OutputDirectory,

        [Parameter()]
        [string]$ProgressFile,

        [Parameter()]
        [string]$ProgressDebateName
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── Validate checkpoint contract ──────────────────────────
    $CheckpointPath = (Resolve-Path $From).Path
    try {
        $Checkpoint = Get-Content -Raw -Path $CheckpointPath | ConvertFrom-Json -ErrorAction Stop
    } catch {
        New-ActionableError `
            -Goal     'Resume debate from checkpoint' `
            -Problem  "Failed to parse checkpoint as JSON: $($_.Exception.Message)" `
            -Location 'Resume-AITDebate' `
            -NextSteps @(
                "Verify the file is a valid debate -partial.json checkpoint",
                "Path: $CheckpointPath"
            ) -Throw
    }

    $MissingFields = [System.Collections.Generic.List[string]]::new()
    foreach ($field in 'transcript', 'argument_network', 'crux_tracker') {
        if (-not $Checkpoint.PSObject.Properties[$field]) { $MissingFields.Add($field) }
    }
    if (@($MissingFields).Count -gt 0) {
        New-ActionableError `
            -Goal     'Resume debate from checkpoint' `
            -Problem  "Checkpoint missing required structured fields: $($MissingFields -join ', ')" `
            -Location 'Resume-AITDebate' `
            -NextSteps @(
                "The resume contract (CL spec, t/1135) requires transcript + argument_network + crux_tracker",
                'Older checkpoints from before t/1135 are not resumable; the debate must be re-run from scratch',
                "Path: $CheckpointPath"
            ) -Throw
    }

    # ── Verify npx is available ──────────────────────────────
    $NpxCmd = Get-Command npx.cmd -ErrorAction SilentlyContinue
    if (-not $NpxCmd) { $NpxCmd = Get-Command npx -ErrorAction SilentlyContinue }
    if (-not $NpxCmd) {
        New-ActionableError `
            -Goal     'Resume debate from checkpoint' `
            -Problem  'npx (Node.js package runner) is not installed' `
            -Location 'Resume-AITDebate' `
            -NextSteps @('Install Node.js from https://nodejs.org (v18+), then verify: npx --version') `
            -Throw
    }

    # ── Resolve output directory + progress wiring ───────────
    if (-not $OutputDirectory) {
        $OutputDirectory = Split-Path -Parent $CheckpointPath
    }
    if (-not (Test-Path $OutputDirectory)) {
        $null = New-Item -ItemType Directory -Path $OutputDirectory -Force
    }
    $ResolvedOutputDir = (Resolve-Path $OutputDirectory).Path

    $EffectiveDebateName = if ($ProgressDebateName) { $ProgressDebateName }
                           else { [System.IO.Path]::GetFileNameWithoutExtension($CheckpointPath) -replace '-partial$', '' }
    $ProgressActive = -not [string]::IsNullOrWhiteSpace($ProgressFile)
    if ($ProgressActive) {
        Update-DebateProgress -Path $ProgressFile -DebateName $EffectiveDebateName -Fields @{
            status        = 'running'
            started_at    = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
            current_stage = 'resuming'
        }
    }

    # ── Locate the CLI ───────────────────────────────────────
    $RepoRoot = Get-CodeRoot
    $CliPath  = Join-Path (Join-Path (Join-Path $RepoRoot 'lib') 'debate') 'cli.ts'
    if (-not (Test-Path $CliPath)) {
        New-ActionableError `
            -Goal     'Resume debate from checkpoint' `
            -Problem  "Debate CLI not found at: $CliPath" `
            -Location 'Resume-AITDebate' `
            -NextSteps @('Verify lib/debate/cli.ts exists in the repo', "Repo root: $RepoRoot") `
            -Throw
    }

    Write-Verbose "Resuming from: $CheckpointPath"
    Write-Verbose "Output dir:    $ResolvedOutputDir"
    Write-Verbose "CLI:           $CliPath"

    # ── Spawn npx tsx <cli> --resume <partial> ───────────────
    $StdOut = [System.Collections.Generic.List[string]]::new()
    $StdErr = [System.Collections.Generic.List[string]]::new()
    $Psi = [System.Diagnostics.ProcessStartInfo]::new()
    $Psi.FileName = $NpxCmd.Source
    $Psi.Arguments = "tsx `"$CliPath`" --resume `"$CheckpointPath`""
    $Psi.WorkingDirectory = $RepoRoot
    $Psi.RedirectStandardOutput = $true
    $Psi.RedirectStandardError  = $true
    $Psi.UseShellExecute = $false
    $Psi.CreateNoWindow = $true

    try {
        $Proc = [System.Diagnostics.Process]::Start($Psi)
    } catch {
        New-ActionableError `
            -Goal     'Resume debate from checkpoint' `
            -Problem  "Failed to start debate CLI process (npx tsx): $($_.Exception.Message)" `
            -Location 'Resume-AITDebate' `
            -NextSteps @('Verify Node.js is installed and npx is in PATH: npx --version') `
            -Throw
    }

    # t/1170: drain stdout asynchronously so the OS pipe buffer never fills
    # while we're reading stderr line-by-line (classic .NET Process stdout/stderr
    # deadlock fix — multi-MB session JSON on stdout would otherwise block the
    # CLI write and keep stderr from EOF-ing).
    $StdOutTask = $Proc.StandardOutput.ReadToEndAsync()

    try {
        # Stream stderr for progress + Verbose
        $CurrentTurn = 0
        while (-not $Proc.StandardError.EndOfStream) {
            $Line = $Proc.StandardError.ReadLine()
            if (-not $Line) { continue }
            $StdErr.Add($Line)

            if ($Line -match '\[debate-cli\]\s*\[(\w+)\]\s*(\w+)?:?\s*(.*)') {
                $Phase = $Matches[1]; $Speaker = $Matches[2]; $Message = $Matches[3].Trim()
                if ($Speaker -and $Message) {
                    $Color = switch ($Speaker.ToLower()) {
                        'accelerationist' { 'Green' }
                        'safetyist'  { 'Red' }
                        'skeptic' { 'Yellow' }
                        default     { 'DarkGray' }
                    }
                    Write-Host "  [$Phase] $Speaker`: $Message" -ForegroundColor $Color
                    if ($ProgressActive) {
                        $CurrentTurn++
                        Update-DebateProgress -Path $ProgressFile -DebateName $EffectiveDebateName -Fields @{
                            status          = 'running'
                            current_turn    = $CurrentTurn
                            current_stage   = $Phase
                            current_debater = $Speaker
                        }
                    }
                } else {
                    Write-Host "  $Line" -ForegroundColor DarkGray
                }
            } elseif ($Line -match '\[debate-cli\]\s*(.+)') {
                Write-Verbose "CLI: $($Matches[1])"
            } else {
                Write-Host $Line -ForegroundColor DarkGray
            }
        }

        # t/1170: await the async stdout drain kicked off after Process.Start.
        $StdOutText = $StdOutTask.GetAwaiter().GetResult()
        if (-not $Proc.WaitForExit(600000)) {
            try { $Proc.Kill() } catch { }
            throw "Debate CLI process timed out after 10 minutes during resume. Stderr tail:`n$(($StdErr | Select-Object -Last 20) -join "`n")"
        }
        if ($StdOutText) { $StdOut.Add($StdOutText) }
        $ResultJson = $StdOut -join "`n"

        if ($Proc.ExitCode -ne 0) {
            $StderrTail = (@($StdErr) | Select-Object -Last 20) -join "`n"
            $StdoutPreview = if ($ResultJson) {
                "Stdout preview (first 500 chars):`n$($ResultJson.Substring(0, [Math]::Min(500, $ResultJson.Length)))"
            } else { '(stdout was empty)' }
            throw @"
Debate CLI resume failed with exit code $($Proc.ExitCode).
Stderr (last 20 lines):
$StderrTail

$StdoutPreview
"@
        }

        if (-not $ResultJson) {
            throw "Debate CLI produced no output during resume (exit $($Proc.ExitCode)). Stderr tail:`n$(($StdErr | Select-Object -Last 20) -join "`n")"
        }

        try {
            $Result = $ResultJson | ConvertFrom-Json -ErrorAction Stop
        } catch {
            throw "Failed to parse debate CLI response as JSON during resume: $($_.Exception.Message). First 300 chars: $($ResultJson.Substring(0, [Math]::Min(300, $ResultJson.Length)))"
        }

        if (-not $Result.success) {
            throw "Resume reported failure: $($Result.error)"
        }

        if ($ProgressActive) {
            Update-DebateProgress -Path $ProgressFile -DebateName $EffectiveDebateName -Fields @{ status = 'done' }
        }

        Write-Verbose "Resume complete: $($Result.stats.rounds) rounds (existing), $($Result.stats.entries) entries"
        Write-Verbose "  Files: debate=$($Result.files.debate)"

        [PSCustomObject]@{
            DebateId        = $Result.debateId
            Name            = $Result.name
            Slug            = $Result.slug
            Topic           = $Result.topic
            DebateFile      = $Result.files.debate
            TranscriptFile  = $Result.files.transcript
            DiagnosticsFile = $Result.files.diagnostics
            HarvestFile     = $Result.files.harvest
            MarkdownFile    = $Result.files.markdown
            Rounds          = $Result.stats.rounds
            Entries         = $Result.stats.entries
            ApiCalls        = $Result.stats.apiCalls
            TotalTimeMs     = $Result.stats.totalTimeMs
            ClaimsAccepted  = $Result.stats.claimsAccepted
            ClaimsRejected  = $Result.stats.claimsRejected
            SessionPath     = $Result.files.debate
            Resumed         = $true
            Success         = $true
        }
    } catch {
        if ($ProgressActive) {
            Update-DebateProgress -Path $ProgressFile -DebateName $EffectiveDebateName -Fields @{
                status = 'failed'
                error  = $_.Exception.Message
            }
        }
        throw
    }
}
