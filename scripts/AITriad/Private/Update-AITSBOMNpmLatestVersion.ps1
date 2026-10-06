# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Update-AITSBOMNpmLatestVersion {
    <#
    .SYNOPSIS
        'npm' arm of Get-AITSBOM's -CheckUpdates dispatch: retried via
        Invoke-WithRecovery. Extracted verbatim (t/3910) -- no behavior
        change.
    .PARAMETER Entry
        One SBOM entry (mutated in place: LatestVersion, Status).
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory)]
        [PSObject]$Entry
    )

    Set-StrictMode -Version Latest

    try {
        $Latest = Invoke-WithRecovery -Goal "check npm registry for $($Entry.Name)" `
            -Location 'Get-AITSBOM' -MaxRetries 1 -RetryDelaySeconds 2 `
            -Action {
                $Result = npm view $Entry.Name version 2>$null
                if ($LASTEXITCODE -ne 0) { throw "npm view failed" }
                $Result.Trim()
            } `
            -NextSteps @('Check network connectivity', 'Verify npm is installed')
        $Entry.LatestVersion = $Latest
        $Entry.Status = if ($Entry.Version -eq $Latest) { 'up-to-date' } else { 'outdated' }
    }
    catch { $Entry.Status = 'unknown' }
}
