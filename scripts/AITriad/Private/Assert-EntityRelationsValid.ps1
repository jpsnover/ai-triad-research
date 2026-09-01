# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Write-side relation-DAG gate (t/3170): throws New-ActionableError if an entity's proposed
    relations[] would introduce a well-formedness/existence, cycle, or depth>3 violation.
    VALIDATE-ONLY (t/3170 Q1, TL-approved t/3170#2): this ASSERTS + REJECTS; it does NOT persist
    valid relations. Persistence of valid relations is the downstream ticket this blocks.
.DESCRIPTION
    Attributes violations to the CANDIDATE: it fails only on violations that appear with the
    candidate's edges added but not without them (a pre-existing store violation is Get-EntityReport's
    concern, not a reason to reject an unrelated import). Silent (no output) when clean.

    Term existence is injected via -KnownTermRef so the core stays pure/testable; the caller
    (Import-Entity) supplies the real dictionary refs.
.PARAMETER EntityId
    The candidate entity id (source of the proposed edges). A sentinel (e.g. 'ent-NEW') is fine for
    a not-yet-minted record — nothing can target an unminted id, so it cannot close a cycle.
.PARAMETER Relation
    The candidate's proposed relations[] (each { type, target }). Empty → no-op.
.PARAMETER ExistingEntity
    The current entity store records (each may carry persisted relations[]).
.PARAMETER KnownTermRef
    term:* refs that exist (dictionary), for target existence.
.PARAMETER MaxDepth
    Max path length in edges. Default 3 (R4.3).
#>
function Assert-EntityRelationsValid {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$EntityId,

        [Parameter()]
        [AllowEmptyCollection()]
        [object[]]$Relation = @(),

        [Parameter()]
        [AllowEmptyCollection()]
        [object[]]$ExistingEntity = @(),

        [Parameter()]
        [string[]]$KnownTermRef = @(),

        [Parameter()]
        [int]$MaxDepth = 3
    )

    Set-StrictMode -Version Latest

    $rels = @($Relation)
    if ($rels.Count -eq 0) { return }

    $prop = {
        param($o, $n)
        if ($null -eq $o) { return $null }
        if ($o -is [hashtable]) { if ($o.ContainsKey($n)) { return $o[$n] } else { return $null } }
        if ($o.PSObject.Properties[$n]) { return $o.$n } else { return $null }
    }

    # Existing edges from persisted relations + the known-id universe.
    $existingEdges = [System.Collections.Generic.List[object]]::new()
    $knownIds = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($e in @($ExistingEntity)) {
        $eid = [string](& $prop $e 'id')
        if ($eid) { [void]$knownIds.Add($eid) }
        $er = & $prop $e 'relations'
        if ($er) {
            foreach ($r in @($er)) {
                $existingEdges.Add(@{ Source = $eid; Type = [string](& $prop $r 'type'); Target = [string](& $prop $r 'target') })
            }
        }
    }
    if ($EntityId) { [void]$knownIds.Add($EntityId) }

    # Candidate edges.
    $candEdges = [System.Collections.Generic.List[object]]::new()
    foreach ($r in $rels) {
        $candEdges.Add(@{ Source = $EntityId; Type = [string](& $prop $r 'type'); Target = [string](& $prop $r 'target') })
    }

    $idArr = @($knownIds)
    $with    = Test-EntityRelationGraph -Edge (@($existingEdges) + @($candEdges)) -KnownEntityId $idArr -KnownTermRef $KnownTermRef -MaxDepth $MaxDepth
    $without = Test-EntityRelationGraph -Edge @($existingEdges) -KnownEntityId $idArr -KnownTermRef $KnownTermRef -MaxDepth $MaxDepth

    # Attribute to the candidate: keep violations present WITH but not WITHOUT its edges.
    $vkey = {
        param($v)
        switch ($v.Kind) {
            'malformed-target' { "malformed|$($v.Source)|$($v.Target)" }
            'missing-target'   { "missing|$($v.Source)|$($v.Target)" }
            'cycle'            { "cycle|$($v.Node)" }
            'over-depth'       { "overdepth|$($v.Node)" }
            default            { "$($v.Kind)|$($v | Out-String)" }
        }
    }
    $baseKeys = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($v in @($without)) { [void]$baseKeys.Add([string](& $vkey $v)) }
    $new = @(@($with) | Where-Object { -not $baseKeys.Contains([string](& $vkey $_)) })

    if ($new.Count -gt 0) {
        $detail = ($new | ForEach-Object {
                # Capture the item: inside a `switch` case block $_ is REBOUND to the switch input
                # (the Kind string), so $_.Target here would read a property off a string (StrictMode).
                $vi = $_
                switch ($vi.Kind) {
                    'malformed-target' { "malformed target '$($vi.Target)' ($($vi.Type) from $($vi.Source))" }
                    'missing-target'   { "target '$($vi.Target)' does not exist ($($vi.Type) from $($vi.Source))" }
                    'cycle'            { "relation cycle through '$($vi.Node)'" }
                    'over-depth'       { "relation path through '$($vi.Node)' exceeds depth $MaxDepth ($($vi.Depth) edges)" }
                    default            { [string]$vi.Kind }
                }
            }) -join '; '
        throw (New-ActionableError -PassThru `
                -Goal 'Import an entity with relation edges' `
                -Problem "Entity '$EntityId' relations violate the DOLCE relation-DAG invariants (t/3170): $detail" `
                -Location 'Assert-EntityRelationsValid' `
                -NextSteps @(
                    'Each relation target must be an existing ent-* or term:<slug>.',
                    'instance_of/subclass_of/part_of edges must form no cycle and no path deeper than 3 edges.',
                    'Relations are validated but NOT persisted (validate-only, t/3170 Q1) — persistence is the downstream ticket this gate blocks.'
                ))
    }
}
