# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Runs paired A/B debate comparison to evaluate parameter changes.
.DESCRIPTION
    Runs the same document through two debate sessions with different truncation
    limits, then calls Compare-DebateRuns to produce a structured side-by-side
    comparison. Use this to answer "would changing the truncation limit produce
    better or worse results?"
.PARAMETER DocPath
    Path to the source document (snapshot.md).
.PARAMETER LimitA
    Truncation limit for run A (default: 50000).
.PARAMETER LimitB
    Truncation limit for run B (default: 100000).
.PARAMETER Rounds
    Number of debate rounds per run (default: 3).
.PARAMETER Model
    AI model to use for both runs.
.PARAMETER PassThru
    Return the comparison object instead of printing.
.EXAMPLE
    Invoke-DebateAB -DocPath ../sources/my-doc/snapshot.md

    Compares 50K vs 100K truncation on the given document.
.EXAMPLE
    Invoke-DebateAB -DocPath ../sources/my-doc/snapshot.md -LimitA 30000 -LimitB 80000 -Rounds 4
#>
function Invoke-DebateAB {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateScript({ Test-Path $_ })]
        [string]$DocPath,

        [int]$LimitA = 50000,
        [int]$LimitB = 100000,
        [int]$Rounds = 3,
        [string]$Model,
        [string]$ApiKey,
        [switch]$PassThru
    )

    Set-StrictMode -Version Latest

    $DocName = [System.IO.Path]::GetFileNameWithoutExtension($DocPath)
    Write-Host "`n  A/B TRUNCATION TEST: $DocName" -ForegroundColor White
    Write-Host "  Limit A: $($LimitA / 1000)K chars | Limit B: $($LimitB / 1000)K chars | Rounds: $Rounds" -ForegroundColor Gray

    $CommonParams = @{
        DocPath  = (Resolve-Path $DocPath).Path
        Rounds   = $Rounds
    }
    if ($Model) { $CommonParams.Model = $Model }
    if ($ApiKey) { $CommonParams.ApiKey = $ApiKey }

    # Run A
    Write-Host "`n  ▶ Running debate A ($($LimitA / 1000)K truncation)..." -ForegroundColor Cyan
    $ResultA = Invoke-AITDebate @CommonParams -Name "$DocName-AB-$($LimitA / 1000)K"
    if (-not $ResultA -or -not $ResultA.SessionPath) {
        Write-Host "  ✗ Run A failed" -ForegroundColor Red
        return
    }
    Write-Host "  ✓ Run A complete: $($ResultA.SessionPath)" -ForegroundColor Green

    # Run B
    Write-Host "`n  ▶ Running debate B ($($LimitB / 1000)K truncation)..." -ForegroundColor Cyan
    $ResultB = Invoke-AITDebate @CommonParams -Name "$DocName-AB-$($LimitB / 1000)K"
    if (-not $ResultB -or -not $ResultB.SessionPath) {
        Write-Host "  ✗ Run B failed" -ForegroundColor Red
        return
    }
    Write-Host "  ✓ Run B complete: $($ResultB.SessionPath)" -ForegroundColor Green

    # Compare
    Write-Host ''
    $CompareParams = @{
        SessionA = $ResultA.SessionPath
        SessionB = $ResultB.SessionPath
        LabelA   = "$($LimitA / 1000)K"
        LabelB   = "$($LimitB / 1000)K"
    }
    if ($PassThru) { $CompareParams.PassThru = $true }

    Compare-DebateRuns @CompareParams
}
