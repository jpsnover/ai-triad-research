# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-ImportReport {
    <#
    .SYNOPSIS
        Batch quality audit of imported documents.
    .DESCRIPTION
        Scans imported documents for under-extraction, OCR artifacts,
        date anomalies, POV inconsistencies, and density outliers.
    .PARAMETER Today
        Audit only documents ingested today.
    .PARAMETER Since
        Audit documents ingested on or after this date (yyyy-MM-dd).
    .PARAMETER DocId
        Wildcard pattern to filter document IDs.
    .PARAMETER PassThru
        Return structured objects for piping.
    .EXAMPLE
        Get-ImportReport -Today
    .EXAMPLE
        Get-ImportReport -Since 2026-06-15 -PassThru
    #>
    [CmdletBinding(DefaultParameterSetName = 'All')]
    param(
        [Parameter(ParameterSetName = 'Today')]
        [switch]$Today,

        [Parameter(ParameterSetName = 'Since')]
        [string]$Since,

        [Parameter(ParameterSetName = 'Pattern')]
        [string]$DocId,

        [switch]$PassThru
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $SourcesDir = Get-SourcesDir
    $AllDocs = Get-ChildItem -Path $SourcesDir -Directory

    if ($Today) { $Since = (Get-Date -Format 'yyyy-MM-dd') }

    $Results = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($Dir in $AllDocs) {
        $MetaPath = Join-Path $Dir.FullName 'metadata.json'
        if (-not (Test-Path $MetaPath)) { continue }

        $Meta = Get-Content $MetaPath -Raw | ConvertFrom-Json

        if ($DocId -and $Dir.Name -notlike $DocId) { continue }

        if ($Since) {
            $Ingested = $null
            if ($Meta.PSObject.Properties['date_ingested'] -and $Meta.date_ingested) {
                $Ingested = $Meta.date_ingested
            }
            if (-not $Ingested -or $Ingested -lt $Since) { continue }
        }

        $Flags = [System.Collections.Generic.List[string]]::new()
        $SnapshotPath = Join-Path $Dir.FullName 'snapshot.md'
        $SnapshotSizeKB = 0
        if (Test-Path $SnapshotPath) {
            $SnapshotSizeKB = [Math]::Round((Get-Item $SnapshotPath).Length / 1024, 1)
        }

        $TotalClaims = 0
        if ($Meta.PSObject.Properties['total_claims'] -and $null -ne $Meta.total_claims) {
            $TotalClaims = [int]$Meta.total_claims
        }

        # 1. Under-extraction
        if ($TotalClaims -lt 3 -and $SnapshotSizeKB -gt 30) {
            $Flags.Add('UNDER_EXTRACTED')
        }

        # 2. OCR artifact detection
        if (Test-Path $SnapshotPath) {
            $Lines = (Get-Content $SnapshotPath -Raw) -split "`n"
            $ShortCount = 0
            $RunBufCount = 0
            foreach ($Line in $Lines) {
                $Trimmed = $Line.Trim()
                $IsShort = ($Trimmed.Length -ge 1 -and $Trimmed.Length -le 2 -and $Trimmed -match '^\S{1,2}$')
                $IsBlank = ($Trimmed.Length -eq 0)
                if ($IsShort -or ($IsBlank -and $RunBufCount -gt 0)) {
                    $RunBufCount++
                    if ($IsShort) { $ShortCount++ }
                } else {
                    if ($ShortCount -ge 10) {
                        $Flags.Add('CORRUPTED')
                        break
                    }
                    $RunBufCount = 0
                    $ShortCount = 0
                }
            }
            if ($ShortCount -ge 10 -and -not $Flags.Contains('CORRUPTED')) {
                $Flags.Add('CORRUPTED')
            }
        }

        # 3. Date anomalies
        $DatePublished = $null
        if ($Meta.PSObject.Properties['date_published'] -and $Meta.date_published) {
            $DatePublished = $Meta.date_published
            [datetime]$ParsedDate = [datetime]::MinValue
            if ([datetime]::TryParse($DatePublished, [ref]$ParsedDate)) {
                [datetime]$DateIngested = [datetime]::MinValue
                $HasIngested = $false
                if ($Meta.PSObject.Properties['date_ingested'] -and $Meta.date_ingested) {
                    $HasIngested = [datetime]::TryParse($Meta.date_ingested, [ref]$DateIngested)
                }
                $RefDate = if ($HasIngested) { $DateIngested } else { Get-Date }
                if (($ParsedDate - $RefDate).Days -gt 30) {
                    $Flags.Add('FUTURE_DATE')
                }
                if ($ParsedDate.Month -eq 1 -and $ParsedDate.Day -eq 1) {
                    $Flags.Add('GENERIC_DATE')
                }
            }
        }

        # 4. POV inconsistency
        $PovRefKey = if ($Meta.PSObject.Properties['node_references_by_pov']) { 'node_references_by_pov' } elseif ($Meta.PSObject.Properties['claims_by_pov']) { 'claims_by_pov' } else { $null }
        if ($Meta.PSObject.Properties['pov_tags'] -and $Meta.pov_tags -and
            $PovRefKey -and $Meta.$PovRefKey) {
            foreach ($Pov in @($Meta.pov_tags)) {
                if ($null -eq $Pov) { continue }
                if ($Meta.$PovRefKey.PSObject.Properties[$Pov] -and [int]$Meta.$PovRefKey.$Pov -eq 0) {
                    $Flags.Add('POV_MISMATCH')
                    break
                }
            }
        }

        # 5. Density metric
        $ClaimsPerKB = 0
        if ($SnapshotSizeKB -gt 0) {
            $ClaimsPerKB = [Math]::Round($TotalClaims / $SnapshotSizeKB, 2)
        }

        # 6. Quality tier
        $Tier = if ($Flags.Contains('UNDER_EXTRACTED') -or $Flags.Contains('CORRUPTED')) {
            'Failed'
        } elseif ($TotalClaims -lt 3) {
            'Failed'
        } elseif ($TotalClaims -lt 5 -or $Flags.Count -gt 0) {
            'Fair'
        } else {
            'Good'
        }

        $Results.Add([PSCustomObject]@{
            DocId       = $Dir.Name
            Claims      = $TotalClaims
            SnapshotKB  = $SnapshotSizeKB
            ClaimsPerKB = $ClaimsPerKB
            Tier        = $Tier
            Flags       = if ($Flags.Count -gt 0) { $Flags -join ', ' } else { '' }
        })
    }

    if ($Results.Count -eq 0) {
        Write-Host "`n  No documents matched the filter criteria." -ForegroundColor Yellow
        return
    }

    if ($PassThru) { return $Results.ToArray() }

    # Display
    $TierCounts = @{ Good = 0; Fair = 0; Failed = 0 }
    foreach ($R in $Results) { $TierCounts[$R.Tier]++ }

    Write-Host "`n  IMPORT QUALITY REPORT ($($Results.Count) documents)" -ForegroundColor White
    Write-Host "  $('─' * 95)" -ForegroundColor DarkGray
    Write-Host ('  {0,-55} {1,6} {2,8} {3,7} {4,-20}' -f 'Document', 'Claims', 'Size KB', 'Tier', 'Flags') -ForegroundColor Cyan

    foreach ($R in ($Results | Sort-Object Tier, DocId)) {
        $TierColor = switch ($R.Tier) {
            'Good'   { 'Green'  }
            'Fair'   { 'Yellow' }
            'Failed' { 'Red'    }
        }
        $Abbrev = if ($R.DocId.Length -gt 53) { $R.DocId.Substring(0, 50) + '...' } else { $R.DocId }
        Write-Host ('  {0,-55} {1,6} {2,8} ' -f $Abbrev, $R.Claims, $R.SnapshotKB) -ForegroundColor Gray -NoNewline
        Write-Host ('{0,7} ' -f $R.Tier) -ForegroundColor $TierColor -NoNewline
        if ($R.Flags) {
            Write-Host $R.Flags -ForegroundColor DarkYellow
        } else {
            Write-Host ''
        }
    }

    Write-Host "  $('─' * 95)" -ForegroundColor DarkGray
    Write-Host -NoNewline '  Summary: '
    Write-Host -NoNewline "$($TierCounts['Good']) Good" -ForegroundColor Green
    Write-Host -NoNewline ' | '
    Write-Host -NoNewline "$($TierCounts['Fair']) Fair" -ForegroundColor Yellow
    Write-Host -NoNewline ' | '
    Write-Host "$($TierCounts['Failed']) Failed" -ForegroundColor Red
    Write-Host ''
}
