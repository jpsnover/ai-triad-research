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

        Deficit sort (t/1588 alignment with severeTestScheduler.ts):
            testing_priority = importance * deficit
            importance = 0.25*degree + 0.15*crux_density +
                         0.25*policy_linkage + 0.20*doctrinal_anchor +
                         0.15*usage
            deficit = untested 1.0 / cited 0.7 / stale 0.6 /
                      contested 0.4 / well_tested 0.1

        Signal sources (post-t/1588, mirroring severeTestScheduler.ts
        computeNodeImportance so PS + TS are one formula, one signal set):
          degree           = children.length + situation_refs.length +
                             conflict_ids.length (structural)
          crux_density     = per-node reference count from
                             aggregated-cruxes.json (via Get-CruxLinkCount)
          policy_linkage   = graph_attributes.policy_actions.length
          doctrinal_anchor = node.doctrinally_anchored ? 1.0 : 0
          usage            = debate_refs.length
        Each signal is normalized across the batch via divide-by-max
        → [0,1]. If every node in the run reads zero on every signal,
        a single at-end warning surfaces so a zero-priority ranking
        is visibly not the real answer.
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
    .PARAMETER OutputPath
        Optional path to write the emitted records as a JSON array with
        camelCase field names matching the TS NodeTestingRecord interface
        in lib/debate/debateTested.ts (t/1588 Phase A). When set, the
        cmdlet writes the sorted/filtered result to disk AND returns the
        same records to the pipeline. Field names in the JSON:
        nodeId, pov, category, label, tier, sortKey, engagements,
        challenges, held, weakened, lastTested, refined, stale,
        challengerCamps, importance, deficit, testingPriority.
    .OUTPUTS
        [NodeTestingRecord]
    .EXAMPLE
        Get-NodeTestingRecord -Pov saf -Tier well_tested
    .EXAMPLE
        Get-NodeTestingRecord -SortBy Deficit -Top 20
    .EXAMPLE
        Get-NodeTestingRecord -Stale
    .EXAMPLE
        # t/1588 Phase A — write JSON for the TS severeTestScheduler to consume
        Get-NodeTestingRecord -SortBy Deficit -OutputPath ./testing-records.json
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
        [switch]$Stale,

        [Parameter()]
        [string]$OutputPath
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
        # t/1588: raw structural signals captured per-node, keyed by NodeId,
        # normalized-and-weighted in a second pass after all nodes are seen
        # (severeTestScheduler.ts:computeNodeImportance normalizes divide-by-max
        # across the batch — PS mirrors that so both sides agree byte-for-byte).
        $rawSignals = @{}
        $cruxLinks = if ($SortBy -eq 'Deficit') { Get-CruxLinkCount } else { @{} }

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
                    if ($recorded) {
                        # Compare current hash to recorded hash. An empty current
                        # Description is a REAL drift (delete-into-empty), so we
                        # deliberately do not guard on $n.Description here —
                        # per CL review t/1579#4.
                        $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$n.Description)
                        $hashBytes = $sha256.ComputeHash($bytes)
                        $current = 'sha256:' + (-join ($hashBytes | ForEach-Object { $_.ToString('x2') }))
                        if ($current -ne $recorded) { $ntr.Stale = $true }
                    }
                }
            }

            # Deficit-sort raw signals — capture per-node structural counts
            # here; normalize + weight after the loop so we can divide-by-max
            # across the whole batch (matches severeTestScheduler.ts semantics).
            # All property reads guarded by PSObject.Properties to survive both
            # the typed [TaxonomyNode] path and any synthetic PSCustomObject
            # tests hand in via a mocked Get-Tax.
            if ($SortBy -eq 'Deficit') {
                $childCount = 0
                if ($n.PSObject.Properties['Children'] -and $n.Children) {
                    $childCount = @($n.Children).Count
                }
                $sitCount = 0
                if ($n.PSObject.Properties['SituationRefs'] -and $n.SituationRefs) {
                    $sitCount = @($n.SituationRefs).Count
                }
                $confCount = 0
                if ($n.PSObject.Properties['ConflictIds'] -and $n.ConflictIds) {
                    $confCount = @($n.ConflictIds).Count
                }
                $polCount = 0
                if ($ga -and $ga.PSObject.Properties['policy_actions'] -and $null -ne $ga.policy_actions) {
                    $polCount = @($ga.policy_actions).Count
                }
                $usageCount = 0
                if ($n.PSObject.Properties['DebateRefs'] -and $n.DebateRefs) {
                    $usageCount = @($n.DebateRefs).Count
                }
                $doctrinal = 0.0
                if ($n.PSObject.Properties['DoctrinallyAnchored'] -and $n.DoctrinallyAnchored) {
                    $doctrinal = 1.0
                }
                $cruxCount = 0
                $nid = [string]$n.Id
                if ($cruxLinks.ContainsKey($nid)) { $cruxCount = [int]$cruxLinks[$nid] }

                $rawSignals[$nid] = [PSCustomObject]@{
                    Degree          = $childCount + $sitCount + $confCount
                    CruxDensity     = $cruxCount
                    PolicyLinkage   = $polCount
                    DoctrinalAnchor = $doctrinal
                    Usage           = $usageCount
                }
            }

            $results.Add($ntr)
        }

        # Second pass: normalize signals across the batch (divide-by-max, same
        # as severeTestScheduler.ts normalize()) and apply the t/1588 weights.
        if ($SortBy -eq 'Deficit') {
            $maxDegree = 0.0; $maxCrux = 0.0; $maxPolicy = 0.0; $maxUsage = 0.0
            foreach ($nid in $rawSignals.Keys) {
                $s = $rawSignals[$nid]
                if ($s.Degree        -gt $maxDegree) { $maxDegree = [double]$s.Degree }
                if ($s.CruxDensity   -gt $maxCrux)   { $maxCrux   = [double]$s.CruxDensity }
                if ($s.PolicyLinkage -gt $maxPolicy) { $maxPolicy = [double]$s.PolicyLinkage }
                if ($s.Usage         -gt $maxUsage)  { $maxUsage  = [double]$s.Usage }
            }
            # Match TS Math.max(...values, 1) — avoids divide-by-zero when
            # every raw signal is 0. Doctrinal is already 0/1 so no norm.
            $maxDegree = [Math]::Max($maxDegree, 1)
            $maxCrux   = [Math]::Max($maxCrux,   1)
            $maxPolicy = [Math]::Max($maxPolicy, 1)
            $maxUsage  = [Math]::Max($maxUsage,  1)

            $hasAnyImportanceSignal = $false
            foreach ($ntr in $results) {
                $s = $rawSignals[$ntr.NodeId]
                $normDegree   = [double]$s.Degree        / $maxDegree
                $normCrux     = [double]$s.CruxDensity   / $maxCrux
                $normPolicy   = [double]$s.PolicyLinkage / $maxPolicy
                $normUsage    = [double]$s.Usage         / $maxUsage
                $normDoc      = [double]$s.DoctrinalAnchor  # already 0/1
                $imp = (0.25 * $normDegree) + (0.15 * $normCrux) +
                       (0.25 * $normPolicy) + (0.20 * $normDoc)  +
                       (0.15 * $normUsage)
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
                if ($imp -gt 0) { $hasAnyImportanceSignal = $true }
            }
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
            Write-Warning "Get-NodeTestingRecord -SortBy Deficit: no node in the result set carries any of the five importance signals (degree = children+situation_refs+conflict_ids, crux_density from aggregated-cruxes.json, policy_linkage from graph_attributes.policy_actions, doctrinal_anchor, usage = debate_refs). TestingPriority = 0 for every node — this ordering reflects only deficit, not importance."
        }

        if ($Top) {
            $sorted = @($sorted | Select-Object -First $Top)
        }

        # t/1588 Phase A — optional JSON emit for the TS severeTestScheduler.
        # camelCase field names match the TS NodeTestingRecord interface at
        # lib/debate/debateTested.ts. Written AFTER filters/sort/top so the
        # TS consumer receives the same set the pipeline emits.
        if ($OutputPath) {
            $jsonRecords = foreach ($x in $sorted) {
                [ordered]@{
                    nodeId           = $x.NodeId
                    pov              = $x.Pov
                    category         = $x.Category
                    label            = $x.Label
                    tier             = $x.Tier
                    sortKey          = $x.SortKey
                    engagements      = $x.Engagements
                    challenges       = $x.Challenges
                    held             = $x.Held
                    weakened         = $x.Weakened
                    lastTested       = $x.LastTested
                    refined          = $x.Refined
                    stale            = $x.Stale
                    challengerCamps  = @($x.ChallengerCamps)
                    importance       = $x.Importance
                    deficit          = $x.Deficit
                    testingPriority  = $x.TestingPriority
                }
            }
            # -AsArray so a single-record result serializes as [{...}], not {...}.
            $json = @($jsonRecords) | ConvertTo-Json -Depth 6 -AsArray
            Set-Content -Path $OutputPath -Value $json -Encoding utf8NoBOM
            Write-Verbose "Get-NodeTestingRecord: wrote $(@($sorted).Count) records to $OutputPath"
        }

        $sorted
    } finally {
        $sha256.Dispose()
    }
}
