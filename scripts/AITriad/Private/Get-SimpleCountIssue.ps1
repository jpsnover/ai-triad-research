# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-SimpleCountIssue {
    <#
    .SYNOPSIS
        Shared shape for Test-TaxonomyIntegrity's simplest checks (t/3879 decomposition):
        "if a pre-computed list is non-empty, emit one issue naming the count; otherwise
        pass" -- Check 2 (MissingPolicyId) and Check 3 (DuplicateRef) are both exactly this,
        differing only in which list, the Check name, Severity, and detail wording. Extracted
        as one shared helper rather than two near-duplicate files.
    .PARAMETER Items
        The pre-computed list to count (from the load phase).
    .PARAMETER Check
        The issue's Check name (e.g. 'MissingPolicyId').
    .PARAMETER Severity
        'Error' or 'Warning'.
    .PARAMETER DetailFormat
        A -f format string with exactly one {0} placeholder for Items.Count.
    .OUTPUTS
        [PSCustomObject] { Passed (bool); Issue (PSCustomObject or $null) }.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Items,

        [Parameter(Mandatory)]
        [string]$Check,

        [Parameter(Mandatory)]
        [string]$Severity,

        [Parameter(Mandatory)]
        [string]$DetailFormat
    )

    Set-StrictMode -Version Latest

    if ($Items.Count -gt 0) {
        return [PSCustomObject]@{
            Passed = $false
            Issue  = [PSCustomObject]@{ Check = $Check; Severity = $Severity; Count = $Items.Count; Detail = ($DetailFormat -f $Items.Count) }
        }
    }
    return [PSCustomObject]@{ Passed = $true; Issue = $null }
}
