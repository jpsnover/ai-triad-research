# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function ConvertTo-AITSourceClaimsByPov {
    <#
    .SYNOPSIS
        Builds the ClaimsByPov PSCustomObject from an index entry or metadata object (t/3910
        decomposition, no behavior change). Shared by both Get-AITSource code paths.
    .DESCRIPTION
        Prefers the new node_references_by_pov key, falls back to the legacy claims_by_pov
        key, and defaults every count to 0 when the chosen key or its sub-fields are absent.
    .PARAMETER Meta
        The index entry OR the parsed metadata.json object.
    .OUTPUTS
        [PSCustomObject] { Accelerationist; Safetyist; Skeptic; Situations }
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param([Parameter(Mandatory)][PSObject]$Meta)
    Set-StrictMode -Version Latest

    $ClaimsPov = [PSCustomObject]@{ Accelerationist = 0; Safetyist = 0; Skeptic = 0; Situations = 0 }
    $Props = $Meta.PSObject.Properties
    $CbpKey = if ($Props['node_references_by_pov']) { 'node_references_by_pov' } elseif ($Props['claims_by_pov']) { 'claims_by_pov' } else { $null }
    if ($CbpKey -and $Meta.$CbpKey) {
        $Cbp = $Meta.$CbpKey
        $CbpProps = $Cbp.PSObject.Properties
        $ClaimsPov.Accelerationist = if ($CbpProps['accelerationist']) { [int]$Cbp.accelerationist } else { 0 }
        $ClaimsPov.Safetyist       = if ($CbpProps['safetyist'])       { [int]$Cbp.safetyist }       else { 0 }
        $ClaimsPov.Skeptic         = if ($CbpProps['skeptic'])         { [int]$Cbp.skeptic }         else { 0 }
        $ClaimsPov.Situations      = if ($CbpProps['situations'])      { [int]$Cbp.situations }      else { 0 }
    }
    return $ClaimsPov
}
