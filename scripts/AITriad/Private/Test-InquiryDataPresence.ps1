# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-InquiryDataPresence {
    <#
    .SYNOPSIS
        Asserts an InquiryResult carries REAL data, not an ADR-001 graceful-empty shell.
    .DESCRIPTION
        The dual-build silent-empty escape (t/2648, t/2661; t/3584): on the hosted web
        profile an inquiry can return a valid-shaped InquiryResult with every array EMPTY
        (ADR-001 graceful-empty on a failed corpus read) and NO error. "Renders without
        error" and "status == done" both pass on that shell — a smoke of that kind passed
        26/26 green while a feature was visibly broken.

        This helper asserts the POSITIVE outcome — count > 0 on the three load-bearing
        arrays a genuine inquiry always produces — so the empty shell FAILS:
          - result.campVerdicts          : >= 1 verdict
          - result.calibration           : >= 1 metric entry
          - result.grounding.nodesByCamp : >= 1 grounding node summed across camps

        Pure + free of I/O so it is unit-tested against fixtures (both arms) with no auth
        or network — see tests/Test-TaxEditorInquiry.Tests.ps1. `CalibrationWithValue` is a
        diagnostic-only count (a fully-censored real inquiry can have entries with null
        values, so the gate is entry-COUNT, not value-presence, to avoid false failures).
    .PARAMETER Result
        The `result` object from a terminal GET /api/inquiry/:jobId response.
    .OUTPUTS
        [PSCustomObject] with Pass, CampVerdicts, Calibration, CalibrationWithValue,
        GroundingNodes, Reasons.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        [object]$Result
    )

    Set-StrictMode -Version Latest

    # StrictMode-safe property read for hashtables or [pscustomobject] (fixtures use both).
    function script:Get-InqProp($Obj, [string]$Name) {
        if ($null -eq $Obj) { return $null }
        if ($Obj -is [hashtable]) {
            if ($Obj.ContainsKey($Name)) { return $Obj[$Name] } else { return $null }
        }
        $p = $Obj.PSObject.Properties[$Name]
        if ($p) { return $p.Value } else { return $null }
    }

    $campVerdicts = @(script:Get-InqProp $Result 'campVerdicts')
    $calibration  = @(script:Get-InqProp $Result 'calibration')
    $grounding    = script:Get-InqProp $Result 'grounding'
    $nodesByCamp  = script:Get-InqProp $grounding 'nodesByCamp'

    $campVerdictCount = @($campVerdicts | Where-Object { $null -ne $_ }).Count
    $calibrationCount = @($calibration | Where-Object { $null -ne $_ }).Count
    $calibrationWithValue = @($calibration | Where-Object { $null -ne $_ -and $null -ne (script:Get-InqProp $_ 'value') }).Count

    $groundingNodeCount = 0
    if ($null -ne $nodesByCamp) {
        if ($nodesByCamp -is [hashtable]) {
            foreach ($k in $nodesByCamp.Keys) { $groundingNodeCount += @($nodesByCamp[$k] | Where-Object { $null -ne $_ }).Count }
        } else {
            foreach ($p in $nodesByCamp.PSObject.Properties) { $groundingNodeCount += @($p.Value | Where-Object { $null -ne $_ }).Count }
        }
    }

    $reasons = [System.Collections.Generic.List[string]]::new()
    if ($campVerdictCount -le 0)   { $reasons.Add('campVerdicts empty (no camp reached a verdict)') }
    if ($calibrationCount -le 0)   { $reasons.Add('calibration empty (no metrics)') }
    if ($groundingNodeCount -le 0) { $reasons.Add('grounding.nodesByCamp has no nodes (corpus read likely empty — ADR-001 graceful-empty)') }

    [PSCustomObject]@{
        Pass                 = ($reasons.Count -eq 0)
        CampVerdicts         = $campVerdictCount
        Calibration          = $calibrationCount
        CalibrationWithValue = $calibrationWithValue
        GroundingNodes       = $groundingNodeCount
        Reasons              = $reasons.ToArray()
    }
}
