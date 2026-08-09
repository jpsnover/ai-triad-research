# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-TaxEditorSmokeTest {
    <#
    .SYNOPSIS
        Runs a comprehensive remote smoke test against the deployed Taxonomy Editor.
    .DESCRIPTION
        Orchestrates Test-TaxEditorHealth, Test-TaxEditorEndpoints,
        Test-AzureHealth, and Test-GitHubHealth, then produces a summary
        report with pass/fail counts, response time stats, and per-category
        breakdowns.
    .PARAMETER BaseUrl
        The base URL of the deployed Taxonomy Editor site.
    .PARAMETER TimeoutSec
        HTTP request timeout in seconds per endpoint. Default: 15.
    .PARAMETER HealthMaxAttempts
        Cold-start tolerance for the Health-Checks phase (t/1696). Polls the
        health probe up to this many attempts, returning on the first healthy
        result, so a scale-from-zero container whose first request exceeds
        TimeoutSec is not false-red'd. Default: 5. Set to 1 for fast-fail
        (single-shot, prior behavior).
    .PARAMETER HealthRetryIntervalSec
        Seconds to sleep between health-probe attempts when HealthMaxAttempts > 1.
        Default: 10.
    .PARAMETER Detailed
        Show per-endpoint results in addition to the summary.
    .EXAMPLE
        Invoke-TaxEditorSmokeTest
    .EXAMPLE
        Invoke-TaxEditorSmokeTest -Detailed
    .EXAMPLE
        Invoke-TaxEditorSmokeTest -BaseUrl 'https://staging.example.io' | ConvertTo-Json -Depth 5
    .LINK
        Show-AITriadHelp
    .LINK
        Test-TaxEditorHealth
    .LINK
        Test-TaxEditorEndpoints
    .LINK
        Test-AnonymousDebateFlow
    .LINK
        Test-PersonaEndpoints
    .LINK
        Test-ServiceWorkerHealth
    .LINK
        Get-FreeTierStatus
    #>
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string]$BaseUrl = (Get-TaxEditorBaseUrl),

        [Parameter()]
        [ValidateRange(1, 120)]
        [int]$TimeoutSec = 15,

        [Parameter()]
        [ValidateRange(1, 60)]
        [int]$HealthMaxAttempts = 5,

        [Parameter()]
        [ValidateRange(1, 300)]
        [int]$HealthRetryIntervalSec = 10,

        [Parameter()]
        [switch]$Detailed
    )

    Set-StrictMode -Version Latest

    $StartTime = Get-Date
    Write-Host "Smoke testing: $BaseUrl" -ForegroundColor Cyan
    Write-Host ''

    # ── Phase 1: Health checks ───────────────────────────────────────────
    # t/1696 — tolerate a scale-from-zero cold start: retry the health probe so a
    # healthy-but-cold container (whose first request exceeds TimeoutSec) is not
    # false-red'd. Mirrors the deploy workflow's cold-start-tolerant health gate
    # (deploy-azure.yml: Test-TaxEditorHealth -MaxAttempts 42 -RetryIntervalSec 10).
    Write-Host '=== Health Checks ===' -ForegroundColor Cyan
    $Health = Test-TaxEditorHealth -BaseUrl $BaseUrl -TimeoutSec $TimeoutSec `
        -MaxAttempts $HealthMaxAttempts -RetryIntervalSec $HealthRetryIntervalSec

    foreach ($Check in $Health.Checks) {
        $Icon = if ($Check.Healthy) { '[PASS]' } else { '[FAIL]' }
        $Color = if ($Check.Healthy) { 'Green' } else { 'Red' }
        Write-Host "  $Icon $($Check.Endpoint) ($($Check.Purpose)) — $($Check.Ms)ms" -ForegroundColor $Color
        if (-not $Check.Healthy) {
            Write-Host "        $($Check.Detail)" -ForegroundColor DarkRed
        }
    }
    Write-Host ''

    # ── Phase 2: Endpoint smoke tests ────────────────────────────────────
    Write-Host '=== Endpoint Tests ===' -ForegroundColor Cyan
    $Endpoints = @(Test-TaxEditorEndpoints -BaseUrl $BaseUrl -TimeoutSec $TimeoutSec)

    foreach ($Ep in $Endpoints) {
        $Icon = if ($Ep.Pass) { '[PASS]' } else { '[FAIL]' }
        $Color = if ($Ep.Pass) { 'Green' } else { 'Red' }
        $Extra = if ($Ep.NodeCount) { " ($($Ep.NodeCount) nodes)" } else { '' }
        Write-Host "  $Icon $($Ep.Endpoint) — $($Ep.Status) $($Ep.Ms)ms$Extra" -ForegroundColor $Color
        if (-not $Ep.Pass -and $Ep.Error) {
            Write-Host "        $($Ep.Error)" -ForegroundColor DarkRed
        }
    }
    Write-Host ''

    # t/2374 — anonymous community pass: re-runs Community endpoints as an anon user
    # to catch auth-scope contract bugs (t/2368: listed items must be loadable by the
    # listing user). Included in the default run so staging always exercises anon paths.
    Write-Host '=== Anon Community Endpoints ===' -ForegroundColor Cyan
    $AnonEndpoints = @(Test-TaxEditorEndpoints -BaseUrl $BaseUrl -TimeoutSec $TimeoutSec `
        -Category Community -UserType Anonymous)

    foreach ($Ep in $AnonEndpoints) {
        $Icon = if ($Ep.Pass) { '[PASS]' } else { '[FAIL]' }
        $Color = if ($Ep.Pass) { 'Green' } else { 'Red' }
        Write-Host "  $Icon [anon] $($Ep.Endpoint) — $($Ep.Status) $($Ep.Ms)ms" -ForegroundColor $Color
        if (-not $Ep.Pass -and $Ep.Error) {
            Write-Host "        $($Ep.Error)" -ForegroundColor DarkRed
        }
    }
    Write-Host ''

    # ── Phase 3: Azure infrastructure ───────────────────────────────────
    Write-Host '=== Azure Infrastructure ===' -ForegroundColor Cyan
    $Azure = Test-AzureHealth -BaseUrl $BaseUrl -TimeoutSec $TimeoutSec

    foreach ($Check in $Azure.Checks) {
        $Icon = if ($Check.Pass) { '[PASS]' } else { '[FAIL]' }
        $Color = if ($Check.Pass) { 'Green' } else { 'Red' }
        Write-Host "  $Icon $($Check.Check) — $($Check.Detail)" -ForegroundColor $Color
    }
    Write-Host ''

    # ── Phase 4: GitHub services ─────────────────────────────────────────
    Write-Host '=== GitHub Services ===' -ForegroundColor Cyan
    $GitHub = Test-GitHubHealth -TimeoutSec $TimeoutSec

    foreach ($Check in $GitHub.Checks) {
        $Icon = if ($Check.Pass) { '[PASS]' } else { '[FAIL]' }
        $Color = if ($Check.Pass) { 'Green' } else { 'Red' }
        Write-Host "  $Icon $($Check.Check) — $($Check.Detail)" -ForegroundColor $Color
    }
    Write-Host ''

    # ── Summary ──────────────────────────────────────────────────────────
    $AllResults = @($Endpoints) + @($AnonEndpoints)
    $Passed = @($AllResults | Where-Object { $_.Pass }).Count
    $Failed = @($AllResults | Where-Object { -not $_.Pass }).Count
    $Total = $AllResults.Count

    $ResponseTimes = @($AllResults | Where-Object { $_.Ms -gt 0 } |
        Measure-Object -Property Ms -Average -Maximum -Minimum)

    $ByCategory = @{}
    foreach ($R in $AllResults) {
        if (-not $ByCategory.ContainsKey($R.Category)) {
            $ByCategory[$R.Category] = @{ Pass = 0; Fail = 0 }
        }
        if ($R.Pass) { $ByCategory[$R.Category].Pass++ }
        else { $ByCategory[$R.Category].Fail++ }
    }
    $CategorySummary = foreach ($Cat in ($ByCategory.Keys | Sort-Object)) {
        [PSCustomObject]@{
            Category = $Cat
            Pass     = $ByCategory[$Cat].Pass
            Fail     = $ByCategory[$Cat].Fail
        }
    }

    $Duration = (Get-Date) - $StartTime
    $OverallPass = $Health.Healthy -and $Failed -eq 0 -and $Azure.Healthy -and $GitHub.Healthy

    Write-Host '=== Summary ===' -ForegroundColor Cyan
    $SummaryColor = if ($OverallPass) { 'Green' } else { 'Red' }
    Write-Host "  Overall: $(if ($OverallPass) { 'PASS' } else { 'FAIL' })" -ForegroundColor $SummaryColor
    Write-Host "  Health:  $(if ($Health.Healthy) { 'Healthy' } else { 'Unhealthy' })"
    Write-Host "  Azure:   $(if ($Azure.Healthy) { 'Healthy' } else { 'Unhealthy' })"
    Write-Host "  GitHub:  $(if ($GitHub.Healthy) { 'Healthy' } else { 'Unhealthy' })"
    Write-Host "  Endpoints: $Passed/$Total passed"
    if ($ResponseTimes.Count -gt 0) {
        Write-Host "  Response: avg=$([math]::Round($ResponseTimes.Average, 0))ms min=$($ResponseTimes.Minimum)ms max=$($ResponseTimes.Maximum)ms"
    }
    Write-Host "  Duration: $([math]::Round($Duration.TotalSeconds, 1))s"
    Write-Host ''

    if ($Detailed) {
        Write-Host '=== Per-Category Breakdown ===' -ForegroundColor Cyan
        $CategorySummary | Format-Table -AutoSize | Out-String | Write-Host
    }

    $FailedEndpoints = @($AllResults | Where-Object { -not $_.Pass })

    [PSCustomObject]@{
        BaseUrl         = $BaseUrl
        OverallPass     = $OverallPass
        HealthOk        = $Health.Healthy
        AzureOk         = $Azure.Healthy
        GitHubOk        = $GitHub.Healthy
        EndpointsPassed = $Passed
        EndpointsFailed = $Failed
        EndpointsTotal  = $Total
        AvgResponseMs   = if ($ResponseTimes.Count -gt 0) { [math]::Round($ResponseTimes.Average, 0) } else { 0 }
        MaxResponseMs   = if ($ResponseTimes.Count -gt 0) { $ResponseTimes.Maximum } else { 0 }
        MinResponseMs   = if ($ResponseTimes.Count -gt 0) { $ResponseTimes.Minimum } else { 0 }
        DurationSec     = [math]::Round($Duration.TotalSeconds, 1)
        Categories      = @($CategorySummary)
        FailedEndpoints = $FailedEndpoints
        Timestamp       = (Get-Date).ToString('o')
    }
}
