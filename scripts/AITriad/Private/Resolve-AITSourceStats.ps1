# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Resolve-AITSourceStats {
    <#
    .SYNOPSIS
        Resolves TotalClaims/ClaimsByPov/TotalFacts/UnmappedConcepts for the full-scan path
        (t/3910 decomposition of Get-AITSource, no behavior change).
    .DESCRIPTION
        Prefers stats cached in metadata (written by Invoke-POVSummary); falls back to
        computing from the parsed summary file when metadata has no cached total_claims.

        Every summary key read in the fallback branch (factual_claims, pov_summaries,
        unmapped_concepts) is guarded, so a summary that parsed successfully but lacks them
        (e.g. a model_info-only or legacy ai_model-only summary) yields zeros rather than a
        StrictMode PropertyNotFoundException (fixed in t/4008; was reproduced bug-for-bug by
        the t/3910 refactor).
    .PARAMETER Meta
        The parsed metadata.json object.
    .PARAMETER Summary
        The parsed summary JSON object, or $null if none exists / failed to parse.
    .OUTPUTS
        [PSCustomObject] { TotalClaims; ClaimsByPov; TotalFacts; UnmappedConcepts }
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)][PSObject]$Meta,
        [AllowNull()][PSObject]$Summary
    )
    Set-StrictMode -Version Latest

    $Props = $Meta.PSObject.Properties
    $TotalClaims      = 0
    $ClaimsPov        = [PSCustomObject]@{ Accelerationist = 0; Safetyist = 0; Skeptic = 0; Situations = 0 }
    $TotalFacts       = 0
    $UnmappedConcepts = 0

    if ($Props['total_claims']) {
        # Stats cached in metadata (written by Invoke-POVSummary)
        $TotalClaims = [int]$Meta.total_claims
        $TotalFacts  = [int](Get-AITSourcePropValue -Object $Meta -Name 'total_facts' -Default 0)
        if ($Props['unmapped_concepts'] -and $Meta.unmapped_concepts -is [int]) { $UnmappedConcepts = [int]$Meta.unmapped_concepts } else { $UnmappedConcepts = 0 }
        $ClaimsPov = ConvertTo-AITSourceClaimsByPov -Meta $Meta
    }
    elseif ($null -ne $Summary) {
        # Fall back to computing from summary file. Every top-level key is guarded via
        # PSObject.Properties (t/4008): a parsed summary may lack any of them (model_info-only /
        # legacy ai_model-only), and a bare dot-access on an absent property throws under StrictMode.
        # (Explicit guards, not @(Get-AITSourcePropValue -Default $null): @($null) is a 1-element array.)
        # The @() must wrap the whole `if` statement: statement output is enumerated, so
        # `$x = if (..) { @(..) } else { @() }` collapses an empty array to $null (and 1 item to a scalar).
        $SummaryProps  = $Summary.PSObject.Properties
        $FactualClaims = @(if ($SummaryProps['factual_claims'] -and $Summary.factual_claims) { $Summary.factual_claims })
        $TotalClaims   = $FactualClaims.Count

        foreach ($Claim in $FactualClaims) {
            if (-not $Claim.PSObject.Properties['linked_taxonomy_nodes']) { continue }
            $Nodes = @($Claim.linked_taxonomy_nodes)
            if ($Nodes.Count -eq 0) { continue }
            foreach ($NodeId in $Nodes) {
                if     ($NodeId -like 'acc-*') { $ClaimsPov.Accelerationist++ }
                elseif ($NodeId -like 'saf-*') { $ClaimsPov.Safetyist++ }
                elseif ($NodeId -like 'skp-*') { $ClaimsPov.Skeptic++ }
                elseif ($NodeId -like 'sit-*') { $ClaimsPov.Situations++ }
            }
        }

        $PovSummaries = if ($SummaryProps['pov_summaries']) { $Summary.pov_summaries } else { $null }
        foreach ($Pov_ in @('accelerationist', 'safetyist', 'skeptic')) {
            $PovData = if ($PovSummaries -and $PovSummaries.PSObject.Properties[$Pov_]) { $PovSummaries.$Pov_ } else { $null }
            if ($PovData -and $PovData.PSObject.Properties['key_points'] -and $PovData.key_points) {
                $TotalFacts += @($PovData.key_points).Count
            }
        }

        if ($SummaryProps['unmapped_concepts'] -and $Summary.unmapped_concepts) {
            $UnmappedConcepts = @($Summary.unmapped_concepts).Count
        }
    }

    return [PSCustomObject]@{
        TotalClaims      = $TotalClaims
        ClaimsByPov      = $ClaimsPov
        TotalFacts       = $TotalFacts
        UnmappedConcepts = $UnmappedConcepts
    }
}
