# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Write-DepCheckSummary {
    <#
    .SYNOPSIS
        Final RESULTS block of Invoke-DependencyCheck (t/3910). Extracted verbatim.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param([Parameter(Mandatory)][hashtable]$Ctx, [Parameter(Mandatory)][bool]$IsInstallMode, [Parameter(Mandatory)][bool]$Fix)

    Write-Host "`n$('═' * 60)" -ForegroundColor Cyan
    Write-Host "  RESULTS" -ForegroundColor White
    Write-Host "$('═' * 60)" -ForegroundColor Cyan

    $TotalChecks = $Ctx.Passed + $Ctx.Warned + $Ctx.Failed
    Write-Host "   Passed  : $($Ctx.Passed)" -ForegroundColor Green
    Write-Host "   Warnings: $($Ctx.Warned)" -ForegroundColor Yellow
    Write-Host "   Failed  : $($Ctx.Failed)" -ForegroundColor $(if ($Ctx.Failed -gt 0) { 'Red' } else { 'Green' })
    if ($Ctx.Outdated -gt 0) {
        Write-Host "   Outdated: $($Ctx.Outdated)" -ForegroundColor Yellow
    }
    if ($Ctx.Fixed -gt 0) {
        Write-Host "   Fixed   : $($Ctx.Fixed)" -ForegroundColor Cyan
    }
    Write-Host "   Total   : $TotalChecks checks" -ForegroundColor Gray

    if ($Ctx.Failed -gt 0) {
        Write-Host "`n  Some required dependencies are missing." -ForegroundColor Red
        if ($IsInstallMode -and -not $Fix) {
            Write-Host "  Re-run with -Fix to attempt automatic installation." -ForegroundColor Yellow
        }
    }
    elseif ($Ctx.Outdated -gt 0) {
        Write-Host "`n  All dependencies present but $($Ctx.Outdated) item(s) are outdated." -ForegroundColor Yellow
        Write-Host "  NOT updating automatically — review the items above and update manually." -ForegroundColor Yellow
    }
    elseif ($Ctx.Warned -gt 0) {
        Write-Host "`n  All required dependencies present. Some optional features may be limited." -ForegroundColor Yellow
    }
    else {
        Write-Host "`n  All dependencies satisfied and up to date." -ForegroundColor Green
    }

    Write-Host "$('═' * 60)`n" -ForegroundColor Cyan
}
