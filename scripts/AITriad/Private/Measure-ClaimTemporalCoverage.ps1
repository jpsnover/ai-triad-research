# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Measure-ClaimTemporalCoverage {
    <#
    .SYNOPSIS
        Part of Measure-TaxonomyBaseline's ontology-coverage metric (t/3910
        decomposition; no behavior change): temporal_scope coverage on summaries'
        factual_claims.
    .PARAMETER Summaries
        Doc id -> summary lookup.
    .OUTPUTS
        [PSCustomObject] { TotalClaims; ClaimsWithTemporal }.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$Summaries
    )

    Set-StrictMode -Version Latest

    $TotalClaims = 0; $ClaimsWithTemporal = 0
    foreach ($Sum in $Summaries.Values) {
        if (-not $Sum.factual_claims) { continue }
        foreach ($Claim in @($Sum.factual_claims)) {
            $TotalClaims++
            if ($Claim.PSObject.Properties['temporal_scope'] -and $Claim.temporal_scope) { $ClaimsWithTemporal++ }
        }
    }

    return [PSCustomObject]@{
        TotalClaims        = $TotalClaims
        ClaimsWithTemporal = $ClaimsWithTemporal
    }
}
