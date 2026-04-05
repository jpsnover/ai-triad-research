# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Rewrites non-compliant node descriptions to genus-differentia format.
.DESCRIPTION
    Scans taxonomy nodes for descriptions that don't match the genus-differentia
    pattern, batches them to an AI model for rewriting, and writes results back.

    POV nodes: "A [Desire | Belief | Intention] within [POV] discourse that [differentia].
    Encompasses: [...]. Excludes: [...]."

    Situation nodes: "A situation that [differentia]. Encompasses: [...]. Excludes: [...]."
.PARAMETER DataRoot
    Path to the data root directory.
.PARAMETER Model
    AI model to use.
.PARAMETER BatchSize
    Number of nodes per AI call. Default 10.
.PARAMETER DryRun
    Report what would change without writing.
.PARAMETER POV
    Limit to a single POV (accelerationist, safetyist, skeptic, situations).
.EXAMPLE
    ./Invoke-DescriptionRewrite.ps1 -DataRoot '../ai-triad-data' -DryRun
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$DataRoot,

    [string]$Model,

    [int]$BatchSize = 10,

    [switch]$DryRun,

    [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'situations', '')]
    [string]$POV = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $ScriptDir 'AITriad' 'AITriad.psm1') -Force -ErrorAction Stop
Import-Module (Join-Path $ScriptDir 'AIEnrich.psm1') -Force -ErrorAction Stop

if (-not $Model) {
    $Model = if ($env:AI_MODEL) { $env:AI_MODEL } else { 'gemini-3.1-flash-lite-preview' }
}

$DataRoot = (Resolve-Path $DataRoot).Path
$TaxDir = Join-Path $DataRoot 'taxonomy' 'Origin'

Write-Host "`n  GENUS-DIFFERENTIA DESCRIPTION REWRITE" -ForegroundColor Cyan
Write-Host "  Model: $Model | Mode: $(if ($DryRun) { 'DRY RUN' } else { 'LIVE' })`n" -ForegroundColor Gray

# ── Category map for genus ────────────────────────────────────────────────────
$CategoryGenus = @{
    'Beliefs'    = 'Belief'
    'Desires'    = 'Desire'
    'Intentions' = 'Intention'
}

# ── Scan for non-compliant descriptions ───────────────────────────────────────
$PovFiles = [ordered]@{
    accelerationist = 'accelerationist.json'
    safetyist       = 'safetyist.json'
    skeptic         = 'skeptic.json'
    situations      = 'situations.json'
}

if ($POV) { $PovFiles = [ordered]@{ $POV = $PovFiles[$POV] } }

$FilesToFix = [ordered]@{}
$TotalNonCompliant = 0

foreach ($PovKey in $PovFiles.Keys) {
    $FilePath = Join-Path $TaxDir $PovFiles[$PovKey]
    if (-not (Test-Path $FilePath)) { continue }

    $Data = Get-Content -Raw -Path $FilePath | ConvertFrom-Json -Depth 20
    $NonCompliant = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($Node in $Data.nodes) {
        if (-not $Node.description) { $NonCompliant.Add($Node); continue }

        $IsCompliant = if ($PovKey -eq 'situations') {
            $Node.description -match '^A\s+situation\s+that\s+'
        }
        else {
            $Node.description -match '^An?\s+(Belief|Desire|Intention)\s+within\s+'
        }

        if (-not $IsCompliant) {
            $NonCompliant.Add($Node)
        }
    }

    if ($NonCompliant.Count -gt 0) {
        $FilesToFix[$PovKey] = @{
            Path = $FilePath
            Data = $Data
            NonCompliant = $NonCompliant
        }
        $TotalNonCompliant += $NonCompliant.Count
        Write-Host "  $PovKey`: $($NonCompliant.Count) non-compliant" -ForegroundColor Yellow
    }
}

Write-Host "  Total: $TotalNonCompliant nodes need rewriting`n" -ForegroundColor Yellow

if ($TotalNonCompliant -eq 0) {
    Write-Host "  All descriptions are compliant." -ForegroundColor Green
    return
}

if ($DryRun) {
    Write-Host "  [DRY RUN] Would rewrite $TotalNonCompliant descriptions" -ForegroundColor Yellow
    foreach ($PovKey in $FilesToFix.Keys) {
        foreach ($Node in $FilesToFix[$PovKey].NonCompliant) {
            Write-Verbose "  $($Node.id): $($Node.description.Substring(0, [Math]::Min(60, $Node.description.Length)))..."
        }
    }
    return
}

# ── Resolve API key ───────────────────────────────────────────────────────────
$Backend = if ($Model -match '^gemini') { 'gemini' }
           elseif ($Model -match '^claude') { 'claude' }
           elseif ($Model -match '^groq') { 'groq' }
           else { 'gemini' }

$ApiKey = Resolve-AIApiKey -ExplicitKey '' -Backend $Backend
if (-not $ApiKey) {
    Write-Error "No API key for backend '$Backend'"
    return
}

# ── Rewrite in batches ────────────────────────────────────────────────────────
$Rewritten = 0
$Errors = 0

foreach ($PovKey in $FilesToFix.Keys) {
    $Entry = $FilesToFix[$PovKey]
    $Nodes = @($Entry.NonCompliant)
    Write-Host "  Rewriting $PovKey ($($Nodes.Count) nodes)..." -ForegroundColor Gray

    for ($i = 0; $i -lt $Nodes.Count; $i += $BatchSize) {
        $Batch = $Nodes[$i..([Math]::Min($i + $BatchSize - 1, $Nodes.Count - 1))]

        $NodeContext = @($Batch | ForEach-Object {
            $Cat = if ($_.PSObject.Properties['category']) { $_.category } else { $null }
            [ordered]@{
                id          = $_.id
                label       = $_.label
                category    = $Cat
                pov         = $PovKey
                current_desc = $_.description
            }
        })

        $ContextJson = $NodeContext | ConvertTo-Json -Depth 5 -Compress

        $Prompt = @"
Rewrite each node description to use genus-differentia format. Preserve the meaning.

For POV nodes: "A [Belief | Desire | Intention] within [POV] discourse that [differentia]. Encompasses: [concrete examples]. Excludes: [what neighboring nodes cover]."
For situation nodes: "A situation that [differentia]. Encompasses: [what it covers]. Excludes: [what is NOT covered]."

Rules:
- First sentence MUST follow the pattern exactly
- 2-4 sentences total
- Grade-10 reading level, plain language
- The Excludes clause does the boundary work
- Preserve all factual content from the original description

Nodes:
$ContextJson

Return ONLY a JSON array:
[{"id": "...", "description": "A Belief within safetyist discourse that ..."}, ...]
"@

        try {
            $Result = Invoke-AIApi -Prompt $Prompt -Model $Model -ApiKey $ApiKey `
                -Temperature 0.2 -MaxTokens 8192 -JsonMode -TimeoutSec 120

            $ResponseText = $Result.Text -replace '^\s*```json\s*', '' -replace '\s*```\s*$', ''
            $Rewrites = $ResponseText | ConvertFrom-Json -Depth 10

            foreach ($R in $Rewrites) {
                $TargetNode = $Entry.Data.nodes | Where-Object { $_.id -eq $R.id } | Select-Object -First 1
                if ($TargetNode -and $R.description) {
                    $TargetNode.description = $R.description
                    $Rewritten++
                }
            }
        }
        catch {
            Write-Warning "  API error on batch: $($_.Exception.Message)"
            $Errors++
        }

        # Rate limit courtesy
        if ($i + $BatchSize -lt $Nodes.Count) { Start-Sleep -Milliseconds 500 }
    }

    # Write back
    $NewJson = $Entry.Data | ConvertTo-Json -Depth 20
    $TmpPath = "$($Entry.Path).tmp"
    Set-Content -Path $TmpPath -Value $NewJson -Encoding UTF8 -NoNewline
    Move-Item -Path $TmpPath -Destination $Entry.Path -Force
    Write-Host "    Saved $PovKey" -ForegroundColor Green
}

Write-Host "`n  Rewritten: $Rewritten, Errors: $Errors" -ForegroundColor $(if ($Errors -gt 0) { 'Yellow' } else { 'Green' })
