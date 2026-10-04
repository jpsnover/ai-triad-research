# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-BdiWeightIssue {
    <#
    .SYNOPSIS
        Test-TaxonomyIntegrity's BDI weight range check (t/3879 decomposition --
        extracted verbatim, no behavior change): Intentions/Beliefs/Desires carry
        operationality/confidence/priority within their schema range.
    .DESCRIPTION
        Distinguishes "out-of-range" (Error -- value present but violates the schema
        range) from "unscored" (Warning -- value null, node was never assigned).
        Refined under t/1320: null confidence/priority/operationality is a semantic
        gap (needs re-run of Invoke-BDIWeightAssignment) not a data corruption bug,
        and treating it as Error was blocking Test-TaxonomyIntegrity error count = 0
        even when the taxonomy was otherwise clean. Passed reflects ONLY the
        out-of-range outcome -- a taxonomy with unscored-but-in-range weights still
        passes this check (it still surfaces as a separate Warning issue).

        Complexity budget (t/3829): the three BDI dimensions are structurally
        identical, so each is scanned by the shared Get-BdiDimensionIssue helper
        and the results merged here. Output is unchanged.
    .PARAMETER LoadedFiles
        Hashtable: povKey -> { Path; Data } (from the load phase).
    .OUTPUTS
        [PSCustomObject] { Passed (bool); Issues (List[PSCustomObject], 0-2 entries) }.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$LoadedFiles
    )

    Set-StrictMode -Version Latest

    $Dimensions = @(
        @{ Category = 'Intentions'; Field = 'operationality'; Min = 1;   Max = 5;   RangeText = '1-5' }
        @{ Category = 'Beliefs';    Field = 'confidence';     Min = 0.0; Max = 1.0; RangeText = '0.0-1.0' }
        @{ Category = 'Desires';    Field = 'priority';       Min = 1;   Max = 5;   RangeText = '1-5' }
    )

    $BadWeights   = [System.Collections.Generic.List[string]]::new()
    $UnscoredList = [System.Collections.Generic.List[string]]::new()
    foreach ($Dim in $Dimensions) {
        $Result = Get-BdiDimensionIssue -LoadedFiles $LoadedFiles -Category $Dim.Category -Field $Dim.Field -Min $Dim.Min -Max $Dim.Max -RangeText $Dim.RangeText
        foreach ($W in $Result.BadWeights) { $BadWeights.Add($W) }
        foreach ($U in $Result.UnscoredList) { $UnscoredList.Add($U) }
    }

    $Issues = [System.Collections.Generic.List[PSCustomObject]]::new()
    $Passed = $true
    if ($BadWeights.Count -gt 0) {
        $Detail = ($BadWeights | Select-Object -First 10) -join '; '
        $Issues.Add([PSCustomObject]@{ Check = 'BDIWeightRange'; Severity = 'Error'; Count = $BadWeights.Count; Detail = "Out-of-range BDI weights: $Detail" })
        $Passed = $false
    }
    if ($UnscoredList.Count -gt 0) {
        $Detail = ($UnscoredList | Select-Object -First 10) -join '; '
        $Issues.Add([PSCustomObject]@{ Check = 'UnscoredBDIWeight'; Severity = 'Warning'; Count = $UnscoredList.Count; Detail = "BDI weight unscored (null): $Detail. Fix: re-run Invoke-BDIWeightAssignment on these nodes." })
    }

    return [PSCustomObject]@{ Passed = $Passed; Issues = $Issues }
}
