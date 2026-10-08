# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-EdgeBalanceCounts {
    <#
    .SYNOPSIS
        Load edges.json and count SUPPORTS and attacks (CONTRADICTS/WEAKENS) received per node.
        Extracted from Invoke-BDIWeightAssignment (t/3910).
    .DESCRIPTION
        CONTRACT: the counts cover NON-REJECTED edges only. An edge with status 'rejected' contributes 0
        even though it is present in edges.json, so callers must not re-filter (t/3910#42). Untyped and
        target-less edges are skipped too. A bidirectional edge also counts for its source.

        A MISSING file is a fallback: it WARNs (naming the path and the condition) and returns empty
        maps, so every edge boost is 0 (Fallback-Path Logging). An UNREADABLE file (present but not
        valid JSON) is not a fallback: it throws, because silently zeroing every boost on a corrupt
        file would rewrite every weight wrongly.
    .OUTPUTS
        [hashtable] @{ Supports = @{ nodeId = count }; Attacks = @{ nodeId = count } }
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param([Parameter(Mandatory)][string]$Path)

    $Result = @{ Supports = @{}; Attacks = @{} }
    if (-not (Test-Path $Path)) {
        Write-Warning "edges.json not found at $Path (missing: the file does not exist) — edge boost will be 0"
        return $Result
    }
    $EdgesRaw = Get-Content $Path -Raw | ConvertFrom-Json
    $Edges = if ($EdgesRaw.PSObject.Properties['edges']) { @($EdgesRaw.edges) } else { @($EdgesRaw) }
    foreach ($Edge in @($Edges)) {
        $Bucket = Get-EdgeBalanceBucket -Edge $Edge
        if (-not $Bucket) { continue }
        $Map = $Result[$Bucket]
        $Map[$Edge.target] = ($Map[$Edge.target] ?? 0) + 1
        $Source = if ($Edge.PSObject.Properties['source']) { $Edge.source } else { $null }
        if ($Edge.PSObject.Properties['bidirectional'] -and $Edge.bidirectional -and $Source) {
            $Map[$Source] = ($Map[$Source] ?? 0) + 1
        }
    }
    Write-Host "  Edges: $(@($Edges).Count) loaded" -ForegroundColor Gray
    return $Result
}

function Get-EdgeBalanceBucket {
    <#
    .SYNOPSIS
        'Supports', 'Attacks', or $null (the edge doesn't count) for one edge. Extracted from
        Invoke-BDIWeightAssignment (t/3910).
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)]$Edge)

    if ($Edge.PSObject.Properties['status'] -and $Edge.status -eq 'rejected') { return $null }
    $Type = if ($Edge.PSObject.Properties['type']) { $Edge.type } else { $null }
    if (-not $Type) { return $null }
    $Target = if ($Edge.PSObject.Properties['target']) { $Edge.target } else { $null }
    if (-not $Target) { return $null }
    if ($Type -eq 'SUPPORTS') { return 'Supports' }
    if ($Type -in 'CONTRADICTS', 'WEAKENS') { return 'Attacks' }
    return $null
}
