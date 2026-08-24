# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Resolve-NliLabelOrDefault {
    <#
    .SYNOPSIS
        Return a similar pair's NLI label, failing CLOSED to 'neutral' when absent.
    .DESCRIPTION
        Used by Find-SituationCandidates when labeling shared-concept clusters. NLI
        classification can be skipped (-NoNLI) or fail at runtime, leaving a pair with
        no NliLabel. Such a pair must NOT be assumed to be verified agreement: it is
        embedding-similar but its directional relationship is unverified. Defaulting to
        'entailment' (the prior behavior) asserted shared-concept agreement we never
        confirmed — a fail-OPEN bug (t/2747). This resolves to 'neutral' instead, so an
        unverified pair is surfaced as a candidate without claiming entailment.
    .PARAMETER Pair
        A similar-pair object that may carry an 'NliLabel' note property.
    .OUTPUTS
        [string] the pair's NliLabel when present and non-empty, otherwise 'neutral'.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [PSObject]$Pair
    )

    Set-StrictMode -Version Latest

    if ($Pair.PSObject.Properties['NliLabel'] -and $Pair.NliLabel) {
        return [string]$Pair.NliLabel
    }
    return 'neutral'
}
