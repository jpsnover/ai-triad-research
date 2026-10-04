# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-EmbeddingCoverageIssue {
    <#
    .SYNOPSIS
        Test-TaxonomyIntegrity's Check 5 (t/3879 decomposition -- extracted verbatim, no
        behavior change): every node and policy must have an embedding.
    .PARAMETER EmbPath
        Path to embeddings.json.
    .PARAMETER AllNodeIds
        HashSet[string] of every node id (from the load phase).
    .PARAMETER Registry
        The policy registry object (or $null) from Check 1.
    .OUTPUTS
        [PSCustomObject] { Passed (bool); Issue (PSCustomObject or $null) }.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [string]$EmbPath,

        [Parameter(Mandatory)]
        [System.Collections.Generic.HashSet[string]]$AllNodeIds,

        [AllowNull()]
        $Registry
    )

    Set-StrictMode -Version Latest

    $MissingEmb = 0
    if (Test-Path $EmbPath) {
        $EmbData = Get-Content -Raw -Path $EmbPath | ConvertFrom-Json
        $EmbIds = [System.Collections.Generic.HashSet[string]]::new()
        foreach ($Prop in $EmbData.nodes.PSObject.Properties) { [void]$EmbIds.Add($Prop.Name) }

        foreach ($Nid in $AllNodeIds) {
            if (-not $EmbIds.Contains($Nid)) { $MissingEmb++ }
        }
        if ($Registry) {
            foreach ($Pol in $Registry.policies) {
                if (-not $EmbIds.Contains($Pol.id)) { $MissingEmb++ }
            }
        }
    }
    else {
        $MissingEmb = $AllNodeIds.Count
    }

    if ($MissingEmb -gt 0) {
        return [PSCustomObject]@{
            Passed = $false
            Issue  = [PSCustomObject]@{ Check = 'Embeddings'; Severity = 'Warning'; Count = $MissingEmb; Detail = "$MissingEmb nodes/policies missing embeddings" }
        }
    }
    return [PSCustomObject]@{ Passed = $true; Issue = $null }
}
