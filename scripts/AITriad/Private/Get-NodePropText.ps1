# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-NodePropText {
    <#
    .SYNOPSIS
        Build the directional-gate node proposition text: 'label — Core', with the
        Encompasses:/Excludes: tail stripped (t/2900).
    .DESCRIPTION
        Single-sourced node_prop builder so every consumer — the polarity gate
        (Invoke-PolarityGatePass), the acceptance harness, and V1
        (Invoke-OrgClaimMatching) — feeds the directional engine BYTE-IDENTICAL
        node_prop (TL cross-surface ruling; fixture requirement t/2739). Extracted
        from the gate's former inline construction so the acceptance harness can
        reproduce the pinned deberta verdicts against the exact gate text (CL t/2900#12).

        node_prop = "<label> — <description with the Encompasses:/Excludes: tail
        stripped, trimmed>"; label-only when there is no description.
    .PARAMETER Node
        A taxonomy node object (from $script:TaxonomyData) with .label and .description.
    .OUTPUTS
        [string] the node proposition text.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)] $Node)

    $lbl = if ($Node.PSObject.Properties['label']) { [string]$Node.label } else { '' }
    $dsc = if ($Node.PSObject.Properties['description'] -and $Node.description) { [string]$Node.description } else { '' }
    $dsc = $dsc -replace '(?s)\s*(Encompasses|Excludes)\s*:.*$', ''
    if ($dsc) { return "$lbl — $($dsc.Trim())" }
    return $lbl
}
