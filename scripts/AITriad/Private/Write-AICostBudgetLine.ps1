# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Write-AICostBudgetLine {
    <#
    .SYNOPSIS
        Get-AICostReport / Write-AICostReportConsole sub-helper (t/3910):
        renders the budget-remaining or over-budget line(s).
    .PARAMETER Summary
        The Summary object (EstimatedCost, DateRange).
    .PARAMETER Budget
        Monthly budget in USD. Caller guarantees > 0.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Summary,

        [Parameter(Mandatory)]
        [double]$Budget
    )

    Set-StrictMode -Version Latest

    $GrandCost = $Summary.EstimatedCost
    $Remaining = $Budget - $GrandCost
    $DaysSpanned = 1
    if ($Summary.DateRange.Earliest -and $Summary.DateRange.Latest) {
        $Span = ($Summary.DateRange.Latest - $Summary.DateRange.Earliest).TotalDays
        if ($Span -gt 0) { $DaysSpanned = $Span }
    }
    $DailyBurn = $GrandCost / $DaysSpanned
    $DaysRemaining = if ($DailyBurn -gt 0) { [int]($Remaining / $DailyBurn) } else { 999 }

    Write-Host ''
    if ($Remaining -gt 0) {
        Write-Host "  Budget: `$$($Budget.ToString('F2'))  |  Spent: `$$($GrandCost.ToString('F4'))  |  Remaining: `$$($Remaining.ToString('F4'))" -ForegroundColor Green
        Write-Host "  Daily burn rate: `$$($DailyBurn.ToString('F4'))/day  |  ~$DaysRemaining days at current rate" -ForegroundColor DarkGray
    }
    else {
        Write-Host "  Budget: `$$($Budget.ToString('F2'))  |  OVER BUDGET by `$$([Math]::Abs($Remaining).ToString('F4'))" -ForegroundColor Red
    }
}
