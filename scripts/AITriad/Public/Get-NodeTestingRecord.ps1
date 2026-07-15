# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-NodeTestingRecord {
    <#
    .SYNOPSIS
        Read-only projection of the debate-tested record on POV nodes
        (Phase 2 of t/1523; ticket t/1579).
    .DESCRIPTION
        Reads `graph_attributes.debate_tested` off every loaded POV node and
        emits pipeline-composable [NodeTestingRecord] objects. Never
        recomputes tier or sort_key locally — the TypeScript writer at
        lib/debate/debateTested.ts is the single source of truth. Use
        Update-NodeTestingRecord -RecomputeOnly to refresh those two fields
        when constants change.

        Nodes with no `debate_tested` field emit as tier='untested',
        SortKey=0, Engagements=0, Stale=$false so users can spot the
        never-tested bucket in a single sort.

        Staleness (t/1579 AC #2): a node is Stale when the current
        SHA-256 of its description differs from the recorded
        `description_hash`. The design also specifies an
        embedding-cosine cosmetic-edit exemption
        (COSMETIC_EDIT_SIMILARITY_THRESHOLD, 0.98) — v1 implements the
        hash check only and treats the embedding fallback as a
        follow-up (documented deviation: false-positive stale flags for
        cosmetic edits are surfaced, not silenced; safer than
        silently hiding an actual drift).

        Deficit sort (t/1579 AC #3):
            testing_priority = importance * deficit
            importance = 0.35*degree_centrality + 0.25*policy_linkage +
                         0.20*doctrinal_anchor + 0.20*usage_frequency
            deficit = untested 1.0 / cited 0.7 / stale 0.6 /
                      contested 0.4 / well_tested 0.1
        Each importance summand is read from graph_attributes.<name> when
        present; falls back to 0. If no node in the run has any
        importance signal a single warning is emitted at the end (not
        per-node) so a zero-priority ranking is visibly not the
        real answer.
    .PARAMETER Pov
        Filter to a single camp (acc / saf / skp). Default: all camps.
    .PARAMETER Category
        Filter by BDI category (belief / desire / intention). Default: all.
    .PARAMETER Tier
        Filter by tier (untested / cited / contested / well_tested).
        Default: all.
    .PARAMETER SortBy
        Debate-Tested (default): descending by SortKey (well_tested and
        strongly evidenced first). Deficit: descending by testing_priority
        (the work queue for future debates).
    .PARAMETER Top
        Return only the top N after sort. Default: emit all.
    .PARAMETER Stale
        Return only nodes whose current description hash differs from the
        recorded hash.
    .OUTPUTS
        [NodeTestingRecord]
    .EXAMPLE
        Get-NodeTestingRecord -Pov saf -Tier well_tested
    .EXAMPLE
        Get-NodeTestingRecord -SortBy Deficit -Top 20
    .EXAMPLE
        Get-NodeTestingRecord -Stale
    .LINK
        Update-NodeTestingRecord
    .LINK
        Get-Tax
    .LINK
        Get-TaxonomyHealth
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [ValidateSet('acc', 'saf', 'skp')]
        [string]$Pov,

        [Parameter()]
        [ValidateSet('belief', 'desire', 'intention')]
        [string]$Category,

        [Parameter()]
        [ValidateSet('untested', 'cited', 'contested', 'well_tested')]
        [string]$Tier,

        [Parameter()]
        [ValidateSet('Debate-Tested', 'Deficit')]
        [string]$SortBy = 'Debate-Tested',

        [Parameter()]
        [ValidateRange(1, [int]::MaxValue)]
        [int]$Top,

        [Parameter()]
        [switch]$Stale
    )

    Set-StrictMode -Version Latest

    $povFullByShort = @{ acc = 'accelerationist'; saf = 'safetyist'; skp = 'skeptic' }
    $categoryTitle = @{ belief = 'Beliefs'; desire = 'Desires'; intention = 'Intentions' }

    $taxArgs = @{}
    if ($Pov) { $taxArgs['POV'] = $povFullByShort[$Pov] }
    $nodes = @(Get-Tax @taxArgs)

    if ($Category) {
        $wantedCategory = $categoryTitle[$Category]
        $nodes = @($nodes | Where-Object { $_.Category -eq $wantedCategory })
    }

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $results = [System.Collections.Generic.List[NodeTestingRecord]]::new()
        $hasAnyImportanceSignal = $false

        foreach ($n in $nodes) {
            $ntr = [NodeTestingRecord]::new()
            $ntr.NodeId          = [string]$n.Id
            $ntr.Pov             = [string]$n.POV
            $ntr.Category        = [string]$n.Category
            $ntr.Label           = [string]$n.Label
            $ntr.Tier            = 'untested'
            $ntr.SortKey         = 0.0
            $ntr.Engagements     = 0
            $ntr.Challenges      = 0
            $ntr.Held            = 0
            $ntr.Weakened        = 0
            $ntr.LastTested      = ''
            $ntr.Refined         = $false
            $ntr.Stale           = $false
            $ntr.ChallengerCamps = @()

            $ga = $n.GraphAttributes
            $hasDT = $null -ne $ga -and
                     $ga.PSObject.Properties['debate_tested'] -and
                     $null -ne $ga.debate_tested
            if ($hasDT) {
                $dt = $ga.debate_tested
                if ($dt.PSObject.Properties['tier'])         { $ntr.Tier        = [string]$dt.tier }
                if ($dt.PSObject.Properties['sort_key'])     { $ntr.SortKey     = [double]$dt.sort_key }
                if ($dt.PSObject.Properties['engagements']) { $ntr.Engagements = [int]$dt.engagements }
                if ($dt.PSObject.Properties['challenges'])   { $ntr.Challenges  = [int]$dt.challenges }
                if ($dt.PSObject.Properties['held'])         { $ntr.Held        = [int]$dt.held }
                if ($dt.PSObject.Properties['weakened'])     { $ntr.Weakened    = [int]$dt.weakened }
                if ($dt.PSObject.Properties['last_tested'])  { $ntr.LastTested  = [string]$dt.last_tested }

                if ($dt.PSObject.Properties['revisions']) {
                    foreach ($r in @($dt.revisions)) {
                        if ($r.PSObject.Properties['held_since'] -and $null -ne $r.held_since) {
                            $ntr.Refined = $true; break
                        }
                    }
                }

                if ($dt.PSObject.Properties['record']) {
                    $camps = [System.Collections.Generic.List[string]]::new()
                    foreach ($e in @($dt.record)) {
                        if ($e.PSObject.Properties['strongest_attack_encountered'] -and
                            $null -ne $e.strongest_attack_encountered -and
                            $e.strongest_attack_encountered.PSObject.Properties['challenger_camp']) {
                            $c = [string]$e.strongest_attack_encountered.challenger_camp
                            if ($c -and -not $camps.Contains($c)) { $camps.Add($c) }
                        }
                    }
                    $ntr.ChallengerCamps = $camps.ToArray()
                }

                # Stale: hash mismatch. Cosmetic-edit embedding exemption
                # deferred to a follow-up; false-positive stale on cosmetic
                # edits is documented, safer than silent negatives.
                if ($dt.PSObject.Properties['description_hash']) {
                    $recorded = [string]$dt.description_hash
                    if ($recorded -and $n.Description) {
                        $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$n.Description)
                        $hashBytes = $sha256.ComputeHash($bytes)
                        $current = 'sha256:' + (-join ($hashBytes | ForEach-Object { $_.ToString('x2') }))
                        if ($current -ne $recorded) { $ntr.Stale = $true }
                    }
                }
            }

            # Deficit-sort inputs (populated only when requested)
            if ($SortBy -eq 'Deficit') {
                $imp = 0.0
                foreach ($pair in @(
                    @{ n='degree_centrality'; w=0.35 }
                    @{ n='policy_linkage';    w=0.25 }
                    @{ n='doctrinal_anchor';  w=0.20 }
                    @{ n='usage_frequency';   w=0.20 }
                )) {
                    if ($ga -and $ga.PSObject.Properties[$pair.n] -and $null -ne $ga.($pair.n)) {
                        $v = [double]$ga.($pair.n)
                        if ($v -lt 0) { $v = 0 } elseif ($v -gt 1) { $v = 1 }
                        $imp += $v * [double]$pair.w
                        $hasAnyImportanceSignal = $true
                    }
                }
                $effectiveTier = if ($ntr.Stale) { 'stale' } else { $ntr.Tier }
                $def = switch ($effectiveTier) {
                    'untested'    { 1.0 }
                    'cited'       { 0.7 }
                    'stale'       { 0.6 }
                    'contested'   { 0.4 }
                    'well_tested' { 0.1 }
                    default       { 0.0 }
                }
                $ntr.Importance      = $imp
                $ntr.Deficit         = $def
                $ntr.TestingPriority = $imp * $def
            }

            $results.Add($ntr)
        }

        # Filters (post-projection so tier/stale bits are populated)
        $filtered = $results
        if ($Tier) {
            $filtered = [System.Collections.Generic.List[NodeTestingRecord]]::new()
            foreach ($x in $results) { if ($x.Tier -eq $Tier) { $filtered.Add($x) } }
        }
        if ($Stale) {
            $staleOnly = [System.Collections.Generic.List[NodeTestingRecord]]::new()
            foreach ($x in $filtered) { if ($x.Stale) { $staleOnly.Add($x) } }
            $filtered = $staleOnly
        }

        # Sort
        $sorted = if ($SortBy -eq 'Deficit') {
            @($filtered | Sort-Object -Property TestingPriority -Descending)
        } else {
            @($filtered | Sort-Object -Property SortKey -Descending)
        }

        if ($SortBy -eq 'Deficit' -and -not $hasAnyImportanceSignal) {
            Write-Warning "Get-NodeTestingRecord -SortBy Deficit: no node in the result set carries any of the four importance signals (degree_centrality, policy_linkage, doctrinal_anchor, usage_frequency). TestingPriority = 0 for every node — this ordering reflects only deficit, not importance."
        }

        if ($Top) {
            $sorted = @($sorted | Select-Object -First $Top)
        }

        $sorted
    } finally {
        $sha256.Dispose()
    }
}
