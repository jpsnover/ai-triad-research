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
    .EXAMPLE
        Invoke-DebateBatch -ConfigPath lib/debate/exp-1069-batch.json
    .EXAMPLE
        # In one terminal:
        Invoke-DebateBatch -ConfigPath lib/debate/exp-1069-batch.json
        # In another terminal:
        Watch-DebateProgress -Path <output>/debate-progress.json
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
        [switch]$StopOnFailure
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

    foreach ($D in $Debates) {
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
