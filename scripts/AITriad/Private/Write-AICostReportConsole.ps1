# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Write-AICostReportConsole {
    <#
    .SYNOPSIS
        Get-AICostReport sub-helper (t/3910): renders the formatted console
        report (table, totals, budget, provider status) for a non-PassThru run.
    .PARAMETER Summary
        The Summary object built by Get-AICostReport (Breakdown, DateRange,
        Providers, totals).
    .PARAMETER GroupBy
        The group column label used in the table header.
    .PARAMETER UsageFileCount
        Number of usage files included in the period line.
    .PARAMETER Budget
        Optional monthly budget in USD. 0 (default) suppresses the budget block.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Summary,

        [Parameter(Mandatory)]
        [string]$GroupBy,

        [Parameter(Mandatory)]
        [int]$UsageFileCount,

        [double]$Budget = 0
    )

    Set-StrictMode -Version Latest

    $EarlyDate = if ($Summary.DateRange.Earliest) { $Summary.DateRange.Earliest.ToString('yyyy-MM-dd') } else { '?' }
    $LateDate  = if ($Summary.DateRange.Latest)   { $Summary.DateRange.Latest.ToString('yyyy-MM-dd') } else { '?' }

    Write-Host ''
    Write-Host '  AI Cost Report' -ForegroundColor Cyan
    Write-Host "  Period: $EarlyDate to $LateDate  |  $UsageFileCount usage file(s)" -ForegroundColor DarkGray
    Write-Host ''

    $ColW = @{ Group = 32; Calls = 7; Input = 12; Output = 12; Cached = 12; Cost = 10; Savings = 10; Latency = 10 }
    $Header = '  {0}  {1}  {2}  {3}  {4}  {5}  {6}  {7}' -f `
        $GroupBy.PadRight($ColW.Group),
        'Calls'.PadLeft($ColW.Calls),
        'Input Tok'.PadLeft($ColW.Input),
        'Output Tok'.PadLeft($ColW.Output),
        'Cached Tok'.PadLeft($ColW.Cached),
        'Cost'.PadLeft($ColW.Cost),
        'Savings'.PadLeft($ColW.Savings),
        'Avg ms'.PadLeft($ColW.Latency)

    Write-Host $Header -ForegroundColor DarkYellow
    Write-Host ('  ' + ('-' * ($Header.Length - 2))) -ForegroundColor DarkGray

    foreach ($Row in ($Summary.Breakdown | Sort-Object EstimatedCost -Descending)) {
        $CostStr    = '$' + $Row.EstimatedCost.ToString('F4')
        $SavingsStr = if ($Row.CacheSavings -gt 0) { '$' + $Row.CacheSavings.ToString('F4') } else { '-' }
        $Line = '  {0}  {1}  {2}  {3}  {4}  {5}  {6}  {7}' -f `
            $Row.Group.PadRight($ColW.Group).Substring(0, $ColW.Group),
            $Row.Calls.ToString('N0').PadLeft($ColW.Calls),
            $Row.InputTokens.ToString('N0').PadLeft($ColW.Input),
            $Row.OutputTokens.ToString('N0').PadLeft($ColW.Output),
            $Row.CachedTokens.ToString('N0').PadLeft($ColW.Cached),
            $CostStr.PadLeft($ColW.Cost),
            $SavingsStr.PadLeft($ColW.Savings),
            $Row.AvgLatencyMs.ToString('N0').PadLeft($ColW.Latency)
        Write-Host $Line
    }

    Write-Host ('  ' + ('-' * ($Header.Length - 2))) -ForegroundColor DarkGray

    $TotalCostStr    = '$' + $Summary.EstimatedCost.ToString('F4')
    $TotalSavingsStr = if ($Summary.CacheSavings -gt 0) { '$' + $Summary.CacheSavings.ToString('F4') } else { '-' }
    $TotalsLine = '  {0}  {1}  {2}  {3}  {4}  {5}  {6}  {7}' -f `
        'TOTAL'.PadRight($ColW.Group),
        $Summary.TotalCalls.ToString('N0').PadLeft($ColW.Calls),
        $Summary.TotalInputTokens.ToString('N0').PadLeft($ColW.Input),
        $Summary.TotalOutputTokens.ToString('N0').PadLeft($ColW.Output),
        $Summary.TotalCachedTokens.ToString('N0').PadLeft($ColW.Cached),
        $TotalCostStr.PadLeft($ColW.Cost),
        $TotalSavingsStr.PadLeft($ColW.Savings),
        ''.PadLeft($ColW.Latency)
    Write-Host $TotalsLine -ForegroundColor White

    $CacheHitRate = if ($Summary.TotalInputTokens -gt 0) { [Math]::Round($Summary.TotalCachedTokens / $Summary.TotalInputTokens * 100, 1) } else { 0 }
    $CostPerCall  = if ($Summary.TotalCalls -gt 0) { [Math]::Round($Summary.EstimatedCost / $Summary.TotalCalls, 4) } else { 0 }
    Write-Host ''
    Write-Host "  Cache hit rate: $CacheHitRate%  |  Avg cost/call: `$$($CostPerCall.ToString('F4'))  |  Total tokens: $($Summary.TotalTokens.ToString('N0'))" -ForegroundColor DarkGray

    if ($Budget -gt 0) {
        Write-AICostBudgetLine -Summary $Summary -Budget $Budget
    }

    Write-Host '  Provider Status' -ForegroundColor Cyan
    Write-Host ('  ' + ('-' * 80)) -ForegroundColor DarkGray

    foreach ($Prov in $Summary.Providers) {
        $BackendLabel = $Prov.Backend.PadRight(8)
        if (-not $Prov.KeyConfigured) {
            Write-Host "  $BackendLabel  No API key configured" -ForegroundColor DarkGray
        }
        elseif ($Prov.Valid) {
            $StatusLine = "  $BackendLabel  Key: valid ($($Prov.KeySource))"
            if ($Prov.RateLimit) {
                $StatusLine += "  |  Rate: $($Prov.RateRemaining)/$($Prov.RateLimit) remaining"
                if ($Prov.RateReset) { $StatusLine += " (resets $($Prov.RateReset))" }
            }
            Write-Host $StatusLine -ForegroundColor Green
        }
        else {
            Write-Host "  $BackendLabel  Key: INVALID or expired ($($Prov.KeySource))" -ForegroundColor Red
        }
        Write-Host "             Billing: $($Prov.Dashboard)" -ForegroundColor DarkGray
    }

    Write-Host ''
}
