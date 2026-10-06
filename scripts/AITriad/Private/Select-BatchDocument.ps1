# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Select-BatchDocument {
    <#
    .SYNOPSIS
        Invoke-BatchSummary STEP 3 triage (t/3910): split the usable docs into those to
        reprocess and those to mark current.
    .DESCRIPTION
        A doc is reprocessed under -ForceAll, under a -DocId filter, or when any of its
        pov_tags is an affected camp; every other usable doc is marked current.
        Returns @{ Process = List[hashtable]; Skip = List[hashtable] } of New-BatchDocEntry items.
        Throws when a -DocId filter is active and matched nothing to reprocess.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)][System.IO.FileInfo[]]$MetaFile,
        [string[]]$DocIdFilter = @(),
        [string[]]$AffectedCamp = @(),
        [switch]$ForceAll
    )

    $DocsToProcess = [System.Collections.Generic.List[hashtable]]::new()
    $DocsToSkip    = [System.Collections.Generic.List[hashtable]]::new()
    $HasDocFilter  = $DocIdFilter.Count -gt 0

    foreach ($File in $MetaFile) {
        $Entry = New-BatchDocEntry -MetaFile $File -DocIdFilter $DocIdFilter
        if ($null -eq $Entry) { continue }

        $Intersects = $ForceAll -or
                      $HasDocFilter -or
                      @($Entry.PovTags | Where-Object { $_ -in $AffectedCamp }).Count -gt 0

        if ($Intersects) { $DocsToProcess.Add($Entry) } else { $DocsToSkip.Add($Entry) }
    }

    if ($HasDocFilter -and $DocsToProcess.Count -eq 0) {
        $Missing = $DocIdFilter -join ', '
        Write-Fail "No matching documents found: $Missing"
        Write-Info "Check that sources/<doc-id>/ exists and has a metadata.json"
        throw "No matching documents found: $Missing"
    }

    return @{ Process = $DocsToProcess; Skip = $DocsToSkip }
}
