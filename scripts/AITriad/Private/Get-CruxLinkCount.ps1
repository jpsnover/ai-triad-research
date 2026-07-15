# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-CruxLinkCount {
    <#
    .SYNOPSIS
        Loads aggregated-cruxes.json and returns a per-nodeId reference count.
        PS mirror of loadCruxLinksFromAggregated() in lib/debate/cruxLinkage.ts
        (t/1588 — same source, single-writer discipline).
    .DESCRIPTION
        Returns a hashtable keyed by node id → integer reference count. Called
        by Get-NodeTestingRecord's Deficit-sort branch to populate the
        crux_density signal, which the TS severeTestScheduler already reads
        from this file.

        Empty/missing/malformed file → empty hashtable (no throw).
    .PARAMETER Path
        Optional explicit path to aggregated-cruxes.json. Default: <data-root>/
        taxonomy/Origin/aggregated-cruxes.json.
    .OUTPUTS
        [hashtable] — { nodeId → int count }.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter()]
        [string]$Path
    )
    Set-StrictMode -Version Latest

    if (-not $Path) {
        $Path = Join-Path (Get-TaxonomyDir) 'aggregated-cruxes.json'
    }
    $counts = @{}
    if (-not (Test-Path $Path)) { return $counts }

    try {
        $store = Get-Content $Path -Raw -ErrorAction Stop | ConvertFrom-Json
    } catch {
        Write-Verbose "Get-CruxLinkCount: failed to parse $Path — returning empty. $($_.Exception.Message)"
        return $counts
    }

    if (-not $store.PSObject.Properties['cruxes']) { return $counts }
    foreach ($entry in @($store.cruxes)) {
        if (-not $entry.PSObject.Properties['linked_node_ids']) { continue }
        foreach ($nodeId in @($entry.linked_node_ids)) {
            $key = [string]$nodeId
            if ($counts.ContainsKey($key)) {
                $counts[$key] = [int]$counts[$key] + 1
            } else {
                $counts[$key] = 1
            }
        }
    }
    $counts
}
