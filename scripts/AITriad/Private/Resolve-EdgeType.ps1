# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Edge-type validation + mapping post-processing (t/1093).
# Dot-sourced by AITriad.psm1 — do NOT export.

# Authoritative 8-type canonical vocabulary. Update here if the vocabulary
# changes; the consumers (Invoke-EdgeDiscovery, Set-Edge, prompts) read from
# this single source of truth.
$script:CanonicalEdgeTypes = @(
    'SUPPORTS',
    'CONTRADICTS',
    'WEAKENS',
    'TENSION_WITH',
    'RESPONDS_TO',
    'ASSUMES',
    'INTERPRETS',
    'CONVERGES_WITH'
)

# Reclassify table — LLM-hallucinated synonyms that genuinely map to SUPPORTS.
# Other unknown types are dropped (logged + discarded), not silently mapped.
$script:EdgeTypeReclassify = @{
    MOTIVATES   = 'SUPPORTS'
    COMPLEMENTS = 'SUPPORTS'
    ENABLES     = 'SUPPORTS'
}

function Resolve-EdgeType {
    <#
    .SYNOPSIS
        Validates and maps an edge type to the canonical 8-type vocabulary.
    .DESCRIPTION
        Pure stateless function. Returns an EdgeTypeResolution object with one
        of three Action values:
          - 'accept'     — type is canonical; .Type is the normalized (upper) form
          - 'reclassify' — type is a known synonym; .Type is the canonical mapping
          - 'drop'       — type is deprecated or unrecognized; caller discards
                           and logs .Reason

        Dedup (skip a reclassified edge that duplicates an existing one) is
        the caller's responsibility, not this function's — the helper stays
        stateless so it composes cleanly with batch + manual write paths.
    .PARAMETER Type
        The proposed edge type (any case, any string).
    .EXAMPLE
        $r = Resolve-EdgeType -Type 'supports'
        # $r.Action = 'accept', $r.Type = 'SUPPORTS'
    .EXAMPLE
        $r = Resolve-EdgeType -Type 'MOTIVATES'
        # $r.Action = 'reclassify', $r.Type = 'SUPPORTS', $r.Reason = 'MOTIVATES → SUPPORTS'
    .EXAMPLE
        $r = Resolve-EdgeType -Type 'CITES'
        # $r.Action = 'drop', $r.Reason = 'CITES is deprecated; no canonical mapping'
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [AllowNull()]
        [string]$Type
    )

    Set-StrictMode -Version Latest

    $Result = [EdgeTypeResolution]::new()

    if ([string]::IsNullOrWhiteSpace($Type)) {
        $Result.Action = 'drop'
        $Result.Reason = 'edge type is null or empty'
        return $Result
    }

    $Upper = $Type.ToUpperInvariant()

    if ($script:CanonicalEdgeTypes -contains $Upper) {
        $Result.Action = 'accept'
        $Result.Type   = $Upper
        return $Result
    }

    if ($script:EdgeTypeReclassify.ContainsKey($Upper)) {
        $Mapped = $script:EdgeTypeReclassify[$Upper]
        $Result.Action = 'reclassify'
        $Result.Type   = $Mapped
        $Result.Reason = "$Upper → $Mapped"
        return $Result
    }

    $Result.Action = 'drop'
    $Result.Reason = "$Upper is not in canonical vocabulary and has no reclassify mapping"
    return $Result
}

function Get-CanonicalEdgeType {
    # Helper for tests + consumers to read the canonical list. Returns a fresh array.
    [CmdletBinding()]
    param()
    return @($script:CanonicalEdgeTypes)
}
