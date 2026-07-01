# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-OrganizationStakeholders {
    <#
    .SYNOPSIS
        Given a policy action id, return organizations supporting and opposing it.
    .DESCRIPTION
        Reads policy_engagement from each organization record and buckets by
        stance. Returns an [OrganizationStakeholders] object with two arrays:
        Supporters and Opposers.

        Reads from the org file directly (not edges.json) per t/1224 TL guidance —
        the policy_engagement field is the reverse-index-friendly source of truth
        for policy queries.
    .PARAMETER PolicyId
        Policy action id (pol-NNN).
    .OUTPUTS
        [OrganizationStakeholders]
    .EXAMPLE
        Get-OrganizationStakeholders -PolicyId pol-028
    #>
    [CmdletBinding()]
    [OutputType('OrganizationStakeholders')]
    param(
        [Parameter(Mandatory)]
        [ValidatePattern('^pol-\d+$')]
        [string]$PolicyId
    )

    Set-StrictMode -Version Latest

    $store = Get-OrganizationsStore
    $orgs = @()
    if ($store.PSObject.Properties['organizations']) { $orgs = @($store.organizations) }

    $supporters = [System.Collections.Generic.List[Organization]]::new()
    $opposers   = [System.Collections.Generic.List[Organization]]::new()

    foreach ($raw in $orgs) {
        if (-not $raw.PSObject.Properties['policy_engagement']) { continue }
        foreach ($p in @($raw.policy_engagement)) {
            $pref = if ($p.PSObject.Properties['policy_ref']) { [string]$p.policy_ref } else { '' }
            if ($pref -ne $PolicyId) { continue }
            $stance = if ($p.PSObject.Properties['stance']) { [string]$p.stance } else { '' }
            $typed = ConvertTo-OrganizationObject -Raw $raw
            switch ($stance) {
                'supports' { $supporters.Add($typed) }
                'opposes'  { $opposers.Add($typed) }
            }
            break
        }
    }

    $result = [OrganizationStakeholders]::new()
    $result.PolicyId   = $PolicyId
    $result.Supporters = $supporters.ToArray()
    $result.Opposers   = $opposers.ToArray()
    return $result
}
