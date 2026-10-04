# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-DanglingChildIssue {
    <#
    .SYNOPSIS
        Test-TaxonomyIntegrity's Check 6 (t/3879 decomposition -- extracted verbatim, no
        behavior change): a node's children[] must resolve to real POV nodes.
    .PARAMETER LoadedFiles
        Hashtable: povKey -> { Path; Data } (from the load phase).
    .PARAMETER PovNodeIds
        HashSet[string] of every non-situation POV node id.
    .OUTPUTS
        [PSCustomObject] { DanglingChildren (List, threaded back for -Repair); Passed (bool);
        Issue (PSCustomObject or $null) }.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$LoadedFiles,

        [Parameter(Mandatory)]
        [System.Collections.Generic.HashSet[string]]$PovNodeIds
    )

    Set-StrictMode -Version Latest

    $DanglingChildren = [System.Collections.Generic.List[PSCustomObject]]::new()
    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic')) {
        if (-not $LoadedFiles.ContainsKey($PovKey)) { continue }
        foreach ($Node in $LoadedFiles[$PovKey].Data.nodes) {
            if (-not $Node.PSObject.Properties['children'] -or $null -eq $Node.children) { continue }
            foreach ($ChildId in @($Node.children)) {
                if (-not $PovNodeIds.Contains($ChildId)) {
                    $DanglingChildren.Add([PSCustomObject]@{ NodeId = $Node.id; ChildId = $ChildId; POV = $PovKey })
                }
            }
        }
    }

    if ($DanglingChildren.Count -gt 0) {
        $Detail = ($DanglingChildren | ForEach-Object { "$($_.NodeId) -> $($_.ChildId)" }) -join '; '
        return [PSCustomObject]@{
            DanglingChildren = $DanglingChildren
            Passed           = $false
            Issue            = [PSCustomObject]@{ Check = 'DanglingChild'; Severity = 'Error'; Count = $DanglingChildren.Count; Detail = "children ref non-existent nodes: $Detail" }
        }
    }
    return [PSCustomObject]@{ DanglingChildren = $DanglingChildren; Passed = $true; Issue = $null }
}
