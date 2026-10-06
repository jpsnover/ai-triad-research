# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function New-TaxonomyNodeIndex {
    <#
    .SYNOPSIS
        Builds the citation-tracking node index from $script:TaxonomyData (t/3910 extraction
        from Get-TaxonomyHealthData).
    .DESCRIPTION
        One entry per node, keyed by id: POV, Category (defaults to 'Situations' for the
        situations POV, else the node's own category or '' if absent), Label, Description
        (defaults to ''), and empty Citations/DocIds/Stances accumulators the caller mutates
        while scanning summaries.
    .OUTPUTS
        [hashtable] keyed by node id.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param()

    Set-StrictMode -Version Latest

    $NodeIndex = @{}
    $PovNames  = @('accelerationist', 'safetyist', 'skeptic', 'situations')

    foreach ($PovKey in $PovNames) {
        $Entry = $script:TaxonomyData[$PovKey]
        if (-not $Entry) { continue }
        foreach ($Node in $Entry.nodes) {
            if ($PovKey -eq 'situations') { $NodeCategory = 'Situations' }
            elseif ($Node.PSObject.Properties['category']) { $NodeCategory = $Node.category }
            else { $NodeCategory = '' }
            if ($Node.PSObject.Properties['description']) { $NodeDescription = $Node.description } else { $NodeDescription = '' }
            $NodeIndex[$Node.id] = @{
                POV         = $PovKey
                Category    = $NodeCategory
                Label       = $Node.label
                Description = $NodeDescription
                Citations   = 0
                DocIds      = [System.Collections.Generic.List[string]]::new()
                Stances     = [System.Collections.Generic.List[string]]::new()
            }
        }
    }

    return $NodeIndex
}
