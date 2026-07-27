# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-DebateBatch {
    <#
    .SYNOPSIS
        Runs a batch of debates from a config file, with per-turn progress
        written to debate-progress.json so Watch-DebateProgress can see live
        state.
    .DESCRIPTION
        Walks a JSON batch config (shape: { name, debates: [{ name, topic, ... }] })
        and runs each debate serially via Invoke-AITDebate. Threads -ProgressFile
        through to each debate so a single shared progress file tracks the
        whole batch. Continues past a single failed debate (marks it 'failed',
        runs the rest) unless -StopOnFailure is set.

        Designed to replace the ad-hoc shell loops that ran exp-1069 etc.
        Fixes the 3-hour silent-hang problem by giving Watch-DebateProgress a
        file to poll.
    .PARAMETER ConfigPath
        Path to the batch config JSON. Required.
    .PARAMETER OutputDirectory
        Where to write per-debate outputs and the shared debate-progress.json.
        Defaults to <batch-config-dir>/<batch-name>.
    .PARAMETER ProgressFile
        Override path for debate-progress.json. Default: <OutputDirectory>/debate-progress.json.
    .PARAMETER StopOnFailure
        Halt the batch at the first failing debate. Default: continue past failures.
    .PARAMETER Synthetic
        Mark every debate in this batch as a synthetic/fixture run (t/1812). Sets the
        process env var AI_TRIAD_SYNTHETIC_CALIBRATION=1 around the run so the debate
        engine routes their calibration entries to calibration/fixtures/ instead of
        core/, keeping the real store (and the t/1668 replication gate) clean. This is
        the batch-wide default; it can also be set by a top-level "synthetic": true in
        the batch config, and is overridden PER-DEBATE by a "synthetic" field on any
        debate entry (so a mixed batch is classified per-debate, not blanket). The
        signal is toggled per debate and restored after the run so it never leaks to a
        later real debate in the same session. Do NOT tag real experiments (e.g.
        exp-1069) — that would misroute genuine calibration data and shrink the gate's n.
    .EXAMPLE
        Invoke-DebateBatch -ConfigPath lib/debate/exp-1069-batch.json
    .EXAMPLE
        # Smoke/fixture batch — tag its calibration as synthetic:
        Invoke-DebateBatch -ConfigPath lib/debate/smoke-batch.json -Synthetic
    .EXAMPLE
        # In one terminal:
        Invoke-DebateBatch -ConfigPath lib/debate/exp-1069-batch.json
        # In another terminal:
        Watch-DebateProgress -Path <output>/debate-progress.json
    .LINK
        Show-AITriadHelp
    .LINK
        Show-TriadDialogue
    .LINK
        Invoke-AITDebate
    .LINK
        Get-AITDebate
    .LINK
        Resume-AITDebate
    .LINK
        Repair-DebateOutput
    .LINK
        Watch-DebateProgress
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [ValidateScript({ Test-Path $_ })]
        [Alias('Path')]
        [string]$ConfigPath,

        [Parameter()]
        [Alias('OutputPath')]
        [string]$OutputDirectory,

        [Parameter()]
        [string]$ProgressFile,

        [Parameter()]
        [switch]$StopOnFailure,

        [Parameter()]
        [switch]$Synthetic
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── Load batch config ─────────────────────────────────────
    $Resolved = (Resolve-Path $ConfigPath).Path
    $Batch = Get-Content -Raw -Path $Resolved | ConvertFrom-Json
    if (-not $Batch.PSObject.Properties['debates']) {
        New-ActionableError `
            -Goal     'Run debate batch' `
            -Problem  "Batch config missing 'debates' array: $Resolved" `
            -Location 'Invoke-DebateBatch' `
            -NextSteps @("Add a 'debates' array to the config", 'See lib/debate/exp-1069-batch.json for an example') `
            -Throw
    }
    $Debates = @($Batch.debates)
    if ($Debates.Count -eq 0) {
        Write-Warning "Batch config has zero debates: $Resolved"
        return
    }

    $BatchName = if ($Batch.PSObject.Properties['name']) { [string]$Batch.name } else { [System.IO.Path]::GetFileNameWithoutExtension($Resolved) }

    # t/1812 — synthetic/fixture tagging. SELECTIVE + PER-DEBATE (TL p/24#148): a real
    # experiment (exp-1069) must NOT be tagged or its calibration misroutes to fixtures/
    # and shrinks the t/1668 gate's n. This is the batch-wide DEFAULT (authoritative:
    # -Synthetic switch or a top-level "synthetic": true); a per-debate "synthetic"
    # field in the config overrides it per debate in the loop below — never guessed, so
    # a mixed batch is classified per-debate, not blanket.
    $BatchSyntheticDefault = [bool]$Synthetic -or ($Batch.PSObject.Properties['synthetic'] -and [bool]$Batch.synthetic)

    # ── Resolve output dir + progress file ────────────────────
    if (-not $OutputDirectory) {
        $OutputDirectory = Join-Path (Split-Path -Parent $Resolved) $BatchName
    }
    if (-not (Test-Path $OutputDirectory)) {
        $null = New-Item -ItemType Directory -Path $OutputDirectory -Force
    }
    if (-not $ProgressFile) {
        $ProgressFile = Join-Path $OutputDirectory 'debate-progress.json'
    }

    Write-Host ''
    Write-Host "Debate batch: $BatchName  ($($Debates.Count) debates)" -ForegroundColor Cyan
    Write-Host "  Output:   $OutputDirectory"
    Write-Host "  Progress: $ProgressFile" -ForegroundColor Yellow
    Write-Host "  Watch with: Watch-DebateProgress -Path '$ProgressFile'" -ForegroundColor DarkGray
    Write-Host ''

    # ── Seed progress file with all debates as 'pending' ──────
    $DebateNames = @($Debates | ForEach-Object {
        if ($_.PSObject.Properties['name']) { [string]$_.name } else { 'unnamed' }
    })
    # Use the first debate name to bootstrap the file then seed the rest
    if ($DebateNames.Count -gt 0) {
        Update-DebateProgress -Path $ProgressFile -DebateName $DebateNames[0] `
            -BatchName $BatchName -Debates $DebateNames -Fields @{ status = 'pending' }
    }

    # ── Run each debate ───────────────────────────────────────
    $Results = [System.Collections.Generic.List[PSObject]]::new()
    $BatchStart = Get-Date

    # t/1812 — process-scoped synthetic signal, toggled PER-DEBATE below and restored in
    # finally so it never leaks to a real debate later in the same session. The engine
    # reads it PER-WRITE (calibrationLogger/io.ts isSyntheticRun at the appendCalibrationLog
    # funnel), and each Invoke-AITDebate spawns an engine child that inherits it at spawn.
    $PrevSynthEnv = $env:AI_TRIAD_SYNTHETIC_CALIBRATION
    try {
    foreach ($D in $Debates) {
        # Per-debate classification: an explicit per-debate "synthetic" field wins;
        # otherwise the batch-wide default. Set right before the Invoke-AITDebate spawn
        # (child inherits env), cleared for real debates so a mixed batch never over-tags.
        $DebateSynthetic = if ($D.PSObject.Properties['synthetic']) { [bool]$D.synthetic } else { $BatchSyntheticDefault }
        if ($DebateSynthetic) { $env:AI_TRIAD_SYNTHETIC_CALIBRATION = '1' }
        else { Remove-Item Env:AI_TRIAD_SYNTHETIC_CALIBRATION -ErrorAction SilentlyContinue }

        $Name = if ($D.PSObject.Properties['name']) { [string]$D.name } else { 'unnamed' }
        Write-Host "▶ $Name" -ForegroundColor Cyan

        # Build Invoke-AITDebate params from this debate's config
        $Params = @{
            ProgressFile       = $ProgressFile
            ProgressDebateName = $Name
            ProgressBatchName  = $BatchName
            OutputDirectory    = $OutputDirectory
            Name               = $Name
        }
        if ($D.PSObject.Properties['topic'])              { $Params.Topic           = [string]$D.topic }
        if ($D.PSObject.Properties['docPath'])            { $Params.DocPath         = [string]$D.docPath }
        if ($D.PSObject.Properties['url'])                { $Params.Url             = [string]$D.url }
        if ($D.PSObject.Properties['crossCuttingId'])     { $Params.CrossCuttingNodeId = [string]$D.crossCuttingId }
        if ($D.PSObject.Properties['model'])              { $Params.Model           = [string]$D.model }
        if ($D.PSObject.Properties['rounds'])             { $Params.Rounds          = [int]$D.rounds }
        if ($D.PSObject.Properties['responseLength'])     { $Params.ResponseLength  = [string]$D.responseLength }
        if ($D.PSObject.Properties['protocol'])           { $Params.Protocol        = [string]$D.protocol }
        if ($D.PSObject.Properties['adaptiveStaging'] -and $D.adaptiveStaging) { $Params.AdaptiveStaging = $true }
        if ($D.PSObject.Properties['temperature'])        { $Params.Temperature     = [double]$D.temperature }
        if ($D.PSObject.Properties['confrontationRounds']) { $Params.ConfrontationRounds = [int]$D.confrontationRounds }
        if ($D.PSObject.Properties['argumentationRounds']) { $Params.ArgumentationRounds = [int]$D.argumentationRounds }
        if ($D.PSObject.Properties['concludingRounds'])    { $Params.ConcludingRounds    = [int]$D.concludingRounds }
        if ($D.PSObject.Properties['featureFlags'] -and $D.featureFlags) {
            # ConvertFrom-Json yields PSCustomObject; coerce to hashtable for the param
            $Flags = @{}
            foreach ($Prop in $D.featureFlags.PSObject.Properties) { $Flags[$Prop.Name] = [bool]$Prop.Value }
            $Params.FeatureFlags = $Flags
        }

        try {
            $Result = Invoke-AITDebate @Params
            $Results.Add([PSCustomObject]@{ Name = $Name; Status = 'done'; Result = $Result; Error = $null })
        } catch {
            $ErrMsg = $_.Exception.Message
            Write-Warning "  ✗ $Name failed: $ErrMsg"
            $Results.Add([PSCustomObject]@{ Name = $Name; Status = 'failed'; Result = $null; Error = $ErrMsg })
            if ($StopOnFailure) {
                Write-Warning "Stopping batch due to -StopOnFailure"
                break
            }
        }
    }
    } finally {
        # Restore the pre-batch value so the synthetic signal never leaks to a later
        # real debate in the same session (t/1812).
        if ([string]::IsNullOrEmpty($PrevSynthEnv)) { Remove-Item Env:AI_TRIAD_SYNTHETIC_CALIBRATION -ErrorAction SilentlyContinue }
        else { $env:AI_TRIAD_SYNTHETIC_CALIBRATION = $PrevSynthEnv }
    }

    $BatchElapsed = ((Get-Date) - $BatchStart).TotalMinutes
    $Pass = @($Results | Where-Object { $_.Status -eq 'done' }).Count
    $Fail = @($Results | Where-Object { $_.Status -eq 'failed' }).Count

    Write-Host ''
    Write-Host ("Batch $BatchName complete: {0} done, {1} failed ({2:N1} min)" -f $Pass, $Fail, $BatchElapsed) `
        -ForegroundColor $(if ($Fail -eq 0) { 'Green' } else { 'Yellow' })

    [PSCustomObject]@{
        BatchName    = $BatchName
        ProgressFile = $ProgressFile
        Pass         = $Pass
        Fail         = $Fail
        ElapsedMin   = [Math]::Round($BatchElapsed, 2)
        Results      = @($Results)
    }
}
