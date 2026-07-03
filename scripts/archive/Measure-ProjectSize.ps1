# KLOC metrics for AI Triad Research project (t/170).

[CmdletBinding()]
param(
    [switch]$OutputJson,
    [string]$RepoRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
    $RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

# ── Configuration ──

$ExcludeDirs = @('node_modules', 'dist', 'build', '.git', 'ai-triad-data', 'ai-triad-sources', '.orca')
$ExcludeFiles = @('package-lock.json', 'oss-licenses.json')
$GeneratedFiles = @('intellectualLineageInfo.ts', 'fallacyInfo.ts', 'epistemicTypeInfo.ts')

$Components = [ordered]@{
    'lib/debate'        = 'lib/debate'
    'taxonomy-editor'   = 'taxonomy-editor/src'
    'poviewer'          = 'poviewer/src'
    'summary-viewer'    = 'summary-viewer/src'
    'scripts/AITriad'   = 'scripts/AITriad'
    'scripts (other)'   = 'scripts'
    'docs'              = 'docs'
    'taxonomy schemas'  = 'taxonomy/schemas'
}

$LangMap = @{
    '.ts'    = 'TypeScript'
    '.tsx'   = 'TypeScript'
    '.js'    = 'JavaScript'
    '.jsx'   = 'JavaScript'
    '.ps1'   = 'PowerShell'
    '.psm1'  = 'PowerShell'
    '.psd1'  = 'PowerShell'
    '.css'   = 'CSS'
    '.scss'  = 'CSS'
    '.json'  = 'JSON'
    '.md'    = 'Markdown'
    '.py'    = 'Python'
    '.html'  = 'HTML'
    '.prompt' = 'Prompt'
}

# ── Helpers ──

function Test-ExcludedPath {
    param([string]$Path)
    foreach ($Dir in $ExcludeDirs) {
        if ($Path -match "([\\/])$([regex]::Escape($Dir))([\\/])") { return $true }
    }
    return $false
}

function Measure-File {
    param([System.IO.FileInfo]$File)
    $Lines = @(Get-Content $File.FullName -ErrorAction SilentlyContinue)
    $Total = $Lines.Count
    $Blank = 0; $Comment = 0; $Code = 0
    $Ext = $File.Extension.ToLower()
    $InBlockComment = $false

    foreach ($Line in $Lines) {
        $Trimmed = $Line.Trim()
        if ($Trimmed.Length -eq 0) { $Blank++; continue }

        # Block comments
        if ($Ext -in '.ts', '.tsx', '.js', '.jsx', '.css', '.scss') {
            if ($InBlockComment) {
                $Comment++
                if ($Trimmed -match '\*/') { $InBlockComment = $false }
                continue
            }
            if ($Trimmed -match '^/\*') {
                $Comment++
                if ($Trimmed -notmatch '\*/') { $InBlockComment = $false; $InBlockComment = $true }
                continue
            }
            if ($Trimmed -match '^//') { $Comment++; continue }
        }
        if ($Ext -in '.ps1', '.psm1', '.psd1') {
            if ($InBlockComment) {
                $Comment++
                if ($Trimmed -match '#>') { $InBlockComment = $false }
                continue
            }
            if ($Trimmed -match '^<#') {
                $Comment++
                if ($Trimmed -notmatch '#>') { $InBlockComment = $true }
                continue
            }
            if ($Trimmed -match '^#') { $Comment++; continue }
        }
        if ($Ext -eq '.py' -and $Trimmed -match '^#') { $Comment++; continue }

        $Code++
    }

    return @{ Total = $Total; Code = $Code; Comment = $Comment; Blank = $Blank }
}

# ── Collect files ──
Write-Host "`n== AI Triad Research — Project Size ==" -ForegroundColor Cyan

$AllFiles = @(Get-ChildItem $RepoRoot -File -Recurse | Where-Object {
    -not (Test-ExcludedPath $_.FullName) -and
    $_.Name -notin $ExcludeFiles -and
    $_.Name -notin $GeneratedFiles -and
    $LangMap.ContainsKey($_.Extension.ToLower())
})

Write-Host "  Files found: $($AllFiles.Count)"

# ── By Language ──
$ByLang = @{}
foreach ($File in $AllFiles) {
    $Lang = $LangMap[$File.Extension.ToLower()]
    if (-not $ByLang.ContainsKey($Lang)) {
        $ByLang[$Lang] = @{ Files = 0; Total = 0; Code = 0; Comment = 0; Blank = 0; Test = 0; TestCode = 0 }
    }
    $Stats = Measure-File $File
    $ByLang[$Lang].Files++
    $ByLang[$Lang].Total   += $Stats.Total
    $ByLang[$Lang].Code    += $Stats.Code
    $ByLang[$Lang].Comment += $Stats.Comment
    $ByLang[$Lang].Blank   += $Stats.Blank

    $IsTest = $File.Name -match '\.(test|spec|Tests)\.' -or $File.FullName -match '[\\/]tests?[\\/]'
    if ($IsTest) {
        $ByLang[$Lang].Test++
        $ByLang[$Lang].TestCode += $Stats.Code
    }
}

Write-Host "`n  BY LANGUAGE" -ForegroundColor Yellow
Write-Host "  $('-' * 85)"
Write-Host "  Language       | Files |  Total |   Code | Comment |  Blank |  KLOC | Test Files"
Write-Host "  $('-' * 85)"
$GrandTotal = @{ Files = 0; Total = 0; Code = 0; Comment = 0; Blank = 0; Test = 0 }
foreach ($Lang in $ByLang.Keys) {
    $D = $ByLang[$Lang]
    $Kloc = [Math]::Round($D.Code / 1000, 1)
    Write-Host ("  {0,-15}| {1,5} | {2,6} | {3,6} | {4,7} | {5,6} | {6,5} | {7}" -f $Lang, $D.Files, $D.Total, $D.Code, $D.Comment, $D.Blank, $Kloc, $D.Test)
    $GrandTotal.Files   += $D.Files
    $GrandTotal.Total   += $D.Total
    $GrandTotal.Code    += $D.Code
    $GrandTotal.Comment += $D.Comment
    $GrandTotal.Blank   += $D.Blank
    $GrandTotal.Test    += $D.Test
}
Write-Host "  $('-' * 85)"
$GrandKloc = [Math]::Round($GrandTotal.Code / 1000, 1)
Write-Host ("  {0,-15}| {1,5} | {2,6} | {3,6} | {4,7} | {5,6} | {6,5} | {7}" -f 'TOTAL', $GrandTotal.Files, $GrandTotal.Total, $GrandTotal.Code, $GrandTotal.Comment, $GrandTotal.Blank, $GrandKloc, $GrandTotal.Test)

# ── By Component ──
$ByComp = [ordered]@{}
$Claimed = [System.Collections.Generic.HashSet[string]]::new()

foreach ($CompName in $Components.Keys) {
    $CompPath = Join-Path $RepoRoot $Components[$CompName]
    if (-not (Test-Path $CompPath)) { continue }
    $ByComp[$CompName] = @{ Files = 0; Code = 0; TestCode = 0 }

    foreach ($File in $AllFiles) {
        if ($Claimed.Contains($File.FullName)) { continue }
        if (-not $File.FullName.StartsWith((Resolve-Path $CompPath).Path)) { continue }
        # For 'scripts (other)', skip files already claimed by 'scripts/AITriad'
        if ($CompName -eq 'scripts (other)' -and $File.FullName -match 'AITriad') { continue }

        $Stats = Measure-File $File
        $ByComp[$CompName].Files++
        $ByComp[$CompName].Code += $Stats.Code

        $IsTest = $File.Name -match '\.(test|spec|Tests)\.' -or $File.FullName -match '[\\/]tests?[\\/]'
        if ($IsTest) { $ByComp[$CompName].TestCode += $Stats.Code }

        $null = $Claimed.Add($File.FullName)
    }
}

Write-Host "`n  BY COMPONENT" -ForegroundColor Yellow
Write-Host "  $('-' * 65)"
Write-Host "  Component          | Files |  Code |  Test | Prod  |  KLOC"
Write-Host "  $('-' * 65)"
foreach ($Comp in $ByComp.Keys) {
    $D = $ByComp[$Comp]
    if ($D.Files -eq 0) { continue }
    $Prod = $D.Code - $D.TestCode
    $Kloc = [Math]::Round($D.Code / 1000, 1)
    Write-Host ("  {0,-20}| {1,5} | {2,5} | {3,5} | {4,5} | {5,5}" -f $Comp, $D.Files, $D.Code, $D.TestCode, $Prod, $Kloc)
}

# ── Code vs Test split ──
$TotalTestCode = 0; $TotalProdCode = 0
foreach ($Lang in $ByLang.Keys) {
    $TotalTestCode += $ByLang[$Lang].TestCode
    $TotalProdCode += ($ByLang[$Lang].Code - $ByLang[$Lang].TestCode)
}
$TestPct = if (($TotalTestCode + $TotalProdCode) -gt 0) { [Math]::Round($TotalTestCode / ($TotalTestCode + $TotalProdCode) * 100, 1) } else { 0 }

Write-Host "`n  CODE vs TEST" -ForegroundColor Yellow
Write-Host "  Production:  $TotalProdCode lines ($([Math]::Round($TotalProdCode/1000, 1)) KLOC)"
Write-Host "  Test:        $TotalTestCode lines ($([Math]::Round($TotalTestCode/1000, 1)) KLOC)"
Write-Host "  Test ratio:  $TestPct%"
Write-Host "  Total:       $($GrandTotal.Code) lines ($GrandKloc KLOC)"

# ── JSON output ──
if ($OutputJson) {
    $JsonPath = Join-Path $RepoRoot 'project-size.json'
    $Output = [ordered]@{
        timestamp   = (Get-Date -Format 'o')
        grand_total = [ordered]@{ files = $GrandTotal.Files; code_lines = $GrandTotal.Code; kloc = $GrandKloc; test_pct = $TestPct }
        by_language = [ordered]@{}
        by_component = [ordered]@{}
    }
    foreach ($Lang in $ByLang.Keys) {
        $D = $ByLang[$Lang]
        $Output.by_language[$Lang] = [ordered]@{ files = $D.Files; code = $D.Code; comment = $D.Comment; blank = $D.Blank; test_files = $D.Test; test_code = $D.TestCode }
    }
    foreach ($Comp in $ByComp.Keys) {
        $D = $ByComp[$Comp]
        if ($D.Files -eq 0) { continue }
        $Output.by_component[$Comp] = [ordered]@{ files = $D.Files; code = $D.Code; test_code = $D.TestCode; prod_code = $D.Code - $D.TestCode }
    }
    $Output | ConvertTo-Json -Depth 5 | Set-Content $JsonPath -Encoding UTF8
    Write-Host "`n  JSON saved: $JsonPath" -ForegroundColor Green
}

Write-Host ""
