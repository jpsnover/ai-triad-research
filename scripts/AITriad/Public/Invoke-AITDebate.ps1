# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Runs a structured multi-perspective AI debate using the shared debate library.
.DESCRIPTION
    Orchestrates a full debate with Accelerationist (accelerationist), Safetyist (safetyist),
    and Skeptic (skeptic) POVers. Produces debate transcript, diagnostics, and harvest
    output files. Uses the same prompts, logic, and argumentation framework as the
    Taxonomy Editor's debate tool.
.PARAMETER FeatureFlags
    Hashtable of feature flags applied for the run. Known keys (case-insensitive):
    Clarification, Probing, SalienceBeacon, ExploreFirst, AdaptiveStaging,
    EarlyTermination, TurnValidation. Unknown keys throw an ActionableError.
    Explicit switches (-Clarify, -Probe, -AdaptiveStaging, -DisableTurnValidation)
    take precedence over the hashtable when both are provided.
.PARAMETER ConfrontationRounds
    Max rounds for the confrontation phase (1-10). When specified without
    -AdaptiveStaging, disables adaptive staging automatically so these counts
    are treated as hard limits.
.PARAMETER ArgumentationRounds
    Max rounds for the argumentation phase (1-10). When specified without
    -AdaptiveStaging, disables adaptive staging automatically so these counts
    are treated as hard limits.
.PARAMETER ConcludingRounds
    Max rounds for the concluding phase (1-10). When specified without
    -AdaptiveStaging, disables adaptive staging automatically so these counts
    are treated as hard limits.
.EXAMPLE
    Invoke-AITDebate -Topic "Should the US impose AI licensing?" -Rounds 3
.EXAMPLE
    Invoke-AITDebate -Topic "Scaling limits" -Name "Scaling Debate" -Rounds 4 -Model gemini-3.1-flash-lite
.EXAMPLE
    Invoke-AITDebate -DocPath ../ai-triad-data/sources/my-doc/snapshot.md -Name "My Doc Debate"
.EXAMPLE
    Invoke-AITDebate -CrossCuttingNodeId sit-005 -Clarify -Probe
.EXAMPLE
    Invoke-AITDebate -Topic "AI liability" -FeatureFlags @{ Clarification = $true; Probing = $true; SalienceBeacon = $true }
.EXAMPLE
    Invoke-AITDebate -Topic "AI liability" -ConfrontationRounds 2 -ArgumentationRounds 3 -ConcludingRounds 1
.LINK
    Show-AITriadHelp
.LINK
    Show-TriadDialogue
.LINK
    Get-AITDebate
.LINK
    Resume-AITDebate
.LINK
    Repair-DebateOutput
.LINK
    Watch-DebateProgress
.LINK
    Invoke-DebateBatch
#>
function Invoke-AITDebate {
    [CmdletBinding(DefaultParameterSetName = 'Topic')]
    param(
        [Parameter(Mandatory, ParameterSetName = 'Topic', Position = 0)]
        [string]$Topic,

        [Parameter(Mandatory, ParameterSetName = 'Document')]
        [ValidateScript({ Test-Path $_ })]
        [Alias('DocumentPath', 'Path')]
        [string]$DocPath,

        [Parameter(Mandatory, ParameterSetName = 'Url')]
        [string]$Url,

        [Parameter(Mandatory, ParameterSetName = 'CrossCutting')]
        [string]$CrossCuttingNodeId,

        [Parameter()]
        [string]$Name,

        [Parameter()]
        [ValidateSet('Accelerationist', 'Safetyist', 'Skeptic')]
        [string[]]$Debaters = @('Accelerationist', 'Safetyist', 'Skeptic'),

        [Parameter()]
        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [string]$Model,

        [Parameter()]
        [ValidateRange(1, 20)]
        [int]$Rounds = 3,

        [Parameter()]
        [ValidateSet('brief', 'medium', 'detailed')]
        [string]$ResponseLength = 'medium',

        [Parameter()]
        [ValidateSet('structured', 'socratic', 'deliberation')]
        [string]$Protocol = 'structured',

        [Parameter()]
        [switch]$Clarify,

        [Parameter()]
        [switch]$Probe,

        [Parameter()]
        [int]$ProbeEvery = 2,

        [Parameter()]
        [Alias('OutputPath')]
        [string]$OutputDirectory,

        [Parameter()]
        [ValidateSet('json', 'markdown')]
        [string]$OutputFormat = 'json',

        [Parameter()]
        [string]$ApiKey,

        [Parameter()]
        [double]$Temperature = 0.3,

        [Parameter()]
        [switch]$DisableTurnValidation,

        [Parameter()]
        [ValidateSet(0, 1, 2)]
        [int]$MaxTurnRetries = 2,

        [Parameter()]
        [switch]$AdaptiveStaging,

        [Parameter()]
        [hashtable]$StageModels,

        # Path to a shared debate-progress.json file. When set, this run writes
        # status + per-turn updates to that file (see Update-DebateProgress).
        # Watch with: Watch-DebateProgress -Path <path>
        [Parameter()]
        [string]$ProgressFile,

        # Debate name to use when writing progress. Defaults to the slug.
        [Parameter()]
        [string]$ProgressDebateName,

        # Batch name to set on the progress file on first write.
        [Parameter()]
        [string]$ProgressBatchName,

        # Per-phase round caps. Each phase is "rounds" where every active debater gets one turn,
        # so total LLM calls per phase ≈ rounds × debater count. Only applied when -AdaptiveStaging
        # is on (phaseBoundsOverride is an adaptive-staging concept).
        [Parameter()]
        [ValidateRange(1, 10)]
        [int]$ConfrontationRounds,

        [Parameter()]
        [ValidateRange(1, 10)]
        [int]$ArgumentationRounds,

        [Parameter()]
        [ValidateRange(1, 10)]
        [int]$ConcludingRounds,

        # Feature flags as a hashtable. Known keys (case-insensitive):
        #   Clarification, Probing, SalienceBeacon, ExploreFirst,
        #   AdaptiveStaging, EarlyTermination, TurnValidation
        # Values are coerced to bool. Unknown keys throw an ActionableError so typos surface
        # rather than silently no-op (the same class of bug as the claude-sonnet-4-5 silent
        # failure in New-SyntheticCorpus).
        [Parameter()]
        [hashtable]$FeatureFlags
    )

    Set-StrictMode -Version Latest

    # ── Resolve FeatureFlags onto known switches ────────────
    # Cmdlet-level switches (-Clarify, -Probe, -AdaptiveStaging) take precedence when
    # set, so callers can override the hashtable without removing keys from it.
    $KnownFlagMap = @{
        clarification    = 'Clarify'
        probing          = 'Probe'
        saliencebeacon   = 'SalienceBeacon'
        explorefirst     = 'ExploreFirst'
        adaptivestaging  = 'AdaptiveStaging'
        earlytermination = 'AllowEarlyTermination'
        turnvalidation   = 'TurnValidation'  # inverted into DisableTurnValidation below
    }
    $FlagSalienceBeacon = $false
    $FlagExploreFirst = $false
    $FlagAllowEarlyTermination = $false
    $FlagTurnValidationExplicit = $false
    $FlagTurnValidation = $true
    if ($FeatureFlags) {
        foreach ($Key in $FeatureFlags.Keys) {
            $LowerKey = $Key.ToString().ToLower()
            if (-not $KnownFlagMap.ContainsKey($LowerKey)) {
                New-ActionableError `
                    -Goal     'Apply feature flags to debate run' `
                    -Problem  "Unknown feature flag '$Key'" `
                    -Location 'Invoke-AITDebate -FeatureFlags' `
                    -NextSteps "Use one of: $(($KnownFlagMap.Values | Sort-Object) -join ', '). Keys are case-insensitive." `
                    -Throw
            }
            $Value = [bool]$FeatureFlags[$Key]
            switch ($LowerKey) {
                'clarification'    { if (-not $PSBoundParameters.ContainsKey('Clarify'))         { $Clarify        = $Value } }
                'probing'          { if (-not $PSBoundParameters.ContainsKey('Probe'))           { $Probe          = $Value } }
                'adaptivestaging'  { if (-not $PSBoundParameters.ContainsKey('AdaptiveStaging')) { $AdaptiveStaging = $Value } }
                'saliencebeacon'   { $FlagSalienceBeacon = $Value }
                'explorefirst'     { $FlagExploreFirst = $Value }
                'earlytermination' { $FlagAllowEarlyTermination = $Value }
                'turnvalidation'   { $FlagTurnValidation = $Value; $FlagTurnValidationExplicit = $true }
            }
        }
    }
    # -DisableTurnValidation switch wins if explicitly set; otherwise honor flag
    if (-not $PSBoundParameters.ContainsKey('DisableTurnValidation') -and $FlagTurnValidationExplicit) {
        $DisableTurnValidation = -not $FlagTurnValidation
    }

    # ── Validate prerequisites ────────────────────────────
    if ($Debaters.Count -lt 2) {
        throw "At least 2 debaters are required. Got: $($Debaters -join ', ')"
    }

    # Verify npx is available (prefer .cmd on Windows — .ps1 can't be launched via Process.Start)
    $NpxCmd = Get-Command npx.cmd -ErrorAction SilentlyContinue
    if (-not $NpxCmd) { $NpxCmd = Get-Command npx -ErrorAction SilentlyContinue }
    if (-not $NpxCmd) {
        throw @"
npx (Node.js package runner) is not installed.
Required to run the debate CLI engine.
Install Node.js from https://nodejs.org (v18+), then verify: npx --version
"@
    }

    # Resolve model
    if ($Model) { $ResolvedModel = $Model }
    elseif ($env:AI_MODEL) { $ResolvedModel = $env:AI_MODEL }
    else { $ResolvedModel = 'gemini-3.1-flash-lite' }
    Write-Verbose "Model resolved: $ResolvedModel (source: $(if ($Model) {'parameter'} elseif ($env:AI_MODEL) {'env:AI_MODEL'} else {'default'}))"

    # ── Resolve output directory ──────────────────────────
    if (-not $OutputDirectory) {
        try {
            $DebatesDir = Get-DebatesDir
            $OutputDirectory = Join-Path $DebatesDir 'cli-runs'
        } catch {
            $OutputDirectory = Join-Path $PWD 'debates'
        }
    }
    Write-Verbose "Output directory: $OutputDirectory"
    if (-not (Test-Path $OutputDirectory)) {
        try {
            $null = New-Item -Path $OutputDirectory -ItemType Directory -Force -ErrorAction Stop
        } catch {
            throw "Failed to create output directory '$OutputDirectory': $_`nCheck that the parent directory exists and you have write permissions."
        }
    }

    # ── Generate slug ─────────────────────────────────────
    $DebateTopic = switch ($PSCmdlet.ParameterSetName) {
        'Topic'        { $Topic }
        'Document'     { "Document debate: $(Split-Path $DocPath -Leaf)" }
        'Url'          { "URL debate: $Url" }
        'CrossCutting' { "Cross-cutting: $CrossCuttingNodeId" }
    }

    if ($Name) { $SlugSource = $Name } else { $SlugSource = $DebateTopic }
    $Slug = New-Slug -Text $SlugSource

    # ── Build config JSON ─────────────────────────────────
    $Config = @{
        activePovers       = @($Debaters | ForEach-Object { $_.ToLower() })
        model              = $ResolvedModel
        rounds             = $Rounds
        responseLength     = $ResponseLength
        protocolId         = $Protocol
        enableClarification = [bool]$Clarify
        enableProbing      = [bool]$Probe
        probingInterval    = $ProbeEvery
        outputDir          = (Resolve-Path $OutputDirectory).Path
        outputFormat       = $OutputFormat
        slug               = $Slug
        temperature        = $Temperature
    }

    if ($Name) { $Config.name = $Name }

    switch ($PSCmdlet.ParameterSetName) {
        'Topic'        { $Config.topic = $Topic }
        'Document'     { $Config.docPath = (Resolve-Path $DocPath).Path }
        'Url'          { $Config.url = $Url }
        'CrossCutting' { $Config.crossCuttingId = $CrossCuttingNodeId }
    }

    if ($ApiKey) { $Config.apiKey = $ApiKey }
    if ($AdaptiveStaging) { $Config.useAdaptiveStaging = $true }
    if ($StageModels) { $Config.stageModels = $StageModels }
    if ($FlagSalienceBeacon) { $Config.salienceBeacon = $true }
    if ($FlagExploreFirst) { $Config.exploreFirst = $true }
    if ($FlagAllowEarlyTermination) { $Config.allowEarlyTermination = $true }

    # Per-phase round caps. Two paths:
    #   - With -AdaptiveStaging: pass phaseBoundsOverride; engine treats caps as
    #     hard upper bounds that adaptive signals can exit early but never exceed.
    #   - Without -AdaptiveStaging (default): caps are treated as fixed-round
    #     hard limits. We sum them into -Rounds and disable adaptive staging,
    #     matching the docstring 'these counts are treated as hard limits'.
    #     Loses per-phase granularity (engine has no fixed-mode phase concept),
    #     but the total round count is honored exactly.
    $AnyPhaseCapSet = $PSBoundParameters.ContainsKey('ConfrontationRounds') -or
                      $PSBoundParameters.ContainsKey('ArgumentationRounds') -or
                      $PSBoundParameters.ContainsKey('ConcludingRounds')
    if ($AnyPhaseCapSet) {
        if ($AdaptiveStaging) {
            $PhaseBoundsOverride = @{}
            if ($PSBoundParameters.ContainsKey('ConfrontationRounds')) { $PhaseBoundsOverride.maxConfrontationRounds = $ConfrontationRounds }
            if ($PSBoundParameters.ContainsKey('ArgumentationRounds')) { $PhaseBoundsOverride.maxArgumentationRounds = $ArgumentationRounds }
            if ($PSBoundParameters.ContainsKey('ConcludingRounds'))    { $PhaseBoundsOverride.maxConcludingRounds    = $ConcludingRounds }
            $Config.phaseBoundsOverride = $PhaseBoundsOverride
        } else {
            $PhaseSum = 0
            if ($PSBoundParameters.ContainsKey('ConfrontationRounds')) { $PhaseSum += $ConfrontationRounds }
            if ($PSBoundParameters.ContainsKey('ArgumentationRounds')) { $PhaseSum += $ArgumentationRounds }
            if ($PSBoundParameters.ContainsKey('ConcludingRounds'))    { $PhaseSum += $ConcludingRounds }
            if ($PSBoundParameters.ContainsKey('Rounds') -and $Rounds -ne $PhaseSum) {
                Write-Warning ("-Rounds={0} overridden by phase round caps (sum={1}). Use -AdaptiveStaging if you want phase bounds with a separate -Rounds ceiling." -f $Rounds, $PhaseSum)
            }
            Write-Verbose ("Per-phase caps sum to {0} rounds; adaptive staging stays off (hard-limit semantics)." -f $PhaseSum)
            $Config.rounds = $PhaseSum
        }
    }

    Write-Verbose "Config: topic='$DebateTopic' | slug=$Slug | rounds=$Rounds | protocol=$Protocol"
    Write-Verbose "Config: debaters=$($Debaters -join ',') | responseLength=$ResponseLength | temp=$Temperature"
    Write-Verbose "Config: clarify=$Clarify | probe=$Probe (every $ProbeEvery) | adaptiveStaging=$AdaptiveStaging"
    if ($StageModels) { Write-Verbose "Config: stageModels=$($StageModels | ConvertTo-Json -Compress)" }
    if ($DisableTurnValidation) { Write-Verbose "Config: turn validation DISABLED" }
    if ($MaxTurnRetries -ne 2) { Write-Verbose "Config: maxTurnRetries=$MaxTurnRetries" }

    # ── Write config temp file ────────────────────────────
    try {
        $ConfigPath = [System.IO.Path]::GetTempFileName()
        $Json = $Config | ConvertTo-Json -Depth 10
        Set-Content -Path $ConfigPath -Value $Json -Encoding utf8NoBOM -NoNewline
    } catch {
        throw "Failed to write debate config to temp file: $_`nCheck that $([System.IO.Path]::GetTempPath()) is writable and has free space."
    }

    try {
        # ── Locate CLI ────────────────────────────────────
        $RepoRoot = Get-CodeRoot
        $CliPath  = Join-Path (Join-Path (Join-Path $RepoRoot 'lib') 'debate') 'cli.ts'

        # t/1163: optional test seam — when AITRIAD_DEBATE_CLI_OVERRIDE is set,
        # bypass npx/tsx and shell out to that file via `pwsh -File ...` instead.
        # Lets PsBoundaryFaults tests inject canned stderr/exit codes without
        # running the real TypeScript engine.
        $UseOverride = -not [string]::IsNullOrWhiteSpace($env:AITRIAD_DEBATE_CLI_OVERRIDE)
        if ($UseOverride) {
            $CliPath = $env:AITRIAD_DEBATE_CLI_OVERRIDE
            Write-Verbose "CLI override active: $CliPath"
        }

        if (-not (Test-Path $CliPath)) {
            throw @"
Debate CLI not found at: $CliPath

Expected repo structure: lib/debate/cli.ts
Computed repo root: $RepoRoot

This usually means: (1) repo not checked out correctly, (2) lib/debate was not built, or (3) running from a non-standard location.
Verify the file exists: Get-Item '$CliPath'
"@
        }

        # ── Run the Node.js CLI ───────────────────────────
        $StdOut  = [System.Collections.Generic.List[string]]::new()
        $StdErr  = [System.Collections.Generic.List[string]]::new()

        $Psi = [System.Diagnostics.ProcessStartInfo]::new()
        $TvArgs = ''
        if ($DisableTurnValidation) { $TvArgs += ' --no-turn-validation' }
        if ($PSBoundParameters.ContainsKey('MaxTurnRetries')) { $TvArgs += " --max-turn-retries $MaxTurnRetries" }

        if ($UseOverride) {
            $PwshCmd = Get-Command pwsh -ErrorAction Stop
            $Psi.FileName = $PwshCmd.Source
            $Psi.Arguments = "-NoProfile -File `"$CliPath`" --config `"$ConfigPath`"$TvArgs"
        } else {
            $Psi.FileName = $NpxCmd.Source
            $Psi.Arguments = "tsx `"$CliPath`" --config `"$ConfigPath`"$TvArgs"
        }

        Write-Verbose "CLI: $($Psi.FileName) $($Psi.Arguments)"
        Write-Verbose "Working directory: $RepoRoot"
        $Psi.WorkingDirectory = $RepoRoot
        $Psi.RedirectStandardOutput = $true
        $Psi.RedirectStandardError  = $true
        $Psi.UseShellExecute = $false
        $Psi.CreateNoWindow = $true

        try {
            $Proc = [System.Diagnostics.Process]::Start($Psi)
        } catch {
            throw "Failed to start debate CLI process (npx tsx): $_`nVerify Node.js is installed and npx is in your PATH: npx --version"
        }

        # t/1170: drain stdout asynchronously so the OS pipe buffer never fills
        # while we're reading stderr line-by-line. Without this, a multi-MB
        # session JSON on stdout blocks the CLI write — main thread spins
        # forever in StandardError.ReadLine() waiting for stderr that never
        # comes (classic .NET Process stdout/stderr deadlock).
        $StdOutTask = $Proc.StandardOutput.ReadToEndAsync()

        # ── Progress file setup (t/1095) ──────────────────
        # When -ProgressFile is set, write per-turn updates so Watch-DebateProgress
        # (and any operator tailing the file) can see live state — fixes the 3h
        # silent-hang class of bug from exp-1069.
        $ProgressActive = -not [string]::IsNullOrWhiteSpace($ProgressFile)
        $EffectiveDebateName = if ($ProgressDebateName) { $ProgressDebateName } else { $Slug }
        $CurrentTurn = 0
        $TotalTurnsExpected = if ($AdaptiveStaging) { 0 } else { [int]$Rounds * @($Debaters).Count }
        if ($ProgressActive) {
            Write-Verbose "Progress file: $ProgressFile (debate=$EffectiveDebateName)"
            Update-DebateProgress -Path $ProgressFile -DebateName $EffectiveDebateName `
                -BatchName $ProgressBatchName -Fields @{
                    status               = 'running'
                    started_at           = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
                    current_turn         = 0
                    total_turns_expected = $TotalTurnsExpected
                    current_stage        = 'starting'
                    current_debater      = $null
                }
        }

        # Stream stderr for progress — parse per-round/phase info for -Verbose
        $CurrentRound = 0
        $RoundStartTime = [DateTime]::UtcNow
        while (-not $Proc.StandardError.EndOfStream) {
            $Line = $Proc.StandardError.ReadLine()
            if (-not $Line) { continue }
            $StdErr.Add($Line)

            # Parse CLI progress lines for verbose reporting
            if ($Line -match '\[debate-cli\]\s*\[(\w+)\]\s*(\w+)?:?\s*(.*)') {
                $Phase = $Matches[1]
                $Speaker = $Matches[2]
                $Message = $Matches[3].Trim()

                # Detect round transitions
                if ($Phase -match 'round_(\d+)' -or $Message -match 'Round\s+(\d+)') {
                    $NewRound = [int]($Matches[1])
                    if ($NewRound -ne $CurrentRound) {
                        if ($CurrentRound -gt 0) {
                            $RoundElapsed = [Math]::Round(([DateTime]::UtcNow - $RoundStartTime).TotalSeconds, 1)
                            Write-Verbose "  Round $CurrentRound completed in ${RoundElapsed}s"
                        }
                        $CurrentRound = $NewRound
                        $RoundStartTime = [DateTime]::UtcNow
                        Write-Verbose "Round $CurrentRound starting..."
                    }
                }

                # Per-speaker turn info
                if ($Speaker -and $Message) {
                    $Color = switch ($Speaker.ToLower()) {
                        'Accelerationist' { 'Green' }
                        'Safetyist'  { 'Red' }
                        'Skeptic' { 'Yellow' }
                        default     { 'DarkGray' }
                    }
                    Write-Host "  [$Phase] $Speaker`: $Message" -ForegroundColor $Color

                    # t/1095: each speaker line is a turn. Write progress so
                    # Watch-DebateProgress (and hung-detection) see liveness.
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
            }
            elseif ($Line -match '\[debate-cli\]\s*(.+)') {
                Write-Verbose "CLI: $($Matches[1])"
            }
            else {
                Write-Host $Line -ForegroundColor DarkGray
            }
        }
        # Final round timing
        if ($CurrentRound -gt 0) {
            $RoundElapsed = [Math]::Round(([DateTime]::UtcNow - $RoundStartTime).TotalSeconds, 1)
            Write-Verbose "  Round $CurrentRound completed in ${RoundElapsed}s"
        }

        # t/1170: await the async stdout drain kicked off after Process.Start.
        # The task has been pulling stdout into a buffer for the entire duration
        # of the stderr loop, so this either returns immediately (stdout already
        # fully read) or completes within a few ms of the CLI exiting.
        $StdOutText = $StdOutTask.GetAwaiter().GetResult()

        # Wait with timeout (10 minutes max for a full debate)
        if (-not $Proc.WaitForExit(600000)) {
            try { $Proc.Kill() } catch { }
            throw @"
Debate CLI process timed out after 10 minutes.
This may indicate: the AI API is unresponsive, the model is overloaded, or the debate has too many rounds.
Try: reduce -Rounds, use a faster -Model, or check your API key and network connectivity.
Stderr output:
$($StdErr -join "`n" | Select-Object -Last 20)
"@
        }

        if ($StdOutText) { $StdOut.Add($StdOutText) }

        # ── Parse result ──────────────────────────────────
        $ResultJson = $StdOut -join "`n"

        # t/1123: non-zero exit is always a CLI failure — surface the original error
        # immediately, don't fall through to the JSON parser (which would throw a
        # confusing "Failed to parse JSON" error that masks the real cause).
        if ($Proc.ExitCode -ne 0) {
            # t/1163: if the CLI emitted an ActionableError JSON line on stderr,
            # render its fields directly instead of dumping a raw stderr tail.
            $Structured = Get-StructuredErrorFromStderr -StderrLines (@($StdErr))
            # Defensive: structured errors should be on stderr, but if a CLI
            # writes them to stdout instead, still surface them.
            if (-not $Structured -and $ResultJson) {
                $Structured = Get-StructuredErrorFromStderr -StderrLines @($ResultJson -split "`n")
            }
            if ($Structured) {
                $StepLines = (@($Structured.NextSteps) | ForEach-Object { "  - $_" }) -join "`n"
                throw @"
[Debate CLI ActionableError] (exit code $($Proc.ExitCode))
Goal:       $($Structured.Goal)
Problem:    $($Structured.Problem)
Location:   $($Structured.Location)
Next Steps:
$StepLines
"@
            }

            $StderrTail = (@($StdErr) | Select-Object -Last 20) -join "`n"
            $StdoutPreview = if ($ResultJson) {
                "Stdout preview (first 500 chars):`n$($ResultJson.Substring(0, [Math]::Min(500, $ResultJson.Length)))"
            } else { '(stdout was empty)' }
            throw @"
Debate CLI failed with exit code $($Proc.ExitCode).
Stderr (last 20 lines):
$StderrTail

$StdoutPreview

Troubleshooting:
  1. Check API key: ensure GEMINI_API_KEY (or ANTHROPIC_API_KEY/GROQ_API_KEY) is set
  2. Check model: verify '$ResolvedModel' is a valid model in ai-models.json
  3. Run with -Verbose for more detail
"@
        }

        if (-not $ResultJson) {
            throw @"
Debate CLI produced no output (exit code: $($Proc.ExitCode)).
Stderr:
$($StdErr -join "`n" | Select-Object -Last 20)

This usually means the CLI crashed before producing results. Run with -Verbose for debugging.
"@
        }

        try {
            $Result = $ResultJson | ConvertFrom-Json -ErrorAction Stop
        } catch {
            throw @"
Failed to parse debate CLI response as JSON: $_
First 300 chars of output: $($ResultJson.Substring(0, [Math]::Min(300, $ResultJson.Length)))

This usually means the CLI produced non-JSON output. Check stderr above for errors.
"@
        }

        if (-not $Result.success) {
            throw "Debate failed: $($Result.error)"
        }

        Write-Verbose "Debate complete: $($Result.stats.rounds) rounds, $($Result.stats.entries) entries, $($Result.stats.apiCalls) API calls"
        Write-Verbose "  Time: $([Math]::Round($Result.stats.totalTimeMs / 1000, 1))s | Claims: $($Result.stats.claimsAccepted) accepted, $($Result.stats.claimsRejected) rejected"
        Write-Verbose "  Files: debate=$($Result.files.debate)"
        Write-Verbose "         transcript=$($Result.files.transcript)"
        Write-Verbose "         diagnostics=$($Result.files.diagnostics)"
        if ($Result.files.harvest) { Write-Verbose "         harvest=$($Result.files.harvest)" }

        # t/1095: mark this debate done in the progress file
        if ($ProgressActive) {
            Update-DebateProgress -Path $ProgressFile -DebateName $EffectiveDebateName -Fields @{
                status = 'done'
            }
        }

        # ── Return structured result ──────────────────────
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
            Success         = $true
        }
    }
    catch {
        # t/1095: mark debate failed before rethrowing so Watch-DebateProgress sees it
        if ($ProgressActive) {
            Update-DebateProgress -Path $ProgressFile -DebateName $EffectiveDebateName -Fields @{
                status = 'failed'
                error  = $_.Exception.Message
            }
        }
        throw
    }
    finally {
        Remove-Item -Path $ConfigPath -ErrorAction SilentlyContinue
    }
}
