# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Backfills argument_map on debate files missing it.
.DESCRIPTION
    Scans debates for missing argument_map field. For each, reads the debate
    transcript and calls an AI model to extract claims and map relationships
    (attack_type, scheme). Writes the argument_map back to the debate file.
.PARAMETER DataRoot
    Path to the data root directory.
.PARAMETER Model
    AI model to use.
.PARAMETER DryRun
    Report what would change without writing.
.PARAMETER MaxDebates
    Limit processing to first N debates (for testing).
.EXAMPLE
    ./Invoke-ArgumentMapBackfill.ps1 -DataRoot '../ai-triad-data' -DryRun
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$DataRoot,

    [string]$Model,

    [switch]$DryRun,

    [int]$MaxDebates = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path (Join-Path $ScriptDir 'AITriad') 'AITriad.psm1') -Force -ErrorAction Stop
Import-Module (Join-Path $ScriptDir 'AIEnrich.psm1') -Force -ErrorAction Stop

if (-not $Model) {
    if ($env:AI_MODEL) { $Model = $env:AI_MODEL } else { $Model = 'gemini-2.5-flash' }
}

$DataRoot = (Resolve-Path $DataRoot).Path
$DebatesDir = Join-Path $DataRoot 'debates'

Write-Host "`n  ARGUMENT MAP BACKFILL" -ForegroundColor Cyan
Write-Host "  Model: $Model | Mode: $(if ($DryRun) { 'DRY RUN' } else { 'LIVE' })`n" -ForegroundColor Gray

# ── Scan for debates missing argument_map ─────────────────────────────────────
$DebatesToFix = [System.Collections.Generic.List[PSObject]]::new()

if (-not (Test-Path $DebatesDir)) {
    Write-Host "  No debates directory found." -ForegroundColor Yellow
    return
}

foreach ($File in (Get-ChildItem -Path $DebatesDir -Filter '*.json' -File | Sort-Object Name)) {
    try {
        $Debate = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json
    }
    catch { continue }

    $HasArgMap = $Debate.PSObject.Properties['argument_map'] -and $Debate.argument_map
    if (-not $HasArgMap) {
        $DebatesToFix.Add([PSCustomObject]@{
            File   = $File
            Debate = $Debate
        })
    }

    if ($MaxDebates -gt 0 -and $DebatesToFix.Count -ge $MaxDebates) { break }
}

Write-Host "  Found $($DebatesToFix.Count) debates missing argument_map`n" -ForegroundColor Yellow

if ($DebatesToFix.Count -eq 0) {
    Write-Host "  Nothing to do." -ForegroundColor Green
    return
}

if ($DryRun) {
    foreach ($D in $DebatesToFix) {
        if ($D.Debate.PSObject.Properties['topic']) { $Topic = $D.Debate.topic } else { $Topic = $D.File.BaseName }
        if ($D.Debate.PSObject.Properties['entries']) { $Entries = @($D.Debate.entries).Count } else { $Entries = 0 }
        Write-Host "  [DRY RUN] $($D.File.Name) — topic: $Topic, entries: $Entries" -ForegroundColor Yellow
    }
    Write-Host "`n  Would process $($DebatesToFix.Count) debates" -ForegroundColor Yellow
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

# ── Process each debate ──────────────────────────────────────────────────────
$Processed = 0
$Errors = 0

foreach ($Entry in $DebatesToFix) {
    $Debate = $Entry.Debate
    if ($Debate.PSObject.Properties['topic']) { $Topic = $Debate.topic } else { $Topic = 'unknown' }
    Write-Host "  $($Entry.File.BaseName): $Topic..." -ForegroundColor Gray -NoNewline

    # Build transcript excerpt for AI
    $TranscriptLines = [System.Collections.Generic.List[string]]::new()
    if ($Debate.PSObject.Properties['entries']) {
        foreach ($E in @($Debate.entries)) {
            if ($E.PSObject.Properties['role']) { $Role = $E.role } else { $Role = 'unknown' }
            if ($E.PSObject.Properties['content']) { $Content = $E.content } else { $Content = '' }
            $TranscriptLines.Add("[$Role]: $($Content.Substring(0, [Math]::Min(500, $Content.Length)))")
        }
    }

    if ($TranscriptLines.Count -eq 0) {
        Write-Host " skipped (no entries)" -ForegroundColor DarkGray
        continue
    }

    $TranscriptText = $TranscriptLines -join "`n`n"
    # Truncate to avoid token limits
    if ($TranscriptText.Length -gt 12000) {
        $TranscriptText = $TranscriptText.Substring(0, 12000) + "`n[... truncated]"
    }

    $Prompt = @"
Extract an argument map from this debate transcript. Identify the key claims made
by each participant and how they relate to each other.

Topic: $Topic

Transcript:
$TranscriptText

Return a JSON object:
{
  "claims": [
    {
      "id": "claim-1",
      "agent": "accelerationist",
      "text": "the core claim in 1-2 sentences",
      "attack_type": null,
      "target_claim": null,
      "scheme": "ARGUMENT_FROM_EVIDENCE"
    },
    {
      "id": "claim-2",
      "agent": "safetyist",
      "text": "the response claim",
      "attack_type": "rebut",
      "target_claim": "claim-1",
      "scheme": "COUNTEREXAMPLE"
    }
  ]
}

attack_type: null (original claim), "rebut" (directly contradicts), "undercut" (challenges reasoning), "undermine" (challenges evidence)
scheme: ARGUMENT_FROM_EVIDENCE, COUNTEREXAMPLE, DISTINGUISH, ANALOGY, APPEAL_TO_AUTHORITY, REDUCTIO, CAUSAL_CLAIM, or other descriptive label

Return ONLY valid JSON.
"@

    try {
        $Result = Invoke-AIApi -Prompt $Prompt -Model $Model -ApiKey $ApiKey `
            -Temperature 0.2 -MaxTokens 8192 -JsonMode -TimeoutSec 120

        $ResponseText = $Result.Text -replace '^\s*```json\s*', '' -replace '\s*```\s*$', ''
        $ArgMap = $ResponseText | ConvertFrom-Json

        # Validate argument map structure
        if (-not $ArgMap.PSObject.Properties['claims'] -or @($ArgMap.claims).Count -eq 0) {
            Write-Warning " rejected (no claims array)"
            $Errors++
            continue
        }
        $InvalidClaims = @($ArgMap.claims | Where-Object {
            -not $_.PSObject.Properties['id'] -or -not $_.id -or
            -not $_.PSObject.Properties['text'] -or -not $_.text
        })
        if ($InvalidClaims.Count -gt 0) {
            $ArgMap.claims = @($ArgMap.claims | Where-Object {
                $_.PSObject.Properties['id'] -and $_.id -and
                $_.PSObject.Properties['text'] -and $_.text
            })
            Write-Warning " stripped $($InvalidClaims.Count) claim(s) missing id/text"
        }
        if (@($ArgMap.claims).Count -eq 0) {
            Write-Warning " rejected (no valid claims after validation)"
            $Errors++
            continue
        }

        # Write argument_map to debate
        if ($Debate.PSObject.Properties['argument_map']) {
            $Debate.argument_map = $ArgMap
        }
        else {
            $Debate | Add-Member -NotePropertyName 'argument_map' -NotePropertyValue $ArgMap -Force
        }

        $NewJson = $Debate | ConvertTo-Json -Depth 30
        $TmpPath = "$($Entry.File.FullName).tmp"
        Write-Utf8NoBom -Path $TmpPath -Value $NewJson  -NoNewline
        Move-Item -Path $TmpPath -Destination $Entry.File.FullName -Force

        if ($ArgMap.PSObject.Properties['claims']) { $ClaimCount = @($ArgMap.claims).Count } else { $ClaimCount = 0 }
        Write-Host " $ClaimCount claims" -ForegroundColor Green
        $Processed++
    }
    catch {
        Write-Warning " error: $($_.Exception.Message)"
        $Errors++
    }

    # Rate limit courtesy
    Start-Sleep -Milliseconds 1000
}

Write-Host "`n  Processed: $Processed, Errors: $Errors" -ForegroundColor $(if ($Errors -gt 0) { 'Yellow' } else { 'Green' })
