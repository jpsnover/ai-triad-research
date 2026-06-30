# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Categorize git working-tree changes and recommend the minimal test command(s)
    needed to validate them.
.DESCRIPTION
    Reads `git diff --name-only` (unstaged) + `git diff --cached --name-only` (staged)
    and classifies each file by top-level scope:

      taxonomy-editor/  →  electron     (Vite + React + Electron + server)
      lib/              →  lib          (shared TS — feeds both)
      scripts/          →  powershell   (further classified by subsystem tag)
      .github/          →  ci
      anything else     →  other        (docs, AGENTS.md, etc.)

    Output is a single line per detected scope + a numbered "Recommended" list of
    commands. With -Run, executes those commands in sequence (continuing past
    non-zero exits so you see the full picture).

    Self-contained — no AITriad module dependency, runs in any fresh PowerShell 7+
    shell on a partial checkout.
.PARAMETER Run
    Execute the recommended commands instead of just printing them.
.PARAMETER RepoRoot
    Override the repo root (default: directory of this script, two levels up
    from scripts/).
.PARAMETER Files
    Override the file list (bypasses `git diff`). Used for testing and for
    "what would this changeset trigger?" exploration.
.EXAMPLE
    pwsh -File scripts/Test-Scope.ps1
.EXAMPLE
    pwsh -File scripts/Test-Scope.ps1 -Run
.EXAMPLE
    pwsh -File scripts/Test-Scope.ps1 -Files @('scripts/AITriad/Public/Get-Edge.ps1','lib/debate/debateEngine.ts')
#>
[CmdletBinding()]
param(
    [switch]$Run,
    [string]$RepoRoot,
    [string[]]$Files
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

# ── Subsystem classifier (mirrors scripts/archive/Add-PesterTags-t1186.ps1) ──
# Used to detect which Pester subsystem tag applies when only PS files changed.
$SubsystemClassifier = @(
    @{ Pattern = '\\Project-Template\.';                                                                                Tag = 'template' }
    @{ Pattern = '(Show-TriadDialogue|Invoke-AITDebate|Resume-AITDebate|Measure-DebateQuality|Compare-DebateQuality|Compare-DebateRuns|Update-DebateProgress|Watch-DebateProgress|Invoke-DebateBatch|PipeDeadlock)'; Tag = 'debate' }
    @{ Pattern = '(TaxEditor|Test-AnonymousDebateFlow|Test-PersonaEndpoints|Test-ServiceWorkerHealth|FreeTierStatus|FlightRecorder|CriticalInteraction|CuiTests)'; Tag = 'health' }
    @{ Pattern = '(Get-Edge|Invoke-EdgeDiscovery|Resolve-EdgeType|Invoke-GraphQuery|Get-TaxonomyProcess|Assert-TaxonomyCacheFresh|Find-Conflict|Compare-Taxonomy)'; Tag = 'taxonomy' }
    @{ Pattern = '(Add-SnapshotHeader|Get-AIMetadata|Get-AITClaim|Get-AITSource|Find-AITSource|Import-AITriadDocument|Invoke-IterativeExtraction|Remove-DuplicateClaims|Merge-ChunkSummaries)'; Tag = 'ingestion' }
    @{ Pattern = '(Invoke-AIApi|VernacularBatch)';                                                                       Tag = 'enrichment' }
    @{ Pattern = '(TriadConfig|AITriad\.Module)';                                                                        Tag = 'config' }
)

function Get-Subsystem([string]$Path) {
    foreach ($r in $SubsystemClassifier) {
        if ($Path -match $r.Pattern) { return $r.Tag }
    }
    return $null
}

# ── Collect changed files (unstaged + staged, deduped) ─────────────────
function Get-ChangedFiles {
    try {
        $unstaged = & git -C $RepoRoot diff --name-only 2>$null
        $staged   = & git -C $RepoRoot diff --cached --name-only 2>$null
        # Normalize separators for downstream regex matching
        @(@($unstaged) + @($staged) | Where-Object { $_ } | Sort-Object -Unique) -replace '/','\'
    } catch {
        Write-Warning "git diff failed: $($_.Exception.Message)"
        return @()
    }
}

if ($PSBoundParameters.ContainsKey('Files')) {
    # Test/exploration hook: caller supplies the file list, bypass git entirely
    $Changed = @(@($Files) | Where-Object { $_ } | Sort-Object -Unique) -replace '/','\'
    $Changed = @($Changed)
} else {
    $Changed = @(Get-ChangedFiles)
}

# ── Categorize ─────────────────────────────────────────────────────────
$Scopes = @{
    electron   = [System.Collections.Generic.List[string]]::new()
    lib        = [System.Collections.Generic.List[string]]::new()
    powershell = [System.Collections.Generic.List[string]]::new()
    ci         = [System.Collections.Generic.List[string]]::new()
    other      = [System.Collections.Generic.List[string]]::new()
}
foreach ($f in $Changed) {
    if     ($f -like 'taxonomy-editor\*') { $Scopes.electron.Add($f) }
    elseif ($f -like 'lib\*')             { $Scopes.lib.Add($f) }
    elseif ($f -like 'scripts\*' -or $f -like 'tests\*') { $Scopes.powershell.Add($f) }
    elseif ($f -like '.github\*')         { $Scopes.ci.Add($f) }
    else                                  { $Scopes.other.Add($f) }
}

# ── Detect PS subsystem (if only PS Public/ files changed) ─────────────
$PsTag = $null
if ($Scopes.powershell.Count -gt 0) {
    $tags = @($Scopes.powershell |
        Where-Object { $_ -match 'AITriad\\Public\\' } |
        ForEach-Object { Get-Subsystem $_ } |
        Where-Object { $_ } |
        Sort-Object -Unique)
    if ($tags.Count -eq 1) { $PsTag = $tags[0] }
}

# ── Build recommendations ──────────────────────────────────────────────
$Recommendations = [System.Collections.Generic.List[string]]::new()
$hasLib = $Scopes.lib.Count -gt 0
$hasElectron = $Scopes.electron.Count -gt 0
$hasPs = $Scopes.powershell.Count -gt 0
$hasCi = $Scopes.ci.Count -gt 0
$hasOther = $Scopes.other.Count -gt 0

if ($hasElectron -or $hasLib) {
    $Recommendations.Add('cd taxonomy-editor && npm run test:changed')
}
if ($hasPs -or $hasLib) {
    if ($hasLib -or -not $PsTag) {
        $Recommendations.Add('Invoke-Pester ./tests/')
    } else {
        $Recommendations.Add("Invoke-Pester ./tests/ -Tag $PsTag")
    }
}
if ($Recommendations.Count -eq 0) {
    if ($hasCi) {
        $Recommendations.Add('# .github/ change only — no tests needed (CI will validate the workflow itself)')
    } elseif ($hasOther) {
        $Recommendations.Add('# No code changes detected — no tests needed')
    } else {
        $Recommendations.Add('# Working tree is clean — nothing to test')
    }
}

# ── Render ─────────────────────────────────────────────────────────────
Write-Host ''
Write-Host 'Changes detected:' -ForegroundColor Cyan
if (@($Changed).Count -eq 0) {
    Write-Host '  (working tree clean)' -ForegroundColor DarkGray
} else {
    foreach ($k in @('electron','lib','powershell','ci','other')) {
        $list = $Scopes[$k]
        if ($list.Count -gt 0) {
            $extra = ''
            if ($k -eq 'powershell' -and $PsTag) { $extra = " → tag: $PsTag" }
            elseif ($k -eq 'powershell' -and $hasPs) { $extra = ' → tag: (multiple or non-Public; full suite)' }
            Write-Host ("  {0,-11} {1,3} file(s){2}" -f $k, $list.Count, $extra) -ForegroundColor Gray
            foreach ($f in ($list | Select-Object -First 5)) {
                Write-Host ("    {0}" -f $f) -ForegroundColor DarkGray
            }
            if ($list.Count -gt 5) {
                Write-Host ("    ... and {0} more" -f ($list.Count - 5)) -ForegroundColor DarkGray
            }
        }
    }
}
Write-Host ''
Write-Host 'Recommended:' -ForegroundColor Cyan
$idx = 1
foreach ($cmd in $Recommendations) {
    Write-Host ("  {0}. {1}" -f $idx, $cmd) -ForegroundColor Yellow
    $idx++
}

# ── Execute (-Run) ─────────────────────────────────────────────────────
if ($Run) {
    Write-Host ''
    Write-Host 'Executing...' -ForegroundColor Cyan
    foreach ($cmd in $Recommendations) {
        if ($cmd -match '^\s*#') {
            Write-Host ("  skip: {0}" -f $cmd.TrimStart('#').Trim()) -ForegroundColor DarkGray
            continue
        }
        Write-Host ''
        Write-Host ('> ' + $cmd) -ForegroundColor White
        try {
            # Use pwsh -Command so chained `&&` works and the current shell state isn't polluted
            $exit = & pwsh -NoProfile -Command $cmd
            $exitCode = $LASTEXITCODE
            if ($exitCode -ne 0) {
                Write-Host ("  ⚠ exit {0}" -f $exitCode) -ForegroundColor Yellow
            }
        } catch {
            Write-Host ("  ✗ {0}" -f $_.Exception.Message) -ForegroundColor Red
        }
    }
} else {
    Write-Host ''
    Write-Host 'Run with -Run to execute the recommended commands.' -ForegroundColor DarkGray
}

# Emit structured result for programmatic consumers
[PSCustomObject]@{
    ChangedFiles    = @($Changed)
    Scopes          = @{
        electron   = @($Scopes.electron)
        lib        = @($Scopes.lib)
        powershell = @($Scopes.powershell)
        ci         = @($Scopes.ci)
        other      = @($Scopes.other)
    }
    PsTag           = $PsTag
    Recommendations = @($Recommendations)
}
