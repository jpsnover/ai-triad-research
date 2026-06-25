# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-TaxEditorEndpoints {
    <#
    .SYNOPSIS
        Smoke-tests key API endpoints on the deployed Taxonomy Editor.
    .DESCRIPTION
        Hits a curated set of GET endpoints that are publicly accessible (or
        accessible to anonymous users) and validates HTTP status codes and
        basic response shape. Returns per-endpoint results.
    .PARAMETER BaseUrl
        The base URL of the deployed Taxonomy Editor site.
    .PARAMETER TimeoutSec
        HTTP request timeout in seconds per endpoint. Default: 15.
    .PARAMETER Category
        Filter to a specific category of endpoints. Default: all.
    .EXAMPLE
        Test-TaxEditorEndpoints
    .EXAMPLE
        Test-TaxEditorEndpoints -Category Data | Format-Table
    #>
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string]$BaseUrl = 'https://taxonomy-editor.gentlecoast-20f0bd5b.eastus2.azurecontainerapps.io',

        [Parameter()]
        [ValidateRange(1, 120)]
        [int]$TimeoutSec = 15,

        [Parameter()]
        [ValidateSet('Health', 'Data', 'Auth', 'Models', 'Metadata', 'Static')]
        [string]$Category
    )

    Set-StrictMode -Version Latest

    $BaseUrl = $BaseUrl.TrimEnd('/')

    $Endpoints = @(
        @{ Path = '/healthz';                  Cat = 'Health';   Field = 'status';  Desc = 'Liveness probe' }
        @{ Path = '/health';                   Cat = 'Health';   Field = 'status';  Desc = 'Readiness probe' }
        @{ Path = '/api/auth/me';              Cat = 'Auth';     Field = $null;     Desc = 'Auth identity' }
        @{ Path = '/api/models';               Cat = 'Models';   Field = $null;     Desc = 'Available AI models' }
        @{ Path = '/api/taxonomy/accelerationist'; Cat = 'Data'; Field = 'nodes';   Desc = 'Accelerationist taxonomy' }
        @{ Path = '/api/taxonomy/safetyist';   Cat = 'Data';     Field = 'nodes';   Desc = 'Safetyist taxonomy' }
        @{ Path = '/api/taxonomy/skeptic';     Cat = 'Data';     Field = 'nodes';   Desc = 'Skeptic taxonomy' }
        @{ Path = '/api/edges';                Cat = 'Data';     Field = $null;     Desc = 'Edge relationships' }
        @{ Path = '/api/conflicts';            Cat = 'Data';     Field = $null;     Desc = 'Conflict data' }
        @{ Path = '/api/policy-registry';      Cat = 'Metadata'; Field = $null;     Desc = 'Policy action registry' }
        @{ Path = '/api/sources';              Cat = 'Metadata'; Field = $null;     Desc = 'Source document index' }
        @{ Path = '/api/lineage-categories';   Cat = 'Metadata'; Field = $null;     Desc = 'Lineage categories' }
        @{ Path = '/api/dictionary';           Cat = 'Metadata'; Field = $null;     Desc = 'Project dictionary' }
        @{ Path = '/api/backends/available';   Cat = 'Models';   Field = $null;     Desc = 'Available AI backends' }
        @{ Path = '/api/proxy/tier';           Cat = 'Auth';     Field = $null;     Desc = 'Proxy tier info' }
        @{ Path = '/third-party-notices';      Cat = 'Static';   Field = $null;     Desc = 'Third-party notices page' }
    )

    if ($Category) {
        $Endpoints = $Endpoints | Where-Object { $_.Cat -eq $Category }
    }

    $Results = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($Ep in $Endpoints) {
        Write-Verbose "Testing $($Ep.Path) ($($Ep.Desc))..."

        $Params = @{
            BaseUrl    = $BaseUrl
            Path       = $Ep.Path
            TimeoutSec = $TimeoutSec
            AcceptableStatusCodes = @(200, 304)
        }
        if ($Ep.Field) { $Params.ExpectedField = $Ep.Field }

        $Check = Invoke-RemoteCheck @Params

        $NodeCount = $null
        if ($Check.Success -and $Check.Body -and $Ep.Field -eq 'nodes') {
            $NodeCount = @($Check.Body.nodes).Count
        }

        $Result = [EndpointTestResult]::new()
        $Result.Endpoint    = $Ep.Path
        $Result.Category    = $Ep.Cat
        $Result.Description = $Ep.Desc
        $Result.Status      = $Check.StatusCode
        $Result.Pass        = $Check.Success
        $Result.Ms          = $Check.ResponseMs
        $Result.NodeCount   = $NodeCount
        $Result.Error       = $Check.Error
        $Results.Add($Result)
    }

    @($Results)
}
