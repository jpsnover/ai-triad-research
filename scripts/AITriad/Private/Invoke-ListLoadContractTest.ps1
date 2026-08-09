# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-ListLoadContractTest {
    <#
    .SYNOPSIS
        Tests the list→load contract for a collection endpoint (t/2374).
    .DESCRIPTION
        Fetches a list endpoint, parses the first item's id, then attempts to load
        it via the load endpoint template. A 404 on a listed item is a contract
        violation. Covers the t/2368 scenario (list community as anon → load → 200).
        Skips gracefully (Pass=$true, description tagged 'skipped') when the list
        is empty. Never throws — callers receive a result row unconditionally.
    #>
    [CmdletBinding()]
    param(
        [string]$BaseUrl,
        [string]$ListPath,
        [string]$LoadTemplate,
        [string]$Category,
        [string]$Description,
        [object]$Session,
        [int]$TimeoutSec = 15
    )

    $ListParams = @{
        BaseUrl               = $BaseUrl
        Path                  = $ListPath
        TimeoutSec            = $TimeoutSec
        ExpectJson            = $true
        AcceptableStatusCodes = @(200, 304)
    }
    if ($Session) { $ListParams.Session = $Session }
    $ListCheck = Invoke-RemoteCheck @ListParams

    if (-not $ListCheck.Success) {
        $r = [EndpointTestResult]::new()
        $r.Endpoint    = $LoadTemplate
        $r.Category    = $Category
        $r.Description = $Description
        $r.Status      = $ListCheck.StatusCode
        $r.Pass        = $false
        $r.Ms          = $ListCheck.ResponseMs
        $r.Error       = "list request failed: $($ListCheck.Error)"
        return $r
    }

    $Items = @($ListCheck.Body)
    if ($Items.Count -eq 0) {
        $r = [EndpointTestResult]::new()
        $r.Endpoint    = $LoadTemplate
        $r.Category    = $Category
        $r.Description = "$Description (skipped — list empty)"
        $r.Status      = $ListCheck.StatusCode
        $r.Pass        = $true
        $r.Ms          = $ListCheck.ResponseMs
        return $r
    }

    $FirstItem = $Items[0]
    $ItemId    = $null
    if ($FirstItem.PSObject.Properties['id']) {
        $ItemId = [string]$FirstItem.id
    }
    if ([string]::IsNullOrWhiteSpace($ItemId)) {
        $r = [EndpointTestResult]::new()
        $r.Endpoint    = $LoadTemplate
        $r.Category    = $Category
        $r.Description = $Description
        $r.Status      = 0
        $r.Pass        = $false
        $r.Ms          = $ListCheck.ResponseMs
        $r.Error       = "list item has no 'id' field — unexpected schema"
        return $r
    }

    $LoadPath   = $LoadTemplate -replace '\{id\}', $ItemId
    $LoadParams = @{
        BaseUrl               = $BaseUrl
        Path                  = $LoadPath
        TimeoutSec            = $TimeoutSec
        AcceptableStatusCodes = @(200, 304)
    }
    if ($Session) { $LoadParams.Session = $Session }
    $LoadCheck = Invoke-RemoteCheck @LoadParams

    $r = [EndpointTestResult]::new()
    $r.Endpoint    = $LoadPath
    $r.Category    = $Category
    $r.Description = $Description
    $r.Status      = $LoadCheck.StatusCode
    $r.Pass        = $LoadCheck.Success
    $r.Ms          = $ListCheck.ResponseMs + $LoadCheck.ResponseMs
    $r.Error       = $LoadCheck.Error
    $r
}
