# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AICostReport {
    <#
    .SYNOPSIS
        Aggregates API usage telemetry and computes estimated costs.
    .DESCRIPTION
        Reads usage-summary.jsonl files from debate runs and/or pipeline
        telemetry, applies per-model pricing from ai-models.json, and
        produces a cost breakdown by model, session, and date.

        t/3910: decomposed into AITriad/Private helpers (Get-AICostPricing,
        Find-AIUsageFiles, Read-AIUsageEntries, ConvertTo-AIUsageCostEstimate,
        Group-AIUsageEntries, Test-AIProviderKeyStatus, Write-AICostReportConsole,
        Write-AICostBudgetLine) to bring this cmdlet's own complexity under the
        ratchet threshold. Pure refactor -- no behavior change; see each
        helper's own docstring for what it carries over verbatim (including,
        deliberately, the pre-existing t/3926 provider-status bug).
    .PARAMETER Path
        Path to a usage-summary.jsonl file or directory containing them.
        Default: debates/ under the data root.
    .PARAMETER After
        Include only API calls after this date.
    .PARAMETER Before
        Include only API calls before this date.
    .PARAMETER Backend
        Filter to specific backends (gemini, claude, groq, openai).
    .PARAMETER GroupBy
        Group results by: Model, Session, Date, Backend. Default: Model.
    .PARAMETER Budget
        Optional monthly budget in USD. Displays remaining budget and
        burn-rate projection.
    .PARAMETER PassThru
        Return structured objects instead of formatted console output.
    .EXAMPLE
        Get-AICostReport
    .EXAMPLE
        Get-AICostReport -GroupBy Session -After '2026-04-01'
    .EXAMPLE
        Get-AICostReport -Budget 50 -GroupBy Date
    .LINK
        Show-AITriadHelp
    .LINK
        Get-FreeTierStatus
    #>
    [CmdletBinding()]
    param(
        [string]$Path = '',
        [datetime]$After,
        [datetime]$Before,
        [ValidateSet('gemini', 'claude', 'groq', 'openai')]
        [string[]]$Backend,
        [ValidateSet('Model', 'Session', 'Date', 'Backend')]
        [string]$GroupBy = 'Model',
        [double]$Budget = 0,
        [switch]$PassThru
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $PricingInfo = Get-AICostPricing
    $Pricing = $PricingInfo.Pricing

    $UsageFiles = @(Find-AIUsageFiles -Path $Path)
    if ($UsageFiles.Count -eq 0) {
        Write-Warning 'No usage-summary.jsonl files found.'
        return
    }

    $Entries = Read-AIUsageEntries -UsageFiles $UsageFiles -After $After -Before $Before -Backend $Backend
    if ($Entries.Count -eq 0) {
        Write-Warning 'No matching usage entries found.'
        return
    }

    ConvertTo-AIUsageCostEstimate -Entries $Entries -Pricing $Pricing
    $Aggregated = Group-AIUsageEntries -Entries $Entries -GroupBy $GroupBy -Pricing $Pricing

    $GrandCalls   = ($Aggregated | Measure-Object -Property Calls -Sum).Sum
    $GrandInput   = ($Aggregated | Measure-Object -Property InputTokens -Sum).Sum
    $GrandOutput  = ($Aggregated | Measure-Object -Property OutputTokens -Sum).Sum
    $GrandCached  = ($Aggregated | Measure-Object -Property CachedTokens -Sum).Sum
    $GrandCost    = ($Aggregated | Measure-Object -Property EstimatedCost -Sum).Sum
    $GrandSavings = ($Aggregated | Measure-Object -Property CacheSavings -Sum).Sum

    $Summary = [PSCustomObject]@{
        TotalCalls        = $GrandCalls
        TotalInputTokens  = $GrandInput
        TotalOutputTokens = $GrandOutput
        TotalCachedTokens = $GrandCached
        TotalTokens       = $GrandInput + $GrandOutput
        EstimatedCost     = [Math]::Round($GrandCost, 4)
        CacheSavings      = [Math]::Round($GrandSavings, 4)
        Breakdown         = $Aggregated
        DateRange         = @{
            Earliest = ($Entries | Where-Object { $_.parsedTs } | Sort-Object parsedTs | Select-Object -First 1).parsedTs
            Latest   = ($Entries | Where-Object { $_.parsedTs } | Sort-Object parsedTs -Descending | Select-Object -First 1).parsedTs
        }
    }

    $Summary | Add-Member -NotePropertyName 'Providers' -NotePropertyValue (Test-AIProviderKeyStatus) -Force

    if ($PassThru) { return $Summary }

    Write-AICostReportConsole -Summary $Summary -GroupBy $GroupBy -UsageFileCount $UsageFiles.Count -Budget $Budget
}
