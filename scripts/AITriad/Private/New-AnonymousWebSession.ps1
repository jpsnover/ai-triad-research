# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function New-AnonymousWebSession {
    <#
    .SYNOPSIS
        Establishes an anonymous WebRequestSession against an auth endpoint
        and returns the session with any cookies it set.
    .DESCRIPTION
        Shared helper for callers that need an anon cookie jar (e.g.
        Test-TaxEditorEndpoints -AnonymousSession probes Azure Easy Auth's
        /.auth/anonymous; Test-AnonymousDebateFlow uses /api/auth/anonymous
        for the app's own anon flow). Extracted per t/1500 TL note 1 so
        the WebRequestSession + POST + retry boilerplate lives in one
        place.

        Returns the session on any 2xx response so the caller can pass it
        as `-WebSession` to subsequent Invoke-WebRequest calls. Returns
        $null on non-2xx or transport error — the caller decides whether
        that's fatal (Test-TaxEditorEndpoints treats it as a per-endpoint
        skip; Test-AnonymousDebateFlow fails the whole flow). Never throws.
    .PARAMETER BaseUrl
        Base URL (scheme + host, optional trailing slash). Trailing slash
        is stripped before concatenation.
    .PARAMETER Endpoint
        Auth endpoint path. Default '/.auth/anonymous' (Azure Easy Auth
        contract). Pass '/api/auth/anonymous' for the app's own endpoint.
    .PARAMETER Method
        HTTP method. Default 'GET' — Easy Auth accepts GET; the app's
        endpoint expects POST. Callers using the app endpoint should pass
        -Method POST.
    .PARAMETER TimeoutSec
        Per-request timeout. Default 10 seconds.
    .OUTPUTS
        [Microsoft.PowerShell.Commands.WebRequestSession] on 2xx,
        [System.Void]/$null otherwise.
    .EXAMPLE
        # Easy Auth probe (default)
        $session = New-AnonymousWebSession -BaseUrl 'https://taxonomy-editor.example.com'
    .EXAMPLE
        # App endpoint (POST)
        $session = New-AnonymousWebSession -BaseUrl $Base -Endpoint '/api/auth/anonymous' -Method POST
    .LINK
        Test-TaxEditorEndpoints
    .LINK
        Test-AnonymousDebateFlow
    #>
    [CmdletBinding()]
    [OutputType([Microsoft.PowerShell.Commands.WebRequestSession])]
    param(
        [Parameter(Mandatory, Position = 0)]
        [string]$BaseUrl,

        [Parameter()]
        [string]$Endpoint = '/.auth/anonymous',

        [Parameter()]
        [ValidateSet('GET', 'POST')]
        [string]$Method = 'GET',

        [Parameter()]
        [ValidateRange(1, 120)]
        [int]$TimeoutSec = 10
    )

    Set-StrictMode -Version Latest

    $Base = $BaseUrl.TrimEnd('/')
    if (-not $Endpoint.StartsWith('/')) { $Endpoint = "/$Endpoint" }
    $Url = "$Base$Endpoint"
    $Session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()

    try {
        $InvokeArgs = @{
            Uri             = $Url
            Method          = $Method
            WebSession      = $Session
            TimeoutSec      = $TimeoutSec
            ErrorAction     = 'Stop'
            UseBasicParsing = $true
        }
        if ($Method -eq 'POST') {
            $InvokeArgs['Body']        = '{}'
            $InvokeArgs['ContentType'] = 'application/json'
        }
        $Response = Invoke-WebRequest @InvokeArgs
        if ($Response.StatusCode -ge 200 -and $Response.StatusCode -lt 300) {
            return $Session
        }
        Write-Verbose "New-AnonymousWebSession: $Url returned $($Response.StatusCode); no session established"
        return $null
    } catch {
        Write-Verbose "New-AnonymousWebSession: $Url failed: $($_.Exception.Message)"
        return $null
    }
}
