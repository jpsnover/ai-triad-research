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
    .PARAMETER AnonymousSession
        Establish an anonymous WebRequestSession against /.auth/anonymous
        (Azure Easy Auth) via New-AnonymousWebSession and pass it as
        -Session on every endpoint check. This replicates the anon cookie
        jar the deploy-time bash acceptance test used to inline (t/1500
        Phase 3, e/41). If the session establishment fails (Easy Auth
        endpoint missing / non-2xx), the switch degrades gracefully to
        unauthenticated requests with a warning — the caller then sees
        whichever endpoints require auth flip to failure, which is the
        signal.
    .EXAMPLE
        Test-TaxEditorEndpoints
    .EXAMPLE
        Test-TaxEditorEndpoints -Category Data | Format-Table
    .EXAMPLE
        # Deploy-time acceptance smoke — anon cookie jar + full endpoint set.
        Test-TaxEditorEndpoints -AnonymousSession | Where-Object { -not $_.Pass }
    .LINK
        Show-AITriadHelp
    .LINK
        Test-TaxEditorHealth
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
        [int]$TimeoutSec = 15,

        [Parameter()]
        [ValidateSet('Health', 'Data', 'Auth', 'Models', 'Metadata', 'Static', 'Debate', 'Community', 'Sync', 'Frontend')]
        [string]$Category,

        [Parameter()]
        [switch]$AnonymousSession
    )

    Set-StrictMode -Version Latest

    $BaseUrl = $BaseUrl.TrimEnd('/')

    $Endpoints = @(
        @{ Path = '/healthz';                  Cat = 'Health';    Field = 'status';   Desc = 'Liveness probe' }
        @{ Path = '/health';                   Cat = 'Health';    Field = 'status';   Desc = 'Readiness probe' }
        @{ Path = '/api/auth/me';              Cat = 'Auth';      Field = $null;      Desc = 'Auth identity' }
        @{ Path = '/api/models';               Cat = 'Models';    Field = $null;      Desc = 'Available AI models' }
        @{ Path = '/api/taxonomy/accelerationist'; Cat = 'Data';  Field = 'nodes';    Desc = 'Accelerationist taxonomy' }
        @{ Path = '/api/taxonomy/safetyist';   Cat = 'Data';      Field = 'nodes';    Desc = 'Safetyist taxonomy' }
        @{ Path = '/api/taxonomy/skeptic';     Cat = 'Data';      Field = 'nodes';    Desc = 'Skeptic taxonomy' }
        @{ Path = '/api/edges';                Cat = 'Data';      Field = $null;      Desc = 'Edge relationships' }
        @{ Path = '/api/conflicts';            Cat = 'Data';      Field = $null;      Desc = 'Conflict data' }
        @{ Path = '/api/policy-registry';      Cat = 'Metadata';  Field = $null;      Desc = 'Policy action registry' }
        @{ Path = '/api/sources';              Cat = 'Metadata';  Field = $null;      Desc = 'Source document index' }
        @{ Path = '/api/lineage-categories';   Cat = 'Metadata';  Field = $null;      Desc = 'Lineage categories' }
        @{ Path = '/api/dictionary';           Cat = 'Metadata';  Field = $null;      Desc = 'Project dictionary' }
        @{ Path = '/api/backends/available';   Cat = 'Models';    Field = $null;      Desc = 'Available AI backends' }
        @{ Path = '/api/proxy/tier';           Cat = 'Auth';      Field = $null;      Desc = 'Proxy tier info' }
        @{ Path = '/third-party-notices';      Cat = 'Static';    Field = $null;      Desc = 'Third-party notices page' }
        # t/1500 Phase 3 — deploy-time acceptance additions (e/41).
        @{ Path = '/api/data/available';       Cat = 'Health';    Field = $null;      Desc = 'Data availability flag' }
        @{ Path = '/api/debates/list';         Cat = 'Debate';    Field = $null;      Desc = 'Debate listing' }
        @{ Path = '/api/chats';                Cat = 'Debate';    Field = $null;      Desc = 'Chat listing' }
        @{ Path = '/api/community/debates';    Cat = 'Community'; Field = $null;      Desc = 'Community debates' }
        @{ Path = '/api/sync/status';          Cat = 'Sync';      Field = 'enabled';  Desc = 'Sync status' }
        # SPA-shell check — GET / returns HTML; success requires the React root
        # div AND a script tag, so it catches both a blank shell and a
        # bad-cache HTML/500 fallback. Kept as its own category so callers can
        # bypass it via -Category. Handled specially in the loop below
        # (Field='__spa' triggers the raw-body content check).
        @{ Path = '/';                         Cat = 'Frontend';  Field = '__spa';    Desc = 'SPA shell (root document)' }
    )

    if ($Category) {
        $Endpoints = @($Endpoints | Where-Object { $_.Cat -eq $Category })
    }

    # Anonymous session establishment (t/1500 Phase 3, TL note 1).
    $Session = $null
    if ($AnonymousSession) {
        $Session = New-AnonymousWebSession -BaseUrl $BaseUrl -TimeoutSec $TimeoutSec
        if (-not $Session) {
            Write-Warning "AnonymousSession: /.auth/anonymous did not establish a session at $BaseUrl; proceeding unauthenticated."
        }
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
        # SPA shell: expect HTML, validate raw body shape after the request.
        # Everything else: JSON with optional expected field.
        if ($Ep.Field -eq '__spa') {
            # Do NOT set ExpectJson — SPA endpoint legitimately returns HTML.
        } else {
            if ($Ep.Field) { $Params.ExpectedField = $Ep.Field }
            # t/1474 — flag HTML-200 as failure for JSON endpoints. Static endpoints
            # (e.g. /third-party-notices) legitimately return HTML, so they're excluded.
            if ($Ep.Cat -ne 'Static') { $Params.ExpectJson = $true }
        }
        if ($Session) { $Params.Session = $Session }

        $Check = Invoke-RemoteCheck @Params

        # SPA-shell validation: root-div + script-tag both present.
        # If either is missing (blank shell, cache-miss HTML), flip Pass=$false.
        if ($Check.Success -and $Ep.Field -eq '__spa') {
            $HasRootDiv = $Check.RawBody -match '<div\s+id="root"'
            $HasScript  = $Check.RawBody -match 'src="[^"]+\.js"'
            if (-not ($HasRootDiv -and $HasScript)) {
                $Check = [PSCustomObject]@{
                    Success     = $false
                    StatusCode  = $Check.StatusCode
                    ResponseMs  = $Check.ResponseMs
                    Body        = $Check.Body
                    ContentType = $Check.ContentType
                    RawBody     = $Check.RawBody
                    Error       = "SPA shell missing root div or script tag (root-div=$HasRootDiv, script=$HasScript)"
                }
            }
        }

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
