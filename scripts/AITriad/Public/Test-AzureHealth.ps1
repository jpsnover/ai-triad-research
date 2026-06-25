# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-AzureHealth {
    <#
    .SYNOPSIS
        Tests health of Azure infrastructure backing the Taxonomy Editor.
    .DESCRIPTION
        Checks Azure platform status, Container App responsiveness, and
        key dependent services (status.azure.com). Requires no Azure CLI
        login — all checks use public HTTP endpoints.

        When -UseCLI is specified AND 'az' is installed, also queries the
        Container App's provisioning state and replica count via Azure CLI.
    .PARAMETER BaseUrl
        The Container App URL. Default: production taxonomy-editor.
    .PARAMETER ResourceGroup
        Azure resource group name (used with -UseCLI).
    .PARAMETER AppName
        Container App name (used with -UseCLI).
    .PARAMETER UseCLI
        Use Azure CLI for deeper Container App diagnostics.
    .PARAMETER TimeoutSec
        HTTP request timeout in seconds. Default: 10.
    .EXAMPLE
        Test-AzureHealth
    .EXAMPLE
        Test-AzureHealth -UseCLI -ResourceGroup ai-triad -AppName taxonomy-editor
    #>
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string]$BaseUrl = 'https://taxonomy-editor.yellowbush-aeda037d.eastus.azurecontainerapps.io',

        [Parameter()]
        [string]$ResourceGroup = 'ai-triad',

        [Parameter()]
        [string]$AppName = 'taxonomy-editor',

        [Parameter()]
        [switch]$UseCLI,

        [Parameter()]
        [ValidateRange(1, 120)]
        [int]$TimeoutSec = 10
    )

    Set-StrictMode -Version Latest

    $BaseUrl = $BaseUrl.TrimEnd('/')
    $Checks = [System.Collections.Generic.List[PSObject]]::new()

    # ── Azure Status Page ────────────────────────────────────────────────
    $AzureStatus = Invoke-RemoteCheck -BaseUrl 'https://status.azure.com' -Path '/en-us/status' `
        -TimeoutSec $TimeoutSec -AcceptableStatusCodes @(200, 301, 302, 304)

    $Checks.Add([PSCustomObject]@{
        Check      = 'Azure Status Page'
        Pass       = $AzureStatus.Success
        ResponseMs = $AzureStatus.ResponseMs
        Detail     = if ($AzureStatus.Success) { "Reachable (HTTP $($AzureStatus.StatusCode))" } else { $AzureStatus.Error }
    })

    # ── Container App Liveness ───────────────────────────────────────────
    $AppLiveness = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/healthz' `
        -TimeoutSec $TimeoutSec -ExpectedField 'status'

    $Checks.Add([PSCustomObject]@{
        Check      = 'Container App Liveness'
        Pass       = $AppLiveness.Success -and $AppLiveness.Body.status -eq 'healthy'
        ResponseMs = $AppLiveness.ResponseMs
        Detail     = if ($AppLiveness.Success) { $AppLiveness.Body.status } else { $AppLiveness.Error }
    })

    # ── Container App Readiness ──────────────────────────────────────────
    $AppReady = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/health' `
        -TimeoutSec $TimeoutSec -ExpectedField 'status'

    $ReadyDetail = if ($AppReady.Success) {
        $parts = @("status=$($AppReady.Body.status)")
        if ($AppReady.Body.PSObject.Properties['ai'] -and $AppReady.Body.ai.PSObject.Properties['geminiKeyConfigured']) {
            $parts += "geminiKey=$($AppReady.Body.ai.geminiKeyConfigured)"
        }
        $parts -join ' | '
    } else { $AppReady.Error }

    $Checks.Add([PSCustomObject]@{
        Check      = 'Container App Readiness'
        Pass       = $AppReady.Success -and $AppReady.Body.status -eq 'ok'
        ResponseMs = $AppReady.ResponseMs
        Detail     = $ReadyDetail
    })

    # ── TLS Certificate ──────────────────────────────────────────────────
    $TlsPass = $false
    $TlsDetail = 'Skipped'
    try {
        $Uri = [Uri]$BaseUrl
        $TcpClient = [System.Net.Sockets.TcpClient]::new()
        $TcpClient.Connect($Uri.Host, 443)
        $SslStream = [System.Net.Security.SslStream]::new($TcpClient.GetStream(), $false)
        $SslStream.AuthenticateAsClient($Uri.Host)
        $Cert = $SslStream.RemoteCertificate
        if ($Cert) {
            $Expiry = [datetime]$Cert.GetExpirationDateString()
            $DaysLeft = ($Expiry - (Get-Date)).Days
            $TlsPass = $DaysLeft -gt 7
            $TlsDetail = "Expires $($Expiry.ToString('yyyy-MM-dd')) ($DaysLeft days)"
        }
        $SslStream.Dispose()
        $TcpClient.Dispose()
    }
    catch {
        $TlsDetail = $_.Exception.Message
    }

    $Checks.Add([PSCustomObject]@{
        Check      = 'TLS Certificate'
        Pass       = $TlsPass
        ResponseMs = 0
        Detail     = $TlsDetail
    })

    # ── Azure CLI diagnostics (optional) ─────────────────────────────────
    if ($UseCLI) {
        $AzCmd = Get-Command az -ErrorAction SilentlyContinue
        if ($AzCmd) {
            try {
                $AppJson = & az containerapp show -g $ResourceGroup -n $AppName --output json 2>$null
                if ($LASTEXITCODE -eq 0 -and $AppJson) {
                    $App = $AppJson | ConvertFrom-Json
                    $ProvState = $App.properties.provisioningState
                    $RunState = $App.properties.runningStatus
                    $Checks.Add([PSCustomObject]@{
                        Check      = 'ACA Provisioning State'
                        Pass       = $ProvState -eq 'Succeeded'
                        ResponseMs = 0
                        Detail     = "provisioningState=$ProvState"
                    })
                    if ($RunState) {
                        $Checks.Add([PSCustomObject]@{
                            Check      = 'ACA Running Status'
                            Pass       = $RunState -eq 'Running'
                            ResponseMs = 0
                            Detail     = "runningStatus=$RunState"
                        })
                    }

                    # ── Active Revision Health ───────────────────────────
                    try {
                        $RevJson = & az containerapp revision list -g $ResourceGroup -n $AppName --output json 2>$null
                        if ($LASTEXITCODE -eq 0 -and $RevJson) {
                            $Revisions = @($RevJson | ConvertFrom-Json)
                            $ActiveRevs = @($Revisions | Where-Object {
                                $_.PSObject.Properties['properties'] -and
                                $_.properties.PSObject.Properties['active'] -and
                                $_.properties.active -eq $true
                            })
                            foreach ($Rev in $ActiveRevs) {
                                $RevName = if ($Rev.PSObject.Properties['name']) { $Rev.name } else { 'unknown' }
                                $HealthState = 'Unknown'
                                if ($Rev.properties.PSObject.Properties['healthState']) {
                                    $HealthState = $Rev.properties.healthState
                                }
                                $ProvError = $null
                                if ($Rev.properties.PSObject.Properties['provisioningError']) {
                                    $ProvError = $Rev.properties.provisioningError
                                }
                                $RevDetail = "revision=$RevName healthState=$HealthState"
                                if ($ProvError) { $RevDetail += " provisioningError=$ProvError" }
                                $Checks.Add([PSCustomObject]@{
                                    Check      = 'ACA Active Revision Health'
                                    Pass       = $HealthState -eq 'Healthy' -and -not $ProvError
                                    ResponseMs = 0
                                    Detail     = $RevDetail
                                })
                            }
                        }
                    }
                    catch {
                        $Checks.Add([PSCustomObject]@{
                            Check      = 'ACA Active Revision Health'
                            Pass       = $false
                            ResponseMs = 0
                            Detail     = "revision list failed: $($_.Exception.Message)"
                        })
                    }

                    # ── Replica Count ────────────────────────────────────
                    $MinReplicas = 1
                    if ($App.properties.template.PSObject.Properties['scale'] -and
                        $App.properties.template.scale.PSObject.Properties['minReplicas']) {
                        $MinReplicas = [int]$App.properties.template.scale.minReplicas
                    }

                    $ActiveRevision = $null
                    if ($App.properties.PSObject.Properties['latestRevisionName']) {
                        $ActiveRevision = $App.properties.latestRevisionName
                    }

                    if ($ActiveRevision) {
                        try {
                            $ReplicaJson = & az containerapp replica list -g $ResourceGroup -n $AppName --revision $ActiveRevision --output json 2>$null
                            if ($LASTEXITCODE -eq 0 -and $ReplicaJson) {
                                $Replicas = @($ReplicaJson | ConvertFrom-Json)
                                $RunningCount = @($Replicas | Where-Object {
                                    $_.PSObject.Properties['properties'] -and
                                    $_.properties.PSObject.Properties['runningState'] -and
                                    $_.properties.runningState -eq 'Running'
                                }).Count
                                $ReplicaPass = $RunningCount -ge $MinReplicas
                                $Checks.Add([PSCustomObject]@{
                                    Check      = 'ACA Replica Count'
                                    Pass       = $ReplicaPass
                                    ResponseMs = 0
                                    Detail     = "running=$RunningCount/minReplicas=$MinReplicas"
                                })

                                # ── Container Pull Status ────────────────
                                $BadContainers = [System.Collections.Generic.List[string]]::new()
                                foreach ($Replica in $Replicas) {
                                    $ReplicaName = if ($Replica.PSObject.Properties['name']) { $Replica.name } else { 'unknown' }
                                    $Containers = @()
                                    if ($Replica.PSObject.Properties['properties'] -and
                                        $Replica.properties.PSObject.Properties['containers']) {
                                        $Containers = @($Replica.properties.containers)
                                    }
                                    foreach ($Container in $Containers) {
                                        $State = 'Unknown'
                                        if ($Container.PSObject.Properties['runningState']) {
                                            $State = $Container.runningState
                                        }
                                        if ($State -ne 'Running') {
                                            $CName = if ($Container.PSObject.Properties['name']) { $Container.name } else { 'unnamed' }
                                            $BadContainers.Add("$ReplicaName/$CName=$State")
                                        }
                                    }
                                }
                                $ContainerPass = $BadContainers.Count -eq 0
                                $ContainerDetail = if ($ContainerPass) { "All containers Running ($($Replicas.Count) replicas)" }
                                                   else { $BadContainers -join ', ' }
                                $Checks.Add([PSCustomObject]@{
                                    Check      = 'ACA Container Pull Status'
                                    Pass       = $ContainerPass
                                    ResponseMs = 0
                                    Detail     = $ContainerDetail
                                })
                            }
                        }
                        catch {
                            $Checks.Add([PSCustomObject]@{
                                Check      = 'ACA Replica Count'
                                Pass       = $false
                                ResponseMs = 0
                                Detail     = "replica list failed: $($_.Exception.Message)"
                            })
                        }
                    }
                }
                else {
                    $Checks.Add([PSCustomObject]@{
                        Check      = 'ACA CLI Query'
                        Pass       = $false
                        ResponseMs = 0
                        Detail     = 'az containerapp show failed — verify login and resource group'
                    })
                }
            }
            catch {
                $Checks.Add([PSCustomObject]@{
                    Check      = 'ACA CLI Query'
                    Pass       = $false
                    ResponseMs = 0
                    Detail     = $_.Exception.Message
                })
            }
        }
        else {
            $Checks.Add([PSCustomObject]@{
                Check      = 'ACA CLI Query'
                Pass       = $false
                ResponseMs = 0
                Detail     = 'Azure CLI (az) not found — install from https://aka.ms/installazurecli'
            })
        }
    }

    # ── Summary ──────────────────────────────────────────────────────────
    $AllPass = @($Checks | Where-Object { -not $_.Pass }).Count -eq 0

    [PSCustomObject]@{
        Platform  = 'Azure'
        Healthy   = $AllPass
        Checks    = @($Checks)
        Timestamp = (Get-Date).ToString('o')
    }
}
