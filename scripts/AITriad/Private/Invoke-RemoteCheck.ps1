# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-RemoteCheck {
    <#
    .SYNOPSIS
        Makes an HTTP request to a remote endpoint and returns a structured result.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$BaseUrl,

        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter()]
        [ValidateSet('GET', 'POST')]
        [string]$Method = 'GET',

        [Parameter()]
        [int]$TimeoutSec = 10,

        [Parameter()]
        [string]$ExpectedField,

        [Parameter()]
        [int[]]$AcceptableStatusCodes = @(200)
    )

    $Url = "$BaseUrl$Path"
    $Sw = [System.Diagnostics.Stopwatch]::StartNew()

    try {
        $Response = Invoke-WebRequest -Uri $Url -Method $Method `
            -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction Stop `
            -Headers @{ 'Accept' = 'application/json' }
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
