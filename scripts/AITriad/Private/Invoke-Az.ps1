# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-Az {
    <#
    .SYNOPSIS
        Runs the Azure CLI with a captured stdout string and non-zero-exit error handling.
    .DESCRIPTION
        Thin wrapper around `& az ...` that:
          - passes args as a positional array (avoids Windows quoting traps)
          - captures stdout as a single string for JSON parsing
          - throws ActionableError on non-zero exit
          - returns $null when stdout is empty (matches PS pipeline conventions)

        Exists so cmdlets can mock the Azure CLI in Pester (t/1498).
    .PARAMETER Arguments
        The az CLI argument array, e.g. @('containerapp', 'revision', 'list', '--name', 'x').
        Do NOT include 'az' itself.
    .PARAMETER CallerName
        Location string used in the thrown error's ActionableError.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments,

        [Parameter()]
        [string]$CallerName = 'Invoke-Az'
    )

    Set-StrictMode -Version Latest

    $Output = & az @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw (New-ActionableError `
            -Goal "Run az $($Arguments -join ' ')" `
            -Problem "Azure CLI exit $LASTEXITCODE" `
            -Location $CallerName `
            -NextSteps @('Verify az login: az account show',
                         'Check the arguments passed to Invoke-Az',
                         "Output: $Output"))
    }
    if (-not $Output) { return $null }
    ($Output | Out-String).Trim()
}
