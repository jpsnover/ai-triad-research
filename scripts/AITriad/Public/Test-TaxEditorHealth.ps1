# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-TaxEditorHealth {
    <#
    .SYNOPSIS
        Tests liveness and readiness of the deployed Taxonomy Editor site.
    .DESCRIPTION
        Hits /healthz (liveness) and /health (readiness) endpoints on the
        remote Taxonomy Editor instance. Returns a structured result with
        status, response times, and diagnostic details.

        Also probes the anonymous-auth layer (t/1841): GET /.auth/anonymous must
        return 2xx AND issue a session cookie, then an authenticated GET
        /api/flags must return JSON (not the login-page HTML). This catches the
        failure mode where /healthz + /health are green but every real API call
        redirects to a login page — an outage the liveness/readiness probes miss.

        Consolidates the health-poll patterns duplicated across
        health-monitor.yml, deploy-azure.yml, and deploy-staging.yml (t/1491).
    .PARAMETER BaseUrl
        The base URL of the deployed Taxonomy Editor site.
    .PARAMETER TimeoutSec
        HTTP request timeout in seconds. Default: 10.
    .PARAMETER MaxAttempts
        Poll up to this many attempts, returning on first fully-healthy result.
        Default 1 (no retry — preserves prior behavior).
    .PARAMETER RetryIntervalSec
        Sleep between attempts when MaxAttempts > 1. Default: 10.
    .EXAMPLE
        Test-TaxEditorHealth
    .EXAMPLE
        Test-TaxEditorHealth -BaseUrl 'https://my-instance.azurecontainerapps.io'
    .EXAMPLE
        # Poll a fresh deploy for up to 5 minutes waiting for readiness.
        Test-TaxEditorHealth -MaxAttempts 30 -RetryIntervalSec 10
    .LINK
        Show-AITriadHelp
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
    .LINK
        Invoke-TaxEditorSmokeTest
    #>
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string]$BaseUrl = (Get-TaxEditorBaseUrl),

        [Parameter()]
        [ValidateRange(1, 120)]
        [int]$TimeoutSec = 10,

        [Parameter()]
        [ValidateRange(1, 60)]
        [int]$MaxAttempts = 1,

        [Parameter()]
        [ValidateRange(1, 300)]
        [int]$RetryIntervalSec = 10
    )

    Set-StrictMode -Version Latest

    $BaseUrl = $BaseUrl.TrimEnd('/')

    $Result = $null
    for ($Attempt = 1; $Attempt -le $MaxAttempts; $Attempt++) {
        $Result = Invoke-HealthProbe -BaseUrl $BaseUrl -TimeoutSec $TimeoutSec
        if ($Result.Healthy) { return $Result }
        if ($Attempt -lt $MaxAttempts) {
            Write-Verbose "Attempt $Attempt/$MaxAttempts unhealthy — sleeping ${RetryIntervalSec}s"
            Start-Sleep -Seconds $RetryIntervalSec
        }
    }
    return $Result
}

function Invoke-HealthProbe {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$BaseUrl,

        [Parameter(Mandatory)]
        [int]$TimeoutSec
    )

    Set-StrictMode -Version Latest

    $Checks = [System.Collections.Generic.List[HealthCheck]]::new()

    # ── /healthz (liveness) ──────────────────────────────────────────────
    $LivenessResult = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/healthz' `
        -TimeoutSec $TimeoutSec -ExpectedField 'status'

    $LiveCheck = [HealthCheck]::new()
    $LiveCheck.Endpoint = '/healthz'
    $LiveCheck.Purpose  = 'Liveness'
    $LiveCheck.Status   = $LivenessResult.StatusCode
    $LiveCheck.Healthy  = $LivenessResult.Success -and $LivenessResult.Body.status -eq 'healthy'
    $LiveCheck.Ms       = $LivenessResult.ResponseMs
    $LiveCheck.Detail   = if ($LivenessResult.Success) { $LivenessResult.Body.status } else { $LivenessResult.Error }
    $Checks.Add($LiveCheck)

    # ── /health (readiness) ──────────────────────────────────────────────
    $ReadinessResult = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/health' `
        -TimeoutSec $TimeoutSec -ExpectedField 'status'

    $ReadyDetail = if ($ReadinessResult.Success) {
        $b = $ReadinessResult.Body
        $parts = @("status=$($b.status)")
        if ($b.PSObject.Properties['ai'] -and $b.ai.PSObject.Properties['geminiKeyConfigured']) {
            $parts += "geminiKey=$($b.ai.geminiKeyConfigured)"
            if ($b.ai.PSObject.Properties['freeTierKeyPoolSize']) {
                $pool = $b.ai.freeTierKeyPoolSize
                $parts += "freeKeyPool=$pool"
                if ($pool -lt 2) { $parts += '(NO ROUND-ROBIN)' }
            }
        }
        if ($b.PSObject.Properties['version']) { $parts += "version=$($b.version)" }
        if ($b.PSObject.Properties['uptime']) { $parts += "uptime=$($b.uptime)s" }
        $parts -join ' | '
    } else { $ReadinessResult.Error }

    $ReadCheck = [HealthCheck]::new()
    $ReadCheck.Endpoint = '/health'
    $ReadCheck.Purpose  = 'Readiness'
    $ReadCheck.Status   = $ReadinessResult.StatusCode
    $ReadCheck.Healthy  = $ReadinessResult.Success -and $ReadinessResult.Body.status -eq 'ok'
    $ReadCheck.Ms       = $ReadinessResult.ResponseMs
    $ReadCheck.Detail   = $ReadyDetail
    $Checks.Add($ReadCheck)

    # ── /.auth/anonymous (anonymous auth layer) ──────────────────────────
    # A server can pass /healthz + /health while its anonymous-auth layer is
    # broken — every real API call then returns the login-page HTML instead of
    # JSON, so the liveness/readiness probes look green while the app is unusable
    # (flight recorder 2026-07-28: 30ms health baseline while all API calls
    # redirected to a login page, t/1841). New-AnonymousWebSession GETs
    # /.auth/anonymous (Azure Easy Auth) and returns a cookie jar on 2xx, $null
    # on non-2xx / transport error.
    $AuthSw = [System.Diagnostics.Stopwatch]::StartNew()
    $AuthSession = New-AnonymousWebSession -BaseUrl $BaseUrl -TimeoutSec $TimeoutSec
    $AuthSw.Stop()
    $CookieCount = if ($AuthSession) { $AuthSession.Cookies.Count } else { 0 }
    $AuthHealthy = ($null -ne $AuthSession) -and ($CookieCount -gt 0)
    $AuthDetail = if ($null -eq $AuthSession) {
        'no session established (/.auth/anonymous non-2xx or transport error)'
    } elseif ($CookieCount -eq 0) {
        '2xx but no Set-Cookie — anonymous auth layer not issuing sessions'
    } else {
        "anon session established ($CookieCount cookie$(if ($CookieCount -ne 1) { 's' }))"
    }

    $AuthCheck = [HealthCheck]::new()
    $AuthCheck.Endpoint = '/.auth/anonymous'
    $AuthCheck.Purpose  = 'AnonymousAuth'
    $AuthCheck.Status   = if ($AuthHealthy) { 200 } else { 0 }
    $AuthCheck.Healthy  = $AuthHealthy
    $AuthCheck.Ms       = $AuthSw.ElapsedMilliseconds
    $AuthCheck.Detail   = $AuthDetail
    $Checks.Add($AuthCheck)

    # ── /api/flags (authenticated JSON call using the anon cookie) ────────
    # Directly reproduces the reported failure: a real API path serving the
    # login shell (200 text/html) instead of JSON. -ExpectJson flips Success on
    # text/html. Only meaningful once we hold a session cookie, so it's skipped
    # when the anon session didn't establish (the AuthCheck above already fails).
    if ($AuthHealthy) {
        $FlagsResult = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/flags' `
            -TimeoutSec $TimeoutSec -Session $AuthSession -ExpectJson

        $FlagsDetail = if ($FlagsResult.Success) {
            'JSON response'
        } elseif ($FlagsResult.ContentType -match 'text/html') {
            'login-page HTML returned for an API path — anon session cookie not honored'
        } elseif ($FlagsResult.Error) {
            $FlagsResult.Error
        } else {
            "HTTP $($FlagsResult.StatusCode) ($($FlagsResult.ContentType))"
        }

        $FlagsCheck = [HealthCheck]::new()
        $FlagsCheck.Endpoint = '/api/flags'
        $FlagsCheck.Purpose  = 'AuthenticatedApi'
        $FlagsCheck.Status   = $FlagsResult.StatusCode
        $FlagsCheck.Healthy  = $FlagsResult.Success
        $FlagsCheck.Ms       = $FlagsResult.ResponseMs
        $FlagsCheck.Detail   = $FlagsDetail
        $Checks.Add($FlagsCheck)
    }

    # ── Summary ──────────────────────────────────────────────────────────
    $AllHealthy = @($Checks | Where-Object { -not $_.Healthy }).Count -eq 0
    $AvgMs = [math]::Round(($Checks | Measure-Object -Property Ms -Average).Average, 0)

    $PoolSize = 0
    if ($ReadinessResult.Success -and
        $ReadinessResult.Body.PSObject.Properties['ai'] -and
        $ReadinessResult.Body.ai.PSObject.Properties['freeTierKeyPoolSize']) {
        $PoolSize = [int]$ReadinessResult.Body.ai.freeTierKeyPoolSize
    }

    $Result = [TaxEditorHealthResult]::new()
    $Result.BaseUrl              = $BaseUrl
    $Result.Healthy              = $AllHealthy
    $Result.Checks               = @($Checks)
    $Result.AverageMs            = $AvgMs
    $Result.FreeTierKeyPoolSize  = $PoolSize
    $Result.Timestamp            = (Get-Date).ToString('o')
    $Result
}
