# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    One-shot tagger for Pester test files (t/1186).
.DESCRIPTION
    Walks tests/*.Tests.ps1, classifies each file by filename pattern, and:
      1. Prepends a `# Tag: <subsystem>` header comment (if missing)
      2. Injects `-Tag '<subsystem>'` on the first Describe block (if missing)

    Idempotent — re-running skips already-tagged Describe blocks.
.PARAMETER WhatIf
    Dry-run: report classifications + planned edits, don't write.
.EXAMPLE
    pwsh -File scripts/archive/Add-PesterTags-t1186.ps1 -WhatIf
.EXAMPLE
    pwsh -File scripts/archive/Add-PesterTags-t1186.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TestsDir = Join-Path (Split-Path $PSScriptRoot -Parent | Split-Path -Parent) 'tests'
if (-not (Test-Path $TestsDir)) { throw "tests/ dir not found at $TestsDir" }

# Classifier: ordered list of (regex, tag). First match wins.
# Order matters — more specific patterns first.
$Classifier = @(
    @{ Pattern = '^Project-Template\.';                                          Tag = 'template' }
    @{ Pattern = 'Show-TriadDialogue|Invoke-AITDebate|Resume-AITDebate|Measure-DebateQuality|Compare-DebateQuality|Compare-DebateRuns|Update-DebateProgress|Watch-DebateProgress|Invoke-DebateBatch|PipeDeadlock'; Tag = 'debate' }
    @{ Pattern = 'TaxEditor|Test-AnonymousDebateFlow|Test-PersonaEndpoints|Test-ServiceWorkerHealth|FreeTierStatus|FlightRecorder|CriticalInteraction|CuiTests'; Tag = 'health' }
    @{ Pattern = 'Get-Edge|Invoke-EdgeDiscovery|Resolve-EdgeType|Invoke-GraphQuery|Get-TaxonomyProcess|Assert-TaxonomyCacheFresh|Find-Conflict|Compare-Taxonomy'; Tag = 'taxonomy' }
    @{ Pattern = 'Add-SnapshotHeader|Get-AIMetadata|Get-AITClaim|Get-AITSource|Find-AITSource|Import-AITriadDocument|Invoke-IterativeExtraction|Remove-DuplicateClaims|Merge-ChunkSummaries'; Tag = 'ingestion' }
    @{ Pattern = 'Invoke-AIApi|VernacularBatch';                                 Tag = 'enrichment' }
    @{ Pattern = 'TriadConfig|AITriad\.Module';                                  Tag = 'config' }
)

function Get-FileTag([string]$Name) {
    foreach ($rule in $Classifier) {
        if ($Name -match $rule.Pattern) { return $rule.Tag }
    }
    return $null
}

$Files = @(Get-ChildItem $TestsDir -Filter '*.Tests.ps1' | Sort-Object Name)
Write-Host ("== Pester tagger (t/1186) ==") -ForegroundColor Cyan
Write-Host ("  Files: {0}" -f $Files.Count)
Write-Host ("  WhatIf: {0}" -f $WhatIfPreference)
Write-Host ''

$Summary = @{}
$Untagged = [System.Collections.Generic.List[string]]::new()
$Edited = 0
$Skipped = 0

foreach ($f in $Files) {
    $tag = Get-FileTag $f.Name
    if (-not $tag) {
        $Untagged.Add($f.Name)
        Write-Host ("  UNCLASSIFIED  {0}" -f $f.Name) -ForegroundColor Red
        continue
    }
    if (-not $Summary.ContainsKey($tag)) { $Summary[$tag] = 0 }
    $Summary[$tag]++

    $content = Get-Content -Raw -Path $f.FullName
    $needsHeader = $content -notmatch '(?m)^# Tag:\s'
    $hasTagOnDescribe = $content -match "(?m)^Describe\s+['""][^'""]+['""]\s+-Tag\s+"
    $changed = $false

    if ($hasTagOnDescribe -and -not $needsHeader) {
        Write-Host ("  skip          {0,-50}  ({1})" -f $f.Name, $tag) -ForegroundColor DarkGray
        $Skipped++
        continue
    }

    # Inject -Tag on the first Describe block that doesn't already have one
    if (-not $hasTagOnDescribe) {
        $new = [regex]::Replace(
            $content,
            "(?m)^(Describe\s+['""][^'""]+['""])(\s*\{)",
            "`$1 -Tag '$tag'`$2",
            [System.Text.RegularExpressions.RegexOptions]::None,
            [TimeSpan]::FromSeconds(5)
        )
        # ::Replace replaces ALL matches by default — restore non-first Describes if any were touched
        # (acceptable: all Describe blocks in a file share the same subsystem tag)
        if ($new -ne $content) { $content = $new; $changed = $true }
    }

    if ($needsHeader) {
        $headerComment = "# Tag: $tag (t/1186)`n"
        $content = $headerComment + $content
        $changed = $true
    }

    if ($changed) {
        if ($PSCmdlet.ShouldProcess($f.Name, "tag as '$tag'")) {
            Set-Content -Path $f.FullName -Value $content -Encoding utf8NoBOM -NoNewline
            Write-Host ("  tagged        {0,-50}  ({1})" -f $f.Name, $tag) -ForegroundColor Green
            $Edited++
        } else {
            Write-Host ("  would tag     {0,-50}  ({1})" -f $f.Name, $tag) -ForegroundColor Yellow
        }
    }
}

Write-Host ''
Write-Host '== Summary ==' -ForegroundColor Cyan
Write-Host ("  Edited:  {0}" -f $Edited)
Write-Host ("  Skipped: {0} (already tagged)" -f $Skipped)
Write-Host ''
Write-Host '  Per-tag counts:'
foreach ($k in ($Summary.Keys | Sort-Object)) {
    Write-Host ("    {0,-12} {1}" -f $k, $Summary[$k]) -ForegroundColor Gray
}

if (@($Untagged).Count -gt 0) {
    Write-Host ''
    Write-Host '  Unclassified files (manual review needed):' -ForegroundColor Red
    foreach ($n in $Untagged) { Write-Host "    $n" -ForegroundColor Red }
}
