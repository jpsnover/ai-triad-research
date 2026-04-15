# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Backfills temporal_scope and temporal_bound on factual_claims missing them.
.DESCRIPTION
    Scans all summaries for factual_claims without temporal_scope, batches them
    to an AI model for classification, and writes results back. Each claim gets:
      temporal_scope: current_state | predictive | historical | timeless
      temporal_bound: specific date/range or null
.PARAMETER DataRoot
    Path to the data root directory.
.PARAMETER Model
    AI model to use. Defaults to $env:AI_MODEL or gemini-3.1-flash-lite-preview.
.PARAMETER BatchSize
    Number of claims per AI call. Default 20.
.PARAMETER DryRun
    Report what would change without writing.
.PARAMETER MaxFiles
    Limit processing to first N files (for testing).
.EXAMPLE
    ./Invoke-TemporalScopeBackfill.ps1 -DataRoot '../ai-triad-data' -DryRun
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$DataRoot,

    [string]$Model,

    [int]$BatchSize = 20,

    [switch]$DryRun,

    [int]$MaxFiles = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path (Join-Path $ScriptDir 'AITriad') 'AITriad.psm1') -Force -ErrorAction Stop
Import-Module (Join-Path $ScriptDir 'AIEnrich.psm1') -Force -ErrorAction Stop

if (-not $Model) {
    if ($env:AI_MODEL) { $Model = $env:AI_MODEL } else { $Model = 'gemini-3.1-flash-lite-preview' }
}

$DataRoot = (Resolve-Path $DataRoot).Path
$SummariesDir = Join-Path $DataRoot 'summaries'

Write-Host "`n  TEMPORAL SCOPE BACKFILL" -ForegroundColor Cyan
Write-Host "  Model: $Model | Mode: $(if ($DryRun) { 'DRY RUN' } else { 'LIVE' })`n" -ForegroundColor Gray

# ── Scan for claims missing temporal_scope ────────────────────────────────────
$FilesToFix = [System.Collections.Generic.List[PSObject]]::new()
$TotalMissing = 0

foreach ($File in (Get-ChildItem -Path $SummariesDir -Filter '*.json' -File | Sort-Object Name)) {
    try {
        $Summary = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json
    }
    catch { continue }

    if (-not $Summary.factual_claims) { continue }

    $Missing = @()
    $Idx = 0
    foreach ($Claim in @($Summary.factual_claims)) {
        if (-not $Claim.PSObject.Properties['temporal_scope'] -or -not $Claim.temporal_scope) {
            $Missing += @{ Index = $Idx; Claim = $Claim }
        }
        $Idx++
    }

    if ($Missing.Count -gt 0) {
        $FilesToFix.Add([PSCustomObject]@{
            File    = $File
            Summary = $Summary
            Missing = $Missing
        })
        $TotalMissing += $Missing.Count
    }

    if ($MaxFiles -gt 0 -and $FilesToFix.Count -ge $MaxFiles) { break }
}

Write-Host "  Found $TotalMissing claims missing temporal_scope across $($FilesToFix.Count) files`n" -ForegroundColor Yellow

if ($TotalMissing -eq 0) {
    Write-Host "  Nothing to do." -ForegroundColor Green
    return
}

# ── Resolve API key ───────────────────────────────────────────────────────────
if ($Model -match '^gemini') { $Backend = 'gemini' }
elseif ($Model -match '^claude') { $Backend = 'claude' }
elseif ($Model -match '^groq') { $Backend = 'groq' }
else { $Backend = 'gemini' }

$ApiKey = Resolve-AIApiKey -ExplicitKey '' -Backend $Backend
if (-not $ApiKey) {
    Write-Error "No API key for backend '$Backend'"
    return
}

# ── Process in batches ────────────────────────────────────────────────────────
$Classified = 0
$Errors = 0

foreach ($Entry in $FilesToFix) {
    Write-Host "  $($Entry.File.BaseName): $($Entry.Missing.Count) claims..." -ForegroundColor Gray -NoNewline

    $ClaimTexts = @($Entry.Missing | ForEach-Object {
        $C = $_.Claim
        if ($C.PSObject.Properties['claim_label']) { $Label = $C.claim_label } else { $Label = '' }
        [ordered]@{
            index = $_.Index
            label = $Label
            claim = $C.claim
        }
    })

    # Batch into groups
    for ($i = 0; $i -lt $ClaimTexts.Count; $i += $BatchSize) {
        $Batch = $ClaimTexts[$i..([Math]::Min($i + $BatchSize - 1, $ClaimTexts.Count - 1))]
        $BatchJson = $Batch | ConvertTo-Json -Depth 5 -Compress

        $Prompt = @"
Classify each factual claim's temporal scope. Return JSON array with one object per claim:

temporal_scope — when this claim applies:
  "current_state" — describes how things are now
  "predictive" — forecasts a future state
  "historical" — references a past event
  "timeless" — a general principle not tied to time

temporal_bound — specific date/range or null:
  For current_state: "as of YYYY" or null
  For predictive: target date (e.g. "by 2030")
  For historical: event date (e.g. "2023-10-30")
  For timeless: null

Claims:
$BatchJson

Return ONLY a JSON array like:
[{"index": 0, "temporal_scope": "current_state", "temporal_bound": "as of 2025"}, ...]
"@

        if ($DryRun) {
            $Classified += $Batch.Count
            continue
        }

        try {
            $Result = Invoke-AIApi -Prompt $Prompt -Model $Model -ApiKey $ApiKey `
                -Temperature 0.1 -MaxTokens 4096 -JsonMode -TimeoutSec 60

            $ResponseText = $Result.Text -replace '^\s*```json\s*', '' -replace '\s*```\s*$', ''
            $Classifications = $ResponseText | ConvertFrom-Json

            foreach ($C in $Classifications) {
                $ClaimIdx = $C.index
                $TargetClaim = $Entry.Summary.factual_claims[$ClaimIdx]

                if ($TargetClaim) {
                    if ($TargetClaim.PSObject.Properties['temporal_scope']) {
                        $TargetClaim.temporal_scope = $C.temporal_scope
                    }
                    else {
                        $TargetClaim | Add-Member -NotePropertyName 'temporal_scope' -NotePropertyValue $C.temporal_scope -Force
                    }

                    if ($C.PSObject.Properties['temporal_bound']) { $Bound = $C.temporal_bound } else { $Bound = $null }
                    if ($TargetClaim.PSObject.Properties['temporal_bound']) {
                        $TargetClaim.temporal_bound = $Bound
                    }
                    else {
                        $TargetClaim | Add-Member -NotePropertyName 'temporal_bound' -NotePropertyValue $Bound -Force
                    }
                    $Classified++
                }
            }
        }
        catch {
            Write-Warning " API error: $($_.Exception.Message)"
            $Errors++
        }
    }

    # Write back
    if (-not $DryRun -and $Classified -gt 0) {
        $NewJson = $Entry.Summary | ConvertTo-Json -Depth 30
        $TmpPath = "$($Entry.File.FullName).tmp"
        Write-Utf8NoBom -Path $TmpPath -Value $NewJson  -NoNewline
        Move-Item -Path $TmpPath -Destination $Entry.File.FullName -Force
    }

    Write-Host " done" -ForegroundColor Green
}

Write-Host "`n  Classified: $Classified, Errors: $Errors" -ForegroundColor $(if ($Errors -gt 0) { 'Yellow' } else { 'Green' })
