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
    .PARAMETER BaseUrl
        The base URL of the deployed Taxonomy Editor site.
    .PARAMETER TimeoutSec
        HTTP request timeout in seconds. Default: 10.
    .EXAMPLE
        Test-TaxEditorHealth
    .EXAMPLE
        Test-TaxEditorHealth -BaseUrl 'https://my-instance.azurecontainerapps.io'
    #>
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string]$BaseUrl = 'https://taxonomy-editor.yellowbush-aeda037d.eastus.azurecontainerapps.io',

        [Parameter()]
        [ValidateRange(1, 120)]
        [int]$TimeoutSec = 10
    )

    Set-StrictMode -Version Latest

    $BaseUrl = $BaseUrl.TrimEnd('/')
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
