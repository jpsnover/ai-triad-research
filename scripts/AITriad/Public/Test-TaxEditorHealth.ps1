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
