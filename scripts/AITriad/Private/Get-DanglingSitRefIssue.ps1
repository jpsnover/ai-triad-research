# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-DanglingSitRefIssue {
    <#
    .SYNOPSIS
        Test-TaxonomyIntegrity's Check 8 (t/3879 decomposition -- extracted verbatim, no
        behavior change): a POV node's situation_refs[] must resolve to real situations.
    .PARAMETER LoadedFiles
        Hashtable: povKey -> { Path; Data } (from the load phase).
    .OUTPUTS
        [PSCustomObject] { SitIds (HashSet, threaded back -- Check 10 reuses it to tell a
        dangling situation_ref apart from a reciprocity asymmetry); DanglingSitRefs (List,
        threaded back for -Repair); Passed (bool); Issue (PSCustomObject or $null) }.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$LoadedFiles
    )

    Set-StrictMode -Version Latest

    $SitIds = [System.Collections.Generic.HashSet[string]]::new()
    if ($LoadedFiles.ContainsKey('situations')) {
        foreach ($N in $LoadedFiles['situations'].Data.nodes) { [void]$SitIds.Add($N.id) }
    }

    $DanglingSitRefs = [System.Collections.Generic.List[PSCustomObject]]::new()
    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic')) {
        if (-not $LoadedFiles.ContainsKey($PovKey)) { continue }
        foreach ($Node in $LoadedFiles[$PovKey].Data.nodes) {
            if (-not $Node.PSObject.Properties['situation_refs'] -or $null -eq $Node.situation_refs) { continue }
            foreach ($Ref in @($Node.situation_refs)) {
                if (-not $SitIds.Contains($Ref)) {
                    $DanglingSitRefs.Add([PSCustomObject]@{ NodeId = $Node.id; SitRef = $Ref; POV = $PovKey })
                }
            }
        }
    }

    if ($DanglingSitRefs.Count -gt 0) {
        $Detail = ($DanglingSitRefs | ForEach-Object { "$($_.NodeId) -> $($_.SitRef)" }) -join '; '
        return [PSCustomObject]@{
            SitIds           = $SitIds
            DanglingSitRefs  = $DanglingSitRefs
            Passed           = $false
            Issue            = [PSCustomObject]@{ Check = 'DanglingSitRef'; Severity = 'Error'; Count = $DanglingSitRefs.Count; Detail = "situation_refs non-existent nodes: $Detail" }
        }
    }
    return [PSCustomObject]@{ SitIds = $SitIds; DanglingSitRefs = $DanglingSitRefs; Passed = $true; Issue = $null }
}
