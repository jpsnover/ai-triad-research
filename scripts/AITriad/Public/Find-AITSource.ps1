# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Find-AITSource {
    <#
    .SYNOPSIS
        Finds source documents whose summaries reference given taxonomy node IDs.
    .DESCRIPTION
        Scans every summary JSON in summaries/ and returns the sources that
        contain at least one key_point whose taxonomy_node_id matches any of
        the supplied -Id patterns.

        Patterns support PowerShell wildcards (e.g. skp-intentions* matches
        skp-intentions-001, skp-intentions-005, etc.).

        Output includes the doc ID, title, matching POV, and the matched
        key_point details so you can see exactly which points map to the node.
    .PARAMETER Id
        One or more taxonomy node ID patterns (supports wildcards).
    .EXAMPLE
        Find-AITSource -Id 'skp-intentions-005'
        # Exact match — sources referencing that single node.
    .EXAMPLE
        Find-AITSource -Id 'skp-intentions*'
        # Wildcard — all skeptic methods nodes.
    .EXAMPLE
        Find-AITSource -Id 'acc-desires-001','saf-beliefs-002'
        # Multiple IDs — sources referencing either node.
    .EXAMPLE
        Find-AITSource -Id 'cc-*'
        # All cross-cutting references.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [string[]]$Id
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $SummariesDir = Get-SummariesDir
    $SourcesDir   = Get-SourcesDir

    if (-not (Test-Path $SummariesDir)) {
        Write-Warning "Summaries directory not found: $SummariesDir"
        return
    }

    $SummaryFiles = Get-ChildItem -Path $SummariesDir -Filter '*.json' -File
    if ($SummaryFiles.Count -eq 0) {
        Write-Warning "No summary files found in $SummariesDir"
        return
    }

    $MatchCount = 0

    foreach ($File in $SummaryFiles) {
        try {
            $Summary = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json -Depth 20
        }
        catch {
            Write-Warning "Failed to parse $($File.Name): $_"
            continue
        }

        $DocId = $Summary.doc_id

        # Load title from source metadata if available
        $Title = $null
        $MetaPath = Join-Path $SourcesDir $DocId 'metadata.json'
        if (Test-Path $MetaPath) {
            try {
                $Meta  = Get-Content -Raw -Path $MetaPath | ConvertFrom-Json -Depth 20
                $Title = $Meta.title
            }
            catch {
                Write-Verbose "Could not load title from $MetaPath — $($_.Exception.Message)"
            }
        }

        # Scan all POV summaries for matching taxonomy_node_id values
        $Hits = [System.Collections.Generic.List[PSObject]]::new()

        foreach ($PovName in @('accelerationist', 'safetyist', 'skeptic')) {
            $PovData = $Summary.pov_summaries.$PovName
            if (-not $PovData) { continue }

            foreach ($Point in $PovData.key_points) {
                $NodeId = $Point.taxonomy_node_id
                if (-not $NodeId) { continue }

                foreach ($Pattern in $Id) {
                    if ($NodeId -like $Pattern) {
                        $Hits.Add([PSCustomObject]@{
                            POV       = $PovName
                            NodeId    = $NodeId
                            Category  = $Point.category
                            Point     = $Point.point
                        })
                        break   # one pattern match is enough per key_point
                    }
                }
            }
        }

        if ($Hits.Count -eq 0) { continue }
        $MatchCount++

        [PSCustomObject]@{
            PSTypeName = 'AITriad.SourceMatch'
            DocId      = $DocId
            Title      = $Title
            HitCount   = $Hits.Count
            Hits       = $Hits.ToArray()
        }
    }

    if ($MatchCount -eq 0) {
        $Patterns = ($Id | Foreach { "'$_'" }) -join ', '
        Write-Warning "No sources found matching taxonomy node ID(s): $Patterns"
    }
}
