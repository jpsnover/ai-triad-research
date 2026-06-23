# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function New-CuiTestResult {
    <#
    .SYNOPSIS
        Constructs a structured CUI test result from individual check results.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$CuiId,

        [Parameter(Mandatory)]
        [string]$Domain,

        [Parameter(Mandatory)]
        [string]$Priority,

        [Parameter(Mandatory)]
        [long]$DurationMs,

        [Parameter()]
        [PSObject[]]$Details = @(),

        [Parameter()]
        [string]$Error
    )

    $PassedCount = @($Details | Where-Object { $_.Pass }).Count
    $FailedCount = @($Details | Where-Object { -not $_.Pass }).Count
    $AllPass = $FailedCount -eq 0 -and -not $Error -and @($Details).Count -gt 0

    [PSCustomObject]@{
        PSTypeName = 'CuiTestResult'
        CuiId      = $CuiId
        Domain     = $Domain
        Priority   = $Priority
        Pass       = $AllPass
        DurationMs = $DurationMs
        Checks     = @($Details).Count
        Passed     = $PassedCount
        Failed     = $FailedCount
        Details    = $Details
        Error      = $Error
    }
}

function New-CuiCheckResult {
    <#
    .SYNOPSIS
        Constructs a single check result within a CUI test.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Check,

        [Parameter(Mandatory)]
        [bool]$Pass,

        [Parameter()]
        [string]$Detail,

        [Parameter()]
        [int]$Ms = 0
    )

    [PSCustomObject]@{
        PSTypeName = 'CuiCheckResult'
        Check      = $Check
        Pass       = $Pass
        Detail     = $Detail
        Ms         = $Ms
    }
}
