# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Assert-NoRetiredNodeRefs {
    <#
    .SYNOPSIS
        Fails closed if any crux carries a retired cc-* node reference in its
        linked_node_ids.
    .DESCRIPTION
        The cc-* node id-space was retired and migrated to sit-* (t/1308). A
        freshly rebuilt derived artifact (e.g. aggregated-cruxes.json) must never
        re-introduce cc-* references — their presence means a source index still
        holds retired vectors, which silently degrades downstream consumers such
        as corpusCoverage (t/3472). This guard makes that invariant structural:
        it throws an actionable error instead of writing a contaminated artifact.

        Accepts both [ordered]/hashtable entries (as Export-AggregatedCruxes emits)
        and [PSCustomObject] entries (as tests/JSON round-trips produce).
    .PARAMETER Cruxes
        The collection of crux objects to check. Each may expose 'id' and
        'linked_node_ids'. An empty collection passes.
    .PARAMETER Context
        Human-readable label for the artifact being validated, used in the error.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [AllowNull()]
        $Cruxes,

        [string]$Context = 'rebuilt artifact'
    )

    Set-StrictMode -Version Latest

    $Bad = [System.Collections.Generic.List[string]]::new()

    foreach ($Crux in @($Cruxes)) {
        if ($null -eq $Crux) { continue }

        $Id = '<no-id>'
        $Links = @()
        if ($Crux -is [System.Collections.IDictionary]) {
            if ($Crux.Contains('id')) { $Id = $Crux['id'] }
            if ($Crux.Contains('linked_node_ids')) { $Links = @($Crux['linked_node_ids']) }
        }
        else {
            if ($Crux.PSObject.Properties['id']) { $Id = $Crux.id }
            if ($Crux.PSObject.Properties['linked_node_ids']) { $Links = @($Crux.linked_node_ids) }
        }

        foreach ($Link in $Links) {
            if ($Link -is [string] -and $Link -match '^cc-') {
                $Bad.Add(('{0} -> {1}' -f $Id, $Link))
            }
        }
    }

    if ($Bad.Count -gt 0) {
        New-ActionableError `
            -Goal "Produce $Context free of retired cc-* node references (t/3472, cc→sit migration t/1308)" `
            -Problem "$($Bad.Count) retired cc-* linked_node_ids present: $($Bad -join ', ')" `
            -Location 'Assert-NoRetiredNodeRefs' `
            -NextSteps 'A source index still carries retired cc-* vectors. Regenerate embeddings.json (t/1308 cc→sit) so retired ids resolve to sit-*, then re-run the rebuild.' `
            -Throw
    }
}
