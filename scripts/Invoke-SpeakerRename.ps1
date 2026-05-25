# Migrate legacy speaker names to POV names (t/165 + t/167).
# Accelerationist → accelerationist, Safetyist → safetyist, Skeptic → skeptic
# Excludes: docker-expert-playbook.md (Accelerationist = monitoring tool)

[CmdletBinding()]
param(
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir
$Config    = Get-Content (Join-Path $RepoRoot '.aitriad.json') -Raw | ConvertFrom-Json
$DataRoot  = (Join-Path $RepoRoot $Config.data_root | Resolve-Path).Path

Write-Host "`n== Speaker Name Migration ==" -ForegroundColor Cyan
Write-Host "  Mode: $(if ($DryRun) { 'DRY RUN' } else { 'LIVE' })" -ForegroundColor $(if ($DryRun) { 'Yellow' } else { 'Green' })

# ── Replacement map (case-sensitive pairs) ──
$Replacements = @(
    # Lowercase identifiers (JSON fields, code)
    @{ Old = 'Accelerationist'; New = 'accelerationist' }
    @{ Old = 'Safetyist';   New = 'safetyist' }
    @{ Old = 'Skeptic';  New = 'skeptic' }
    # Title case (display labels, docs)
    @{ Old = 'Accelerationist'; New = 'Accelerationist' }
    @{ Old = 'Safetyist';   New = 'Safetyist' }
    @{ Old = 'Skeptic';  New = 'Skeptic' }
)

# Build word-boundary regex (sorted by length desc to prevent partial matches)
$AllOld = @($Replacements | ForEach-Object { $_.Old } | Sort-Object { $_.Length } -Descending)
$Pattern = '\b(' + (($AllOld | ForEach-Object { [regex]::Escape($_) }) -join '|') + ')\b'
$Regex = [regex]::new($Pattern, [System.Text.RegularExpressions.RegexOptions]::None)

# Build lookup for replacer
$ReplLookup = @{}
foreach ($R in $Replacements) { $ReplLookup[$R.Old] = $R.New }
$Replacer = { param($M) $ReplLookup[$M.Value] }

# ── Exclusion list ──
$ExcludePatterns = @(
    '*docker-expert-playbook*'
    '*node_modules*'
    '*.git*'
    '*_id_migration*'
    '*_bdi_migration*'
    '*_situations_migration*'
)

function Test-Excluded {
    param([string]$Path)
    foreach ($P in $ExcludePatterns) {
        if ($Path -like $P) { return $true }
    }
    return $false
}

# ── Collect files ──
Write-Host "`n  Collecting files..." -ForegroundColor Yellow
$Files = [System.Collections.Generic.List[System.IO.FileInfo]]::new()

# t/165: Debate JSON files in data repo
$DebateDir = Join-Path $DataRoot 'debates'
if (Test-Path $DebateDir) {
    foreach ($F in (Get-ChildItem $DebateDir -Filter '*.json' -File)) {
        $Files.Add($F)
    }
}
# Also check harvests, calibration
foreach ($SubDir in @('harvests', 'calibration')) {
    $Dir = Join-Path $DataRoot $SubDir
    if (Test-Path $Dir) {
        foreach ($F in (Get-ChildItem $Dir -Filter '*.json' -File -Recurse)) {
            if (-not (Test-Excluded $F.FullName)) { $Files.Add($F) }
        }
    }
}

# t/167: PS scripts
foreach ($F in (Get-ChildItem (Join-Path $ScriptDir 'AITriad') -Filter '*.ps1' -Recurse)) {
    $Files.Add($F)
}
# Standalone scripts
foreach ($F in (Get-ChildItem $ScriptDir -Filter '*.ps1' -File)) {
    if (-not (Test-Excluded $F.FullName)) { $Files.Add($F) }
}
# Prompt templates
$PromptDir = Join-Path $ScriptDir 'AITriad' 'Prompts'
if (Test-Path $PromptDir) {
    foreach ($F in (Get-ChildItem $PromptDir -Filter '*.prompt' -File)) {
        $Files.Add($F)
    }
}

# t/167: Docs
$DocsDir = Join-Path $RepoRoot 'docs'
if (Test-Path $DocsDir) {
    foreach ($F in (Get-ChildItem $DocsDir -Filter '*.md' -File -Recurse)) {
        if (-not (Test-Excluded $F.FullName)) { $Files.Add($F) }
    }
}
# Root AGENTS.md
$AgentsMd = Join-Path $RepoRoot 'AGENTS.md'
if (Test-Path $AgentsMd) { $Files.Add((Get-Item $AgentsMd)) }

# Management docs
$MgmtDir = Join-Path $RepoRoot 'management'
if (Test-Path $MgmtDir) {
    foreach ($F in (Get-ChildItem $MgmtDir -Filter '*.md' -Recurse)) {
        if (-not (Test-Excluded $F.FullName)) { $Files.Add($F) }
    }
    foreach ($F in (Get-ChildItem $MgmtDir -Filter '*.py' -Recurse)) {
        if (-not (Test-Excluded $F.FullName)) { $Files.Add($F) }
    }
}

Write-Host "  Found $($Files.Count) files to scan"

# ── Process ──
$TotalReplacements = 0
$FilesChanged = 0

foreach ($File in $Files) {
    $Content = Get-Content $File.FullName -Raw -Encoding UTF8
    if (-not $Regex.IsMatch($Content)) { continue }

    $MatchCount = $Regex.Matches($Content).Count
    $NewContent = $Regex.Replace($Content, $Replacer)

    $TotalReplacements += $MatchCount
    $FilesChanged++

    $RelPath = $File.FullName
    if ($RelPath.StartsWith($RepoRoot)) { $RelPath = $RelPath.Substring($RepoRoot.Length + 1) }
    elseif ($RelPath.StartsWith($DataRoot)) { $RelPath = "(data) " + $RelPath.Substring($DataRoot.Length + 1) }

    if (-not $DryRun) {
        [System.IO.File]::WriteAllText($File.FullName, $NewContent, [System.Text.UTF8Encoding]::new($false))
    }
    Write-Host "    $RelPath : $MatchCount" -ForegroundColor Green
}

# ── Validation (live mode) ──
if (-not $DryRun -and $FilesChanged -gt 0) {
    Write-Host "`n  Validating JSON files..." -ForegroundColor Yellow
    $ParseErrors = 0
    foreach ($File in $Files) {
        if ($File.Extension -ne '.json') { continue }
        try {
            $null = Get-Content $File.FullName -Raw | ConvertFrom-Json
        } catch {
            Write-Host "    PARSE ERROR: $($File.Name)" -ForegroundColor Red
            $ParseErrors++
        }
    }
    if ($ParseErrors -eq 0) {
        Write-Host "    All JSON files valid" -ForegroundColor Green
    } else {
        Write-Host "    $ParseErrors files failed parse validation!" -ForegroundColor Red
    }

    # Grep gate: check for orphaned legacy names
    Write-Host "  Grep gate..." -ForegroundColor Yellow
    $Remaining = 0
    foreach ($File in $Files) {
        $C = Get-Content $File.FullName -Raw -Encoding UTF8
        if ($Regex.IsMatch($C)) {
            $Remaining++
            Write-Host "    REMAINS: $($File.Name)" -ForegroundColor Red
        }
    }
    if ($Remaining -eq 0) {
        Write-Host "    Zero legacy names remaining" -ForegroundColor Green
    }
}

# ── Summary ──
Write-Host "`n== SUMMARY ==" -ForegroundColor Cyan
Write-Host "  Files changed:  $FilesChanged"
Write-Host "  Replacements:   $TotalReplacements"
if ($DryRun) { Write-Host "  (DRY RUN — no files written)" -ForegroundColor Yellow }
