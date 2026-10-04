# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-DanglingParentIssue {
    <#
    .SYNOPSIS
        Test-TaxonomyIntegrity's Check 7 (t/3879 decomposition -- extracted verbatim, no
        behavior change): a node's parent_id must resolve to a real POV node, if set.
    .PARAMETER LoadedFiles
        Hashtable: povKey -> { Path; Data } (from the load phase).
    .PARAMETER PovNodeIds
        HashSet[string] of every non-situation POV node id.
    .OUTPUTS
        [PSCustomObject] { DanglingParents (List, threaded back for -Repair); Passed (bool);
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

    $DanglingParents = [System.Collections.Generic.List[PSCustomObject]]::new()
    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic')) {
        if (-not $LoadedFiles.ContainsKey($PovKey)) { continue }
        foreach ($Node in $LoadedFiles[$PovKey].Data.nodes) {
            $ParentId = if ($Node.PSObject.Properties['parent_id']) { $Node.parent_id } else { $null }
            if ($ParentId -and -not $PovNodeIds.Contains($ParentId)) {
                $DanglingParents.Add([PSCustomObject]@{ NodeId = $Node.id; ParentId = $ParentId; POV = $PovKey })
            }
        }
    }

    if ($DanglingParents.Count -gt 0) {
        $Detail = ($DanglingParents | ForEach-Object { "$($_.NodeId) -> $($_.ParentId)" }) -join '; '
        return [PSCustomObject]@{
            DanglingParents = $DanglingParents
            Passed          = $false
            Issue           = [PSCustomObject]@{ Check = 'DanglingParent'; Severity = 'Error'; Count = $DanglingParents.Count; Detail = "parent_id refs non-existent nodes: $Detail" }
        }
    }
    return [PSCustomObject]@{ DanglingParents = $DanglingParents; Passed = $true; Issue = $null }
}
