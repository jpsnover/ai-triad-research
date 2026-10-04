# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-DanglingLinkedIssue {
    <#
    .SYNOPSIS
        Test-TaxonomyIntegrity's Check 9 (t/3879 decomposition -- extracted verbatim, no
        behavior change): a situation's linked_nodes[] must resolve to real nodes.
    .PARAMETER LoadedFiles
        Hashtable: povKey -> { Path; Data } (from the load phase).
    .PARAMETER AllNodeIds
        HashSet[string] of every node id across all POV files + situations.
    .OUTPUTS
        [PSCustomObject] { DanglingLinked (List, threaded back for -Repair); Passed (bool);
        Issue (PSCustomObject or $null) }.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$LoadedFiles,

        [Parameter(Mandatory)]
        [System.Collections.Generic.HashSet[string]]$AllNodeIds
    )

    Set-StrictMode -Version Latest

    $DanglingLinked = [System.Collections.Generic.List[PSCustomObject]]::new()
    if ($LoadedFiles.ContainsKey('situations')) {
        foreach ($Node in $LoadedFiles['situations'].Data.nodes) {
            if (-not $Node.PSObject.Properties['linked_nodes'] -or $null -eq $Node.linked_nodes) { continue }
            foreach ($Linked in @($Node.linked_nodes)) {
                if (-not $AllNodeIds.Contains($Linked)) {
                    $DanglingLinked.Add([PSCustomObject]@{ NodeId = $Node.id; LinkedId = $Linked })
                }
            }
        }
    }

    if ($DanglingLinked.Count -gt 0) {
        $Detail = ($DanglingLinked | ForEach-Object { "$($_.NodeId) -> $($_.LinkedId)" }) -join '; '
        return [PSCustomObject]@{
            DanglingLinked = $DanglingLinked
            Passed         = $false
            Issue          = [PSCustomObject]@{ Check = 'DanglingLinked'; Severity = 'Warning'; Count = $DanglingLinked.Count; Detail = "linked_nodes ref non-existent nodes: $Detail" }
        }
    }
    return [PSCustomObject]@{ DanglingLinked = $DanglingLinked; Passed = $true; Issue = $null }
}
