# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Save-BriefArtifact {
    <#
    .SYNOPSIS
        Download one brief-export artifact from the T6 API to a local file (t/2862).
    .DESCRIPTION
        GETs `/api/exports/<ExportId>/artifacts/<Name>` and streams it to -Destination via
        `Invoke-WebRequest -OutFile` (binary-safe — brief.pptx is not JSON, so the
        Invoke-RemoteCheck JSON path is unsuitable here). Passes the caller's auth headers
        (AAD bearer) unchanged. Throws on any non-success; Export-TriadDebateBrief's server
        branch maps the failure to a non-terminating RenderFailure. Isolated so tests can
        mock the download without a live server.
    .PARAMETER BaseUrl
        Deployed base URL (no trailing slash).
    .PARAMETER ExportId
        The completed export's id (from the finished job).
    .PARAMETER Name
        Canonical artifact filename (deck_spec.json / narration.json / audit-manifest.json / brief.pptx).
    .PARAMETER Destination
        Local file path to write.
    .PARAMETER Headers
        Optional request headers (e.g. Authorization: Bearer <token>).
    .PARAMETER TimeoutSec
        Per-download timeout. Default 300.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory)] [string]$BaseUrl,
        [Parameter(Mandatory)] [string]$ExportId,
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [string]$Destination,
        [Parameter()] [hashtable]$Headers,
        [Parameter()] [ValidateRange(1, 3600)] [int]$TimeoutSec = 300
    )

    Set-StrictMode -Version Latest

    $uri = "$BaseUrl/api/exports/$ExportId/artifacts/$Name"
    $webParams = @{
        Uri             = $uri
        Method          = 'GET'
        OutFile         = $Destination
        TimeoutSec      = $TimeoutSec
        UseBasicParsing = $true
        ErrorAction     = 'Stop'
    }
    if ($Headers -and $Headers.Count -gt 0) { $webParams.Headers = $Headers }

    $null = Invoke-WebRequest @webParams
}
