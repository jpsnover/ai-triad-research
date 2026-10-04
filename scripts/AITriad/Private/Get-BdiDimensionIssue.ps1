# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-BdiDimensionIssue {
    <#
    .SYNOPSIS
        Get-BdiWeightIssue sub-helper (t/3879 decomposition): scans one BDI
        dimension (Intentions/operationality, Beliefs/confidence, Desires/priority)
        for out-of-range or unscored (null) weights.
    .PARAMETER LoadedFiles
        Hashtable: povKey -> { Path; Data } (from the load phase).
    .PARAMETER Category
        The BDI category this dimension belongs to (e.g. 'Intentions').
    .PARAMETER Field
        The weight field name on the node (e.g. 'operationality').
    .PARAMETER Min
        Inclusive lower bound of the valid range.
    .PARAMETER Max
        Inclusive upper bound of the valid range.
    .PARAMETER RangeText
        Display text for the range in the out-of-range message (e.g. '1-5' or
        '0.0-1.0') -- kept separate from Min/Max so formatting matches the
        original check's text exactly (double-to-string would drop the ".0").
    .OUTPUTS
        [PSCustomObject] { BadWeights (List[string]); UnscoredList (List[string]) }.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$LoadedFiles,

        [Parameter(Mandatory)]
        [string]$Category,

        [Parameter(Mandatory)]
        [string]$Field,

        [Parameter(Mandatory)]
        [double]$Min,

        [Parameter(Mandatory)]
        [double]$Max,

        [Parameter(Mandatory)]
        [string]$RangeText
    )

    Set-StrictMode -Version Latest

    $BadWeights   = [System.Collections.Generic.List[string]]::new()
    $UnscoredList = [System.Collections.Generic.List[string]]::new()
    foreach ($PovKey in $LoadedFiles.Keys) {
        $Entry = $LoadedFiles[$PovKey]
        if (-not $Entry.Data.PSObject.Properties['nodes']) { continue }
        foreach ($Node in $Entry.Data.nodes) {
            if (-not $Node.PSObject.Properties['category']) { continue }
            if ($Node.category -ne $Category -or -not $Node.PSObject.Properties[$Field]) { continue }
            $Value = $Node.$Field
            if ($null -eq $Value) {
                $UnscoredList.Add("$($Node.id): $Field=null")
            } elseif ($Value -lt $Min -or $Value -gt $Max) {
                $BadWeights.Add("$($Node.id): $Field=$Value (expected $RangeText)")
            }
        }
    }

    return [PSCustomObject]@{ BadWeights = $BadWeights; UnscoredList = $UnscoredList }
}
