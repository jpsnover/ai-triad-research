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

        PRE-EXISTING BUG, reproduced bug-for-bug (not fixed here; t/3910 pure-refactor rule;
        filed separately): in the fallback branch, $Summary.factual_claims is an unguarded
        dot-access. Under Set-StrictMode, a summary that was parsed successfully but lacks a
        factual_claims key (e.g. a model_info-only or ai_model-only summary) throws
        PropertyNotFoundException here instead of defaulting to 0.
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
        # Fall back to computing from summary file
        if ($Summary.factual_claims) {
            $TotalClaims = @($Summary.factual_claims).Count
        }

        foreach ($Claim in @($Summary.factual_claims)) {
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

        foreach ($Pov_ in @('accelerationist', 'safetyist', 'skeptic')) {
            $PovData = $Summary.pov_summaries.$Pov_
            if ($PovData -and $PovData.PSObject.Properties['key_points'] -and $PovData.key_points) {
                $TotalFacts += @($PovData.key_points).Count
            }
        }

        if ($Summary.unmapped_concepts) {
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
