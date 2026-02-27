#Requires -Version 7.0
<#
.SYNOPSIS
    Re-generates snapshot.md for all existing sources using updated conversion logic.

.DESCRIPTION
    Loops through all sources/ directories that contain a raw/ subdirectory
    and re-runs the appropriate document conversion from DocConverters.psm1.
    Preserves the existing snapshot header and overwrites snapshot.md with
    the newly converted content.

.PARAMETER DryRun
    Show what would be processed without writing any files.

.EXAMPLE
    .\scripts\Redo-Snapshots.ps1
    .\scripts\Redo-Snapshots.ps1 -DryRun
#>

[CmdletBinding()]
param(
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ─────────────────────────────────────────────────────────────────────────────
# Load conversion module (HTML/PDF regex lives there to avoid AMSI triggers)
# ─────────────────────────────────────────────────────────────────────────────
Import-Module (Join-Path $PSScriptRoot 'DocConverters.psm1') -Force

$RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$SourcesDir = Join-Path $RepoRoot 'sources'

# ─────────────────────────────────────────────────────────────────────────────
# Extract the provenance header from an existing snapshot.md
# Uses line-by-line scanning (no HTML-comment regex) to stay AMSI-safe.
# Header = everything up to and including the first line that is exactly "---"
# ─────────────────────────────────────────────────────────────────────────────
function Get-SnapshotHeader {
    param([string]$SnapshotPath)

    if (-not (Test-Path $SnapshotPath)) { return '' }

    $Lines       = Get-Content $SnapshotPath -Encoding UTF8
    $HeaderLines = [System.Collections.Generic.List[string]]::new()
    $FoundSep    = $false

    foreach ($Line in $Lines) {
        $HeaderLines.Add($Line)
        # The provenance block ends with a standalone "---" separator
        if ($Line.Trim() -eq '---') {
            $FoundSep = $true
            break
        }
    }

    if ($FoundSep) {
        return ($HeaderLines -join "`n") + "`n"
    }
    return ''
}

# ─────────────────────────────────────────────────────────────────────────────
# Re-convert a single raw file via DocConverters (keeps AMSI-sensitive calls
# inside the module rather than this script).
# ─────────────────────────────────────────────────────────────────────────────
function Invoke-ReConvert {
    param(
        [string]$FilePath,
        [string]$Extension
    )

    switch ($Extension) {
        '.pdf' {
            return ConvertFrom-Pdf -PdfPath $FilePath
        }
        { $_ -in '.htm', '.html' } {
            $Raw = Get-Content $FilePath -Raw -Encoding UTF8
            return ConvertFrom-Html -Html $Raw
        }
        { $_ -in '.txt', '.md' } {
            return Get-Content $FilePath -Raw -Encoding UTF8
        }
    }
    return $null
}

# ─────────────────────────────────────────────────────────────────────────────
# Main loop
# ─────────────────────────────────────────────────────────────────────────────
$DocDirs = Get-ChildItem -Path $SourcesDir -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName 'raw') }

$PdfCount   = 0
$HtmlCount  = 0
$TxtCount   = 0
$SkipCount  = 0
$ErrorCount = 0

Write-Host "Redo-Snapshots: scanning $($DocDirs.Count) source directories..." -ForegroundColor Cyan

foreach ($DocDir in $DocDirs) {
    $DocId    = $DocDir.Name
    $RawDir   = Join-Path $DocDir.FullName 'raw'
    $RawFiles = @(Get-ChildItem -Path $RawDir -File -ErrorAction SilentlyContinue)

    if ($RawFiles.Count -eq 0) {
        Write-Host "   [$DocId] No raw files — skipping" -ForegroundColor Yellow
        $SkipCount++
        continue
    }

    # Pick the primary raw file: PDF first, then HTML, then text
    $RawFile = $RawFiles | Where-Object { $_.Extension -eq '.pdf' }  | Select-Object -First 1
    if (-not $RawFile) {
        $RawFile = $RawFiles | Where-Object { $_.Extension -in '.html', '.htm' } | Select-Object -First 1
    }
    if (-not $RawFile) {
        $RawFile = $RawFiles | Where-Object { $_.Extension -in '.txt', '.md' }   | Select-Object -First 1
    }
    if (-not $RawFile) {
        Write-Host "   [$DocId] No supported file type — skipping" -ForegroundColor Yellow
        $SkipCount++
        continue
    }

    $Ext = $RawFile.Extension.ToLower()

    if ($DryRun) {
        Write-Host "   [$DocId] Would re-convert: $($RawFile.Name) ($Ext)" -ForegroundColor Gray
        continue
    }

    Write-Host "`n[$DocId] Re-converting: $($RawFile.Name)" -ForegroundColor Cyan

    try {
        # Track counts
        switch ($Ext) {
            '.pdf'                      { $PdfCount++  }
            { $_ -in '.html', '.htm' } { $HtmlCount++ }
            { $_ -in '.txt', '.md' }   { $TxtCount++  }
        }

        $NewMarkdown = Invoke-ReConvert -FilePath $RawFile.FullName -Extension $Ext

        # Preserve existing provenance header if present
        $SnapshotPath = Join-Path $DocDir.FullName 'snapshot.md'
        $Header = Get-SnapshotHeader -SnapshotPath $SnapshotPath

        $FinalContent = if ($Header) { $Header + "`n" + $NewMarkdown } else { $NewMarkdown }

        Set-Content -Path $SnapshotPath -Value $FinalContent -Encoding UTF8
        Write-Host "   snapshot.md updated ($([int]$FinalContent.Length) chars)" -ForegroundColor Green

    } catch {
        $ErrorCount++
        Write-Host "   [$DocId] ERROR: $_" -ForegroundColor Yellow
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '  ════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host '  Redo-Snapshots complete' -ForegroundColor Green
Write-Host '  ════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host "    PDF  conversions : $PdfCount"  -ForegroundColor White
Write-Host "    HTML conversions : $HtmlCount" -ForegroundColor White
Write-Host "    Text pass-through: $TxtCount"  -ForegroundColor White
Write-Host "    Skipped          : $SkipCount" -ForegroundColor Gray
Write-Host "    Errors           : $ErrorCount" -ForegroundColor $(if ($ErrorCount -gt 0) { 'Red' } else { 'Gray' })
Write-Host ''
