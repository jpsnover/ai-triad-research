# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-TaxEditorSmokeTest {
    <#
    .SYNOPSIS
        Runs a comprehensive remote smoke test against the deployed Taxonomy Editor.
    .DESCRIPTION
        Orchestrates Test-TaxEditorHealth, Test-TaxEditorEndpoints,
        Test-AzureHealth, and Test-GitHubHealth, plus an analytics write/read
        round-trip probe (t/2667), then produces a summary report with pass/fail
        counts, response time stats, and per-category breakdowns. The analytics
        probe reads aggregated totalEvents, POSTs a synthetic event, and re-reads
        to confirm the count increased — catching silent blob-storage drops that
        still return HTTP 200. With -AssertDataPresence, an additional phase (t/2671)
        asserts entities/organizations/taxonomy-nodes return JSON with > 0 rows over
        an anonymous session — catching empty data and auth-interstitial false-greens.
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
    .PARAMETER DeployedSha
        When provided, passes the commit SHA to Test-GitHubHealth so the ci.yml
        check queries by exact SHA instead of branch=main. Fail-closed: no
        completed CI run for the SHA → GitHub check fails. Intended for use in
        the deploy workflow immediately after a push (t/2639).
    .PARAMETER Detailed
        Show per-endpoint results in addition to the summary.
    .PARAMETER AssertDataPresence
        Run the data-presence phase (t/2671): establish an anonymous session, then
        assert /api/entities, /api/organizations, and /api/taxonomy/<pov> return
        JSON with > 0 rows — not just HTTP 200. Off by default so local runs (which
        may not point at a data-populated instance) are unaffected; the deploy
        workflow passes it. Catches the escape where the endpoint smoke went 26/26
        green while data was empty on web, and where an auth Sign-In interstitial
        (200 text/html) is mistaken for real data.
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
        [string]$DeployedSha = '',

        [Parameter()]
        [switch]$Detailed,

        [Parameter()]
        [switch]$AssertDataPresence
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
    $GitHubSplatArgs = @{ TimeoutSec = $TimeoutSec }
    if ($DeployedSha) { $GitHubSplatArgs['DeployedSha'] = $DeployedSha }
    $GitHub = Test-GitHubHealth @GitHubSplatArgs

    foreach ($Check in $GitHub.Checks) {
        $Icon = if ($Check.Pass) { '[PASS]' } else { '[FAIL]' }
        $Color = if ($Check.Pass) { 'Green' } else { 'Red' }
        Write-Host "  $Icon $($Check.Check) — $($Check.Detail)" -ForegroundColor $Color
    }
    # t/2673 — GitHub health (status page, rate limits, GHCR) is a monitoring
    # signal, not app health. A transient GitHub API flap must NOT sink the gate
    # when the app itself is fully healthy — it caused a false-negative rollback on
    # the step-1 staging isolation deploy (run 31890116255, 2026-08-15). Surface a
    # degraded GitHub check as a CI warning; OverallPass gates only on
    # Health/Endpoints/Azure (see the $OverallPass computation below).
    if (-not $GitHub.Healthy) {
        Write-Host "::warning::GitHub services degraded — monitoring signal only, does not block the traffic shift. See '=== GitHub Services ===' above."
    }
    Write-Host ''

    # ── Phase 5: Analytics write/read round-trip (t/2667) ────────────────
    # Q3b prevention (failure Class 3): the blob analytics backend silently drops
    # events when misconfigured while the server still returns 200. The POST
    # response's `count` reflects sanitized REQUEST events (session.ts:179), and the
    # blob append is fire-and-forget (session.ts:172) — so the write alone can NEVER
    # confirm persistence. The authoritative detector is a DELTA READ-BACK: read the
    # aggregated totalEvents (read straight from blob storage — analytics.ts:301),
    # POST a synthetic event, wait for the async append, read again, and require the
    # count to increase. A silent drop leaves the count flat. (Design option A,
    # approved t/2667#6. GET /api/analytics/query is anon-allowed — accessControl.ts:335
    # — so this runs without a session token. Concurrent staging traffic between the
    # two reads is an accepted low-risk masking window on quiet staging.)
    Write-Host '=== Analytics Round-Trip ===' -ForegroundColor Cyan
    $Analytics = @()

    # Guarded extractor: pull summary.totalEvents from an Invoke-RemoteCheck result,
    # or $null when the read failed / the field is absent (StrictMode-safe).
    $GetTotalEvents = {
        param($Check)
        if ($Check.Success -and $Check.Body -and
            $Check.Body.PSObject.Properties['summary'] -and $Check.Body.summary -and
            $Check.Body.summary.PSObject.Properties['totalEvents']) {
            return [int]$Check.Body.summary.totalEvents
        }
        return $null
    }

    # Establish an anonymous session first. Both /api/analytics/event (POST) and
    # /api/analytics/query (GET) are anon-allowed, BUT in AUTH_OPTIONAL a cookie-less
    # request receives a 200 text/html Sign-In interstitial (see Phase 6 note below,
    # and lines 302-303) — so a session-less round-trip POSTs into the interstitial
    # (event never reaches the handler) and reads the interstitial back as delta 0,
    # a false "silent drop" that blocked prod+staging deploys (t/2683 → t/2684).
    # Mirror the t/2671 data-presence phase: get the anon cookies, thread them
    # through all three calls. If the session can't be established, warn explicitly
    # so a resulting read failure is not mistaken for a persistence drop.
    $AnalyticsSession = New-AnonymousWebSession -BaseUrl $BaseUrl -TimeoutSec $TimeoutSec
    if (-not $AnalyticsSession) {
        Write-Host '  (anonymous session not established — analytics round-trip may hit the auth interstitial; delta cannot be trusted)' -ForegroundColor DarkYellow
    }

    # Baseline read BEFORE the write.
    $BaselineParams = @{ BaseUrl = $BaseUrl; Path = '/api/analytics/query'; Method = 'GET'; TimeoutSec = $TimeoutSec; AcceptableStatusCodes = @(200) }
    if ($AnalyticsSession) { $BaselineParams.Session = $AnalyticsSession }
    $BaselineCheck = Invoke-RemoteCheck @BaselineParams
    $Before = & $GetTotalEvents $BaselineCheck

    # Write probe — reachability only (200 + ok:true). NOT a drop detector.
    # Build the body as an explicit JSON string so the single-element `events`
    # array is never unwrapped to an object (the server requires an array — 400 otherwise).
    $ProbeStamp   = [DateTimeOffset]::UtcNow.ToString('o')
    $ProbeSession = "smoke-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
    $ProbeEvent   = @{
        user       = 'smoke-probe'
        session_id = $ProbeSession
        timestamp  = $ProbeStamp
        event_type = 'smoke-probe'
        category   = 'system'
        detail     = @{}
    }
    $EventJson = '{"events":[' + ($ProbeEvent | ConvertTo-Json -Depth 6 -Compress) + ']}'

    $WriteParams = @{ BaseUrl = $BaseUrl; Path = '/api/analytics/event'; Method = 'POST'; Body = $EventJson; TimeoutSec = $TimeoutSec; AcceptableStatusCodes = @(200) }
    if ($AnalyticsSession) { $WriteParams.Session = $AnalyticsSession }
    $WriteCheck = Invoke-RemoteCheck @WriteParams
    $WriteOk = $false
    if ($WriteCheck.Success -and $WriteCheck.Body -and $WriteCheck.Body.PSObject.Properties['ok']) {
        $WriteOk = [bool]$WriteCheck.Body.ok
    }
    $WritePass = $WriteCheck.Success -and $WriteOk

    $WriteResult = [EndpointTestResult]::new()
    $WriteResult.Endpoint    = 'POST /api/analytics/event'
    $WriteResult.Category    = 'Analytics'
    $WriteResult.Description = 'Analytics write reachability (200 + ok:true)'
    $WriteResult.Status      = $WriteCheck.StatusCode
    $WriteResult.Pass        = $WritePass
    $WriteResult.Ms          = $WriteCheck.ResponseMs
    $WriteResult.NodeCount   = $null
    if (-not $WritePass) {
        $WriteResult.Error = if ($WriteCheck.Error) {
            $WriteCheck.Error
        } else {
            "Unexpected write response (status=$($WriteCheck.StatusCode), ok=$WriteOk)"
        }
    }
    $Analytics += $WriteResult

    # Async blob append — give the write time to land before the read-back.
    Start-Sleep -Seconds 2

    # Read-back AFTER the write — the delta is the detector.
    $AfterParams = @{ BaseUrl = $BaseUrl; Path = '/api/analytics/query'; Method = 'GET'; TimeoutSec = $TimeoutSec; AcceptableStatusCodes = @(200) }
    if ($AnalyticsSession) { $AfterParams.Session = $AnalyticsSession }
    $AfterCheck = Invoke-RemoteCheck @AfterParams
    $After = & $GetTotalEvents $AfterCheck

    $DeltaPass = $false
    $DeltaErr  = $null
    if ($null -eq $Before) {
        $DeltaErr = "Baseline read failed (status=$($BaselineCheck.StatusCode)) — cannot compute delta$(if ($BaselineCheck.Error) { ": $($BaselineCheck.Error)" })"
    } elseif ($null -eq $After) {
        $DeltaErr = "Read-back failed (status=$($AfterCheck.StatusCode)) — cannot confirm write landed$(if ($AfterCheck.Error) { ": $($AfterCheck.Error)" })"
    } else {
        $Delta = $After - $Before
        $DeltaPass = ($Delta -ge 1)
        if (-not $DeltaPass) {
            $DeltaErr = "Silent drop: totalEvents did not increase after write (before=$Before, after=$After, delta=$Delta) — event accepted but not persisted (blob backend misconfigured?)"
        }
    }

    $DeltaResult = [EndpointTestResult]::new()
    $DeltaResult.Endpoint    = 'GET /api/analytics/query (delta read-back)'
    $DeltaResult.Category    = 'Analytics'
    $DeltaResult.Description = 'Analytics storage round-trip (totalEvents increased)'
    $DeltaResult.Status      = $AfterCheck.StatusCode
    $DeltaResult.Pass        = $DeltaPass
    $DeltaResult.Ms          = $BaselineCheck.ResponseMs + $AfterCheck.ResponseMs
    $DeltaResult.NodeCount   = $After
    $DeltaResult.Error       = $DeltaErr
    $Analytics += $DeltaResult

    foreach ($Ep in $Analytics) {
        $Icon = if ($Ep.Pass) { '[PASS]' } else { '[FAIL]' }
        $Color = if ($Ep.Pass) { 'Green' } else { 'Red' }
        Write-Host "  $Icon $($Ep.Endpoint) — $($Ep.Status) $($Ep.Ms)ms" -ForegroundColor $Color
        if (-not $Ep.Pass -and $Ep.Error) {
            Write-Host "        $($Ep.Error)" -ForegroundColor DarkRed
        }
    }
    Write-Host ''

    # ── Phase 6: Data presence (t/2671) — opt-in via -AssertDataPresence ──
    # The endpoint smoke passed 26/26 green while Entities/Organizations were empty
    # on web (t/2648/t/2661): it asserts endpoints RESPOND, not that data POPULATES.
    # Worse, in AUTH_OPTIONAL a cookie-less GET returns a 200 text/html Sign-In
    # interstitial that a status-only check reads as PASS. This phase establishes an
    # anonymous session (so the app serves real JSON, not the interstitial —
    # accessControl.ts:335 anon-allows GETs; no admin token needed) and asserts each
    # data route returns application/json with > 0 rows. Failures flow into
    # FailedEndpoints → OverallPass. Off by default; the deploy workflow passes the switch.
    $DataPresence = @()
    if ($AssertDataPresence) {
        Write-Host '=== Data Presence ===' -ForegroundColor Cyan
        $DataSession = New-AnonymousWebSession -BaseUrl $BaseUrl -TimeoutSec $TimeoutSec
        if (-not $DataSession) {
            Write-Host '  (anonymous session not established — data GETs may return the auth interstitial)' -ForegroundColor DarkYellow
        }

        $DataRoutes = @(
            @{ Path = '/api/entities';                 Field = '';      Label = 'entities' }
            @{ Path = '/api/organizations';            Field = '';      Label = 'organizations' }
            @{ Path = '/api/taxonomy/accelerationist'; Field = 'nodes'; Label = 'taxonomy nodes' }
        )
        foreach ($R in $DataRoutes) {
            $Params = @{ BaseUrl = $BaseUrl; Path = $R.Path; Method = 'GET'; TimeoutSec = $TimeoutSec; ExpectJson = $true }
            if ($DataSession) { $Params.Session = $DataSession }
            $Check  = Invoke-RemoteCheck @Params
            $Assert = Test-DataPresenceAssertion -Body $Check.Body -ContentType $Check.ContentType `
                -CountField $R.Field -Label $R.Label

            $Res = [EndpointTestResult]::new()
            $Res.Endpoint    = "GET $($R.Path)"
            $Res.Category    = 'DataPresence'
            $Res.Description = "Data presence: $($R.Label) > 0"
            $Res.Status      = $Check.StatusCode
            $Res.Pass        = $Assert.Pass
            $Res.Ms          = $Check.ResponseMs
            $Res.NodeCount   = $Assert.Count
            if (-not $Assert.Pass) {
                $Res.Error = "$($R.Label): $($Assert.Reason)$(if ($Check.Error) { " (http: $($Check.Error))" })"
            }
            $DataPresence += $Res
        }

        foreach ($Ep in $DataPresence) {
            $Icon = if ($Ep.Pass) { '[PASS]' } else { '[FAIL]' }
            $Color = if ($Ep.Pass) { 'Green' } else { 'Red' }
            Write-Host "  $Icon $($Ep.Endpoint) — $($Ep.Status) ($($Ep.NodeCount) rows) $($Ep.Ms)ms" -ForegroundColor $Color
            if (-not $Ep.Pass -and $Ep.Error) {
                Write-Host "        $($Ep.Error)" -ForegroundColor DarkRed
            }
        }
        Write-Host ''
    }

    # ── Summary ──────────────────────────────────────────────────────────
    $AllResults = @($Endpoints) + @($AnonEndpoints) + @($Analytics) + @($DataPresence)
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
    # t/2673 — gate on app health only (Health + Endpoints + Azure). GitHubOk is
    # reported below and surfaced as a warning when degraded, but is intentionally
    # excluded here so a transient GitHub API flap cannot false-red the deploy gate.
    $OverallPass = $Health.Healthy -and $Failed -eq 0 -and $Azure.Healthy

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
