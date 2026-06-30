# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-RemoteCheck {
    <#
    .SYNOPSIS
        Makes an HTTP request to a remote endpoint and returns a structured result.
    .DESCRIPTION
        Default-GET smoke-check helper used by Test-TaxEditorEndpoints and
        Test-AnonymousDebateFlow. Optional -Body, -Session, and -ExtraHeaders
        allow POST/PUT flows with cookie persistence across calls (anonymous
        session smoke test, etc).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$BaseUrl,

        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter()]
        [ValidateSet('GET', 'POST', 'PUT', 'DELETE')]
        [string]$Method = 'GET',

        [Parameter()]
        [int]$TimeoutSec = 10,

        [Parameter()]
        [string]$ExpectedField,

        [Parameter()]
        [int[]]$AcceptableStatusCodes = @(200),

        # Optional request body. Hashtables/objects are JSON-encoded automatically
        # and Content-Type is set to application/json.
        [Parameter()]
        [object]$Body,

        # Optional shared WebRequestSession for cookie persistence across calls.
        [Parameter()]
        [Microsoft.PowerShell.Commands.WebRequestSession]$Session,

        # Optional extra headers merged on top of the default Accept: application/json.
        [Parameter()]
        [hashtable]$ExtraHeaders
    )

    $Url = "$BaseUrl$Path"
    $Sw = [System.Diagnostics.Stopwatch]::StartNew()

    $Headers = @{ 'Accept' = 'application/json' }
    if ($ExtraHeaders) {
        foreach ($K in $ExtraHeaders.Keys) { $Headers[$K] = $ExtraHeaders[$K] }
    }

    $WebParams = @{
        Uri             = $Url
        Method          = $Method
        TimeoutSec      = $TimeoutSec
        UseBasicParsing = $true
        ErrorAction     = 'Stop'
        Headers         = $Headers
    }
    if ($PSBoundParameters.ContainsKey('Body') -and $null -ne $Body) {
        if ($Body -is [string]) {
            $WebParams.Body = $Body
        } else {
            $WebParams.Body = ($Body | ConvertTo-Json -Depth 10 -Compress)
        }
        $WebParams.ContentType = 'application/json'
    }
    if ($Session) {
        $WebParams.WebSession = $Session
    }

    try {
        $Response = Invoke-WebRequest @WebParams
        $Sw.Stop()

        $StatusCode = $Response.StatusCode
        $Body = $null
        if ($Response.Content) {
            try { $Body = $Response.Content | ConvertFrom-Json } catch { $Body = $null }
        }

        $Success = $StatusCode -in $AcceptableStatusCodes
        if ($Success -and $ExpectedField -and $Body) {
            if (-not $Body.PSObject.Properties[$ExpectedField]) {
                $Success = $false
            }
        }

        [PSCustomObject]@{
            Success    = $Success
            StatusCode = $StatusCode
            ResponseMs = $Sw.ElapsedMilliseconds
            Body       = $Body
            Error      = $null
        }
    }
    catch {
        $Sw.Stop()
        $StatusCode = 0
        if ($_.Exception.PSObject.Properties['Response'] -and $_.Exception.Response) {
            $StatusCode = [int]$_.Exception.Response.StatusCode
        }
        [PSCustomObject]@{
            Success    = $false
            StatusCode = $StatusCode
            ResponseMs = $Sw.ElapsedMilliseconds
            Body       = $null
            Error      = $_.Exception.Message
        }
    }
}
