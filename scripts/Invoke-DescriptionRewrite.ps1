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
Import-Module (Join-Path (Join-Path $ScriptDir 'AITriad') 'AITriad.psm1') -Force -ErrorAction Stop
Import-Module (Join-Path $ScriptDir 'AIEnrich.psm1') -Force -ErrorAction Stop
. (Join-Path $ScriptDir 'AITriad' 'Private' 'Write-Utf8NoBom.ps1')

if (-not $Model) {
    if ($env:AI_MODEL) { $Model = $env:AI_MODEL } else { $Model = 'gemini-3.1-flash-lite-preview' }
}

$DataRoot = (Resolve-Path $DataRoot).Path
$TaxDir = Join-Path (Join-Path $DataRoot 'taxonomy') 'Origin'

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

    $Data = Get-Content -Raw -Path $FilePath | ConvertFrom-Json
    $NonCompliant = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($Node in $Data.nodes) {
        if (-not $Node.PSObject.Properties['description'] -or -not $Node.description) { $NonCompliant.Add($Node); continue }

        if ($PovKey -eq 'situations') {
            $IsCompliant = $Node.description -match '^A\s+situation\s+that\s+'
        }
        else {
            $IsCompliant = $Node.description -match '^An?\s+(Belief|Desire|Intention)\s+within\s+'
        }

        if ($IsCompliant) {
            $HasBoundary = ($Node.description -match 'Encompasses:') -and ($Node.description -match 'Excludes:')
            if (-not $HasBoundary) { $IsCompliant = $false }
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
if ($Model -match '^gemini') { $Backend = 'gemini' }
elseif ($Model -match '^claude') { $Backend = 'claude' }
elseif ($Model -match '^groq') { $Backend = 'groq' }
else { $Backend = 'gemini' }

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
            if ($_.PSObject.Properties['category']) { $Cat = $_.category } else { $Cat = $null }
            $Desc = if ($_.PSObject.Properties['description']) { $_.description } else { '' }
            [ordered]@{
                id          = $_.id
                label       = $_.label
                category    = $Cat
                pov         = $PovKey
                current_desc = $Desc
            }
        })

        $ContextJson = $NodeContext | ConvertTo-Json -Depth 5 -Compress

        $Prompt = @"
Rewrite each node description to genus-differentia format with MANDATORY boundary clauses. Preserve the meaning.

REQUIRED 3-LINE FORMAT (every description MUST contain all 3 lines separated by \n):
Line 1 — genus-differentia: "A [Belief | Desire | Intention] within [POV] discourse that [differentia]."
Line 2 — "Encompasses: [concrete examples or sub-themes this node covers]."
Line 3 — "Excludes: [what neighboring or parent nodes cover instead]."
For situation nodes, Line 1 is: "A situation that [differentia]."

CRITICAL: Every description MUST include both "Encompasses:" and "Excludes:" — these are not optional. A description without these clauses is INVALID and will be rejected.

Rules:
- First sentence MUST follow the genus-differentia pattern exactly
- 2-4 sentences total
- Write for a policy reporter — active voice, named actors, concrete examples, quotable sentences. No nominalizations or hedge stacking. Technical terms fine when load-bearing; define on first use.
- The Excludes clause does the boundary work — reference sibling nodes by topic where possible
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
            $Rewrites = $ResponseText | ConvertFrom-Json

            $FailedIds = [System.Collections.Generic.List[string]]::new()
            foreach ($R in $Rewrites) {
                $TargetNode = $Entry.Data.nodes | Where-Object { $_.id -eq $R.id } | Select-Object -First 1
                if (-not $TargetNode -or -not $R.description) { continue }

                # Post-generation quality check
                $Desc = $R.description
                $QualityOk = $true
                if ($PovKey -eq 'situations') {
                    if ($Desc -notmatch '^A\s+situation\s+(concept\s+)?that\s+') { $QualityOk = $false }
                } else {
                    if ($Desc -notmatch '^An?\s+(Belief|Desire|Intention)\s+within\s+') { $QualityOk = $false }
                }
                if ($Desc -notmatch 'Encompasses:') { $QualityOk = $false }
                if ($Desc -notmatch 'Excludes:') { $QualityOk = $false }

                if ($QualityOk) {
                    $TargetNode.description = $Desc
                    $Rewritten++
                } else {
                    $FailedIds.Add($R.id)
                }
            }

            # Retry failed nodes once with a stricter prompt
            if ($FailedIds.Count -gt 0) {
                $RetryNodes = @($Batch | Where-Object { $FailedIds -contains $_.id })
                $RetryContext = @($RetryNodes | ForEach-Object {
                    $Desc = if ($_.PSObject.Properties['description']) { $_.description } else { '' }
                    [ordered]@{ id = $_.id; label = $_.label; category = $(if ($_.PSObject.Properties['category']) { $_.category } else { $null }); pov = $PovKey; current_desc = $Desc }
                }) | ConvertTo-Json -Depth 5 -Compress
                $RetryPrompt = @"
Your previous rewrite was REJECTED because it was missing "Encompasses:" and/or "Excludes:" clauses.

EVERY description MUST contain exactly these 3 parts separated by \n in the JSON string:
1. "A [Belief|Desire|Intention] within [POV] discourse that [differentia]." (or "A situation that ..." for situations)
2. "Encompasses: [list concrete sub-themes this node covers]."
3. "Excludes: [list what sibling or parent nodes cover instead]."

Nodes to fix:
$RetryContext

Return ONLY a JSON array: [{"id": "...", "description": "..."}, ...]
"@
                try {
                    Start-Sleep -Milliseconds 500
                    $RetryResult = Invoke-AIApi -Prompt $RetryPrompt -Model $Model -ApiKey $ApiKey `
                        -Temperature 0.1 -MaxTokens 8192 -JsonMode -TimeoutSec 120
                    $RetryText = $RetryResult.Text -replace '^\s*```json\s*', '' -replace '\s*```\s*$', ''
                    $RetryRewrites = $RetryText | ConvertFrom-Json
                    foreach ($R in $RetryRewrites) {
                        $TargetNode = $Entry.Data.nodes | Where-Object { $_.id -eq $R.id } | Select-Object -First 1
                        if (-not $TargetNode -or -not $R.description) { continue }
                        $Desc = $R.description
                        $Ok = ($Desc -match 'Encompasses:') -and ($Desc -match 'Excludes:')
                        if ($Ok) {
                            $TargetNode.description = $Desc
                            $Rewritten++
                            $FailedIds.Remove($R.id) | Out-Null
                        }
                    }
                } catch {
                    Write-Warning "    Retry API error: $($_.Exception.Message)"
                }
                foreach ($fid in $FailedIds) {
                    Write-Warning "    $fid`: quality check failed after retry — skipped"
                    $Errors++
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
    Write-Utf8NoBom -Path $TmpPath -Value $NewJson  -NoNewline
    Move-Item -Path $TmpPath -Destination $Entry.Path -Force
    Write-Host "    Saved $PovKey" -ForegroundColor Green
}

Write-Host "`n  Rewritten: $Rewritten, Errors: $Errors" -ForegroundColor $(if ($Errors -gt 0) { 'Yellow' } else { 'Green' })
