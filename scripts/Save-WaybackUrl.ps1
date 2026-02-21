<#
.SYNOPSIS
    Submit a URL to the Wayback Machine (Internet Archive).

.DESCRIPTION
    Fire-and-forget: failures are logged but do not block ingestion.

.PARAMETER Url
    The URL to submit to the Wayback Machine.

.EXAMPLE
    .\scripts\Save-WaybackUrl.ps1 -Url 'https://example.com/article'

.NOTES
    TODO: Implement using Invoke-RestMethod to POST to
          https://web.archive.org/save/<url>
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$Url
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Output "TODO: Save-WaybackUrl.ps1 not yet implemented for $Url"
exit 0
