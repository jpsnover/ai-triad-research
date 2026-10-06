# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-BatchChangedTaxonomyFile {
    <#
    .SYNOPSIS
        Invoke-BatchSummary STEP 2 (t/3910): which POV taxonomy files count as changed.
    .DESCRIPTION
        -ForceAll or a -DocId filter treats every file as changed; otherwise the git
        diff between the last two TAXONOMY_VERSION commits decides
        (Get-BatchGitChangedTaxonomyFile). Returns the unique file names; callers wrap
        the call in @() since 0 or 1 names come back as $null or a scalar.
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)][System.Collections.IDictionary]$PovFileMap,
        [Parameter(Mandatory)][string]$RepoRoot,
        [switch]$ForceAll,
        [bool]$HasDocFilter
    )

    if ($ForceAll -or $HasDocFilter) {
        if ($ForceAll)      { Write-Info "Force mode — treating all taxonomy files as changed" }
        if ($HasDocFilter)  { Write-Info "Doc filter mode — treating all taxonomy files as changed" }
        $Changed = @($PovFileMap.Keys)
    } else {
        $Changed = @(Get-BatchGitChangedTaxonomyFile -PovFileMap $PovFileMap -RepoRoot $RepoRoot)
    }
    return @($Changed | Select-Object -Unique)
}
