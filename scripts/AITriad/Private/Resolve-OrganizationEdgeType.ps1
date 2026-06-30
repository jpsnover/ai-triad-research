# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Organization actor-edge registry (t/1224).
# Parallel to the argumentation edge vocabulary in Resolve-EdgeType.ps1.
# Dot-sourced by AITriad.psm1 — do NOT export.
#
# Why a separate registry?
#   Resolve-EdgeType holds the canonical 8 ARGUMENTATION edges
#   (SUPPORTS, CONTRADICTS, WEAKENS, ...) — claim ↔ claim relationships
#   exercised by debate and conflict analysis. Organization edges
#   represent ACTOR relationships (org → entity) and have different
#   semantics, different consumers, and different LLM-hallucination
#   risk profiles. Mixing them would weaken Resolve-EdgeType as a
#   guardrail against synonym drift. See t/1224#1 for the full rationale.

# Authoritative 9-type vocabulary for organization actor edges.
$script:OrganizationEdgeTypes = @(
    'ADVOCATES_FOR',     # org → node    (actively champions this position)
    'OPPOSES',           # org → node    (actively works against this position)
    'SUPPORTS_POLICY',   # org → pol-*
    'OPPOSES_POLICY',    # org → pol-*
    'ENGAGED_WITH',      # org → sit-*   (active on this cross-cutting topic)
    'PUBLISHED',         # org → source  (published/funded this source document)
    'ALLIED_WITH',       # org → org     (frequent co-signers/co-advocates)
    'COMPETES_WITH',     # org → org     (opposing missions/positions)
    'FUNDS'              # org → org     (funding/grant relationship)
)

function Resolve-OrganizationEdgeType {
    <#
    .SYNOPSIS
        Validates an organization actor edge type against the 9-type registry.
    .DESCRIPTION
        Pure stateless function. Returns an EdgeTypeResolution object with
        Action = 'accept' (canonical, normalized to upper-case) or 'drop'
        (unknown — caller logs and discards). No reclassify table; the
        organization vocabulary is intentionally tight to avoid LLM synonym
        drift contaminating the registry.

        Distinct from Resolve-EdgeType (argumentation vocabulary). Both
        validators may be needed for graph queries that union actor and
        argumentation edges — see Get-AllEdgeTypes.
    .PARAMETER Type
        The proposed edge type (any case, any string).
    .EXAMPLE
        $r = Resolve-OrganizationEdgeType -Type 'advocates_for'
        # $r.Action = 'accept', $r.Type = 'ADVOCATES_FOR'
    .EXAMPLE
        $r = Resolve-OrganizationEdgeType -Type 'COLLABORATES_WITH'
        # $r.Action = 'drop', $r.Reason = 'COLLABORATES_WITH is not in organization edge registry'
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
        $Result.Reason = 'organization edge type is null or empty'
        return $Result
    }

    $Upper = $Type.ToUpperInvariant()

    if ($script:OrganizationEdgeTypes -contains $Upper) {
        $Result.Action = 'accept'
        $Result.Type   = $Upper
        return $Result
    }

    $Result.Action = 'drop'
    $Result.Reason = "$Upper is not in organization edge registry"
    return $Result
}

function Get-OrganizationEdgeType {
    <#
    .SYNOPSIS
        Returns the 9 canonical organization actor edge types.
    .DESCRIPTION
        Helper for tests and consumers. Returns a fresh array each call so
        callers cannot mutate the registry.
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param()
    return @($script:OrganizationEdgeTypes)
}

function Get-AllEdgeType {
    <#
    .SYNOPSIS
        Returns the union of argumentation and organization edge types.
    .DESCRIPTION
        For graph consumers that need a "type is valid SOMEWHERE in the system"
        check. Returns the 8 argumentation edges from Resolve-EdgeType plus the
        9 organization actor edges from this file (17 total).

        Argumentation and organization vocabularies are otherwise disjoint —
        no edge type appears in both registries.
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param()
    Set-StrictMode -Version Latest
    return @(@($script:CanonicalEdgeTypes) + @($script:OrganizationEdgeTypes))
}
