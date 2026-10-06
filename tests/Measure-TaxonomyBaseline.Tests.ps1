# Tag: taxonomy (t/3910)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Characterization tests for Measure-TaxonomyBaseline (t/3910), written BEFORE the
    complexity refactor so the same assertions pass unchanged after it.
.DESCRIPTION
    Pins current behavior across all 8 metric blocks on a fixture taxonomy/summaries/
    edges/conflicts/debates tree: node mapping (null/invalid/category-inconsistent/
    unreferenced), density (word-count scaling, zero-word-count guard), edge quality
    (orphans incl. policy-node exemption, self-edges, non-canonical types, the
    Desires-SUPPORTS-Beliefs domain violation), conflict single/multi-instance +
    status counts, fallacy flagging (confidence tiers, per-type counts), description
    quality (stub/short/genus-differentia regex), unmapped-concept resolution, and
    ontology coverage (node_scope/parent/fallacy-tier/temporal/bdi_layer/argument_map).
    Also pins the malformed-summary-JSON Write-Warning, -OutputPath file write,
    -SampleDocIds filtering, the missing-debates-dir zero-division guard, and the
    returned object's top-level shape.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue
}

Describe 'Measure-TaxonomyBaseline' -Tag 'taxonomy' {

    BeforeAll {
        $script:Root = Join-Path $TestDrive 'baseline-fixture'
        $script:TaxDir = Join-Path $script:Root 'taxonomy'
        $script:SummariesDir = Join-Path $script:Root 'summaries'
        $script:SourcesDir = Join-Path $script:Root 'sources'
        $script:ConflictsDir = Join-Path $script:Root 'conflicts'
        $script:DebatesDir = Join-Path $script:Root 'debates'
        foreach ($d in @($script:TaxDir, $script:SummariesDir, $script:SourcesDir, $script:ConflictsDir, $script:DebatesDir)) {
            New-Item -ItemType Directory -Path $d -Force | Out-Null
        }

        # ── Taxonomy: 4 nodes across accelerationist, exercising fallacy/desc/scope fields ──
        $AccNodes = @{
            nodes = @(
                [ordered]@{
                    id = 'acc-desires-001'; category = 'Desires'; label = 'Speed'
                    description = 'A Desire within accelerationist discourse that favors rapid deployment over caution.'
                    parent_id = $null
                    graph_attributes = [ordered]@{
                        node_scope = 'broad'
                        possible_fallacies = @(
                            [ordered]@{ fallacy = 'false-dichotomy'; confidence = 'likely'; type = 'informal' }
                            [ordered]@{ fallacy = 'slippery-slope'; confidence = 'possible' }
                        )
                    }
                },
                [ordered]@{
                    id = 'acc-beliefs-002'; category = 'Beliefs'; label = 'Markets self-correct'
                    description = 'Markets self-correct'  # stub: description == label
                    parent_id = 'acc-desires-001'
                },
                [ordered]@{
                    id = 'acc-beliefs-003'; category = 'Beliefs'; label = 'Short desc node'
                    description = 'Too short.'  # < 50 chars
                    parent_id = $null
                },
                [ordered]@{
                    id = 'acc-beliefs-999'; category = 'Beliefs'; label = 'Unreferenced'
                    description = 'A Belief within accelerationist discourse that nobody cites in any summary key point.'
                    parent_id = $null
                }
            )
        }
        $AccNodes | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $script:TaxDir 'accelerationist.json')
        @{ nodes = @() } | ConvertTo-Json | Set-Content -Path (Join-Path $script:TaxDir 'safetyist.json')
        @{ nodes = @() } | ConvertTo-Json | Set-Content -Path (Join-Path $script:TaxDir 'skeptic.json')
        # Excluded-by-name files must not be double-counted.
        @{ nodes = @([ordered]@{ id = 'should-not-appear' }) } | ConvertTo-Json | Set-Content -Path (Join-Path $script:TaxDir 'embeddings.json')

        # ── Edges: canonical + non-canonical + self-edge + orphan + domain violation ──
        @{
            edges = @(
                [ordered]@{ type = 'SUPPORTS'; source = 'acc-beliefs-002'; target = 'acc-desires-001' }
                [ordered]@{ type = 'SUPPORTS'; source = 'acc-desires-001'; target = 'acc-beliefs-002' }  # Desires SUPPORTS Beliefs: violation
                [ordered]@{ type = 'WEIRD_TYPE'; source = 'acc-beliefs-002'; target = 'acc-beliefs-003' }  # non-canonical
                [ordered]@{ type = 'ASSUMES'; source = 'acc-beliefs-002'; target = 'acc-beliefs-002' }  # self-edge
                [ordered]@{ type = 'SUPPORTS'; source = 'acc-beliefs-002'; target = 'ghost-node' }  # orphan target
                [ordered]@{ type = 'SUPPORTS'; source = 'pol-001'; target = 'acc-beliefs-002' }  # policy source, not an orphan
            )
        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $script:TaxDir 'edges.json')

        # ── Summaries: 2 docs, one with a null-mapped KP, an invalid node ref, a
        # category inconsistency across camps for the same node, an unmapped concept
        # (one resolved, one not), and a temporal-scope-tagged factual claim ──
        @{
            pov_summaries = [ordered]@{
                accelerationist = [ordered]@{
                    key_points = @(
                        [ordered]@{ taxonomy_node_id = 'acc-desires-001'; category = 'Desires' }
                        [ordered]@{ taxonomy_node_id = $null }  # null-mapped
                        [ordered]@{ taxonomy_node_id = 'acc-ghost-ref'; category = 'Beliefs' }  # invalid ref
                    )
                }
                safetyist = [ordered]@{
                    key_points = @(
                        [ordered]@{ taxonomy_node_id = 'acc-desires-001'; category = 'Beliefs' }  # same node, different category -> inconsistency
                    )
                }
                # Production summaries always carry all three camp keys, even when empty.
                skeptic = [ordered]@{ key_points = @() }
            }
            unmapped_concepts = @(
                [ordered]@{ text = 'resolved one'; resolved_node_id = 'acc-beliefs-002' }
                [ordered]@{ text = 'still open' }
            )
            factual_claims = @(
                [ordered]@{ claim = 'dated'; temporal_scope = '2026' }
                [ordered]@{ claim = 'undated' }
            )
        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $script:SummariesDir 'doc-001.json')

        @{
            pov_summaries = [ordered]@{
                accelerationist = [ordered]@{ key_points = @([ordered]@{ taxonomy_node_id = 'acc-beliefs-002'; category = 'Beliefs' }) }
                safetyist = [ordered]@{ key_points = @() }
                skeptic = [ordered]@{ key_points = @() }
            }
            unmapped_concepts = @()
            factual_claims = @()
        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $script:SummariesDir 'doc-002.json')

        # Malformed JSON — must WARN "Bad JSON: ..." and be excluded, not throw.
        Set-Content -Path (Join-Path $script:SummariesDir 'doc-bad.json') -Value '{ not valid json'

        # Source snapshot for density: doc-001 gets a real word count; doc-002 has none.
        New-Item -ItemType Directory -Path (Join-Path $script:SourcesDir 'doc-001') -Force | Out-Null
        Set-Content -Path (Join-Path $script:SourcesDir 'doc-001' 'snapshot.md') -Value (('word ' * 2000).Trim())

        # ── Conflicts: one single-instance open, one multi-instance resolved ──
        @{ instances = @('only-one'); status = 'open' } | ConvertTo-Json | Set-Content -Path (Join-Path $script:ConflictsDir 'c1.json')
        @{ instances = @('a', 'b'); status = 'resolved' } | ConvertTo-Json | Set-Content -Path (Join-Path $script:ConflictsDir 'c2.json')

        # ── Debates: one with argument_map + a bdi_layer-tagged disagreement, one without ──
        @{
            argument_map = @{ nodes = @() }
            synthesis = @{ disagreements = @(@{ bdi_layer = 'belief' }, @{ }) }
        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $script:DebatesDir 'deb-001.json')
        @{ } | ConvertTo-Json | Set-Content -Path (Join-Path $script:DebatesDir 'deb-002.json')
    }

    BeforeEach {
        Mock Get-TaxonomyDir -ModuleName AITriad { $script:TaxDir }
        Mock Get-SummariesDir -ModuleName AITriad { $script:SummariesDir }
        Mock Get-SourcesDir -ModuleName AITriad { $script:SourcesDir }
        Mock Get-ConflictsDir -ModuleName AITriad { $script:ConflictsDir }
        Mock Get-DebatesDir -ModuleName AITriad { $script:DebatesDir }
    }

    It 'returns the full top-level report shape' {
        $r = Measure-TaxonomyBaseline 6>$null
        foreach ($key in 'metadata', 'node_mapping', 'density', 'edges', 'conflicts', 'fallacies', 'descriptions', 'unmapped_concepts', 'ontology_coverage') {
            $r.PSObject.Properties[$key] | Should -Not -BeNullOrEmpty -Because "report must include '$key'"
        }
    }

    It 'metadata reflects the fixture counts' {
        $r = Measure-TaxonomyBaseline 6>$null
        $r.metadata.node_count | Should -Be 4
        $r.metadata.summary_count | Should -Be 2  # the malformed one is excluded
        $r.metadata.edge_count | Should -Be 6
        $r.metadata.conflict_count | Should -Be 2
    }

    It 'warns "Bad JSON" on the malformed summary and excludes it' {
        $warn = $null
        Measure-TaxonomyBaseline -WarningVariable warn -WarningAction SilentlyContinue 6>$null | Out-Null
        @($warn) -join ';' | Should -Match 'Bad JSON: doc-bad\.json'
    }

    It 'node_mapping: counts null-mapped, invalid refs, category inconsistencies, and unreferenced nodes' {
        $r = (Measure-TaxonomyBaseline 6>$null).node_mapping
        $r.total_key_points | Should -Be 5  # 3 (doc-001 acc) + 1 (doc-001 saf) + 1 (doc-002 acc)
        $r.null_mapped | Should -Be 1
        $r.invalid_node_refs | Should -Be 1
        $r.category_inconsistencies | Should -Be 1
        $r.category_inconsistent_ids | Should -Contain 'acc-desires-001'
        # acc-beliefs-003 and acc-beliefs-999 are never referenced by any key point.
        $r.unreferenced_node_count | Should -Be 2
    }

    It 'density: scales key points per 1K words and guards zero word count' {
        $r = (Measure-TaxonomyBaseline 6>$null).density
        $r.doc_count | Should -Be 2
        # doc-002 has no snapshot -> WordCount 0 -> KPPer1K 0, excluded from percentile calc via WordCount>0 filter.
        $r.zero_kp_camp_entries | Should -BeGreaterOrEqual 1
    }

    It 'edges: canonical/non-canonical split, orphan (excluding policy nodes), self-edge, and domain violation' {
        $r = (Measure-TaxonomyBaseline 6>$null).edges
        $r.total_edges | Should -Be 6
        $r.non_canonical_type_count | Should -Be 1
        $r.non_canonical_types[0].type | Should -Be 'WEIRD_TYPE'
        $r.self_edges | Should -Be 1
        $r.orphan_edges | Should -Be 1  # only the ghost-node target; the pol-001 source is exempt
        $r.goals_supports_data | Should -Be 1
    }

    It 'conflicts: single/multi instance and status counts' {
        $r = (Measure-TaxonomyBaseline 6>$null).conflicts
        $r.total_conflicts | Should -Be 2
        $r.single_instance | Should -Be 1
        $r.multi_instance | Should -Be 1
        $r.status_open | Should -Be 1
        $r.status_resolved | Should -Be 1
    }

    It 'fallacies: confidence tiers, per-node flagging, and top fallacy types' {
        $r = (Measure-TaxonomyBaseline 6>$null).fallacies
        $r.nodes_with_fallacies | Should -Be 1
        $r.nodes_without_fallacies | Should -Be 3
        $r.total_flags | Should -Be 2
        $r.confidence_likely | Should -Be 1
        $r.confidence_possible | Should -Be 1
        $r.confidence_borderline | Should -Be 0
        ($r.top_fallacy_types | ForEach-Object { $_.type }) | Should -Contain 'false-dichotomy'
    }

    It 'descriptions: stub (== label), short (<50 chars), and genus-differentia pattern' {
        $r = (Measure-TaxonomyBaseline 6>$null).descriptions
        $r.total_nodes | Should -Be 4
        $r.stub_descriptions | Should -Be 1
        # acc-beliefs-002 (21 chars, the stub) AND acc-beliefs-003 ("Too short.") are both
        # <50 chars -- stub and short are independent counters, not mutually exclusive.
        $r.short_descriptions | Should -Be 2
        # acc-desires-001 AND acc-beliefs-999 both match the genus-differentia regex.
        $r.genus_differentia_pattern | Should -Be 2
    }

    It 'unmapped_concepts: resolved vs unresolved' {
        $r = (Measure-TaxonomyBaseline 6>$null).unmapped_concepts
        $r.total_unmapped_concepts | Should -Be 2
        $r.resolved | Should -Be 1
        $r.unresolved | Should -Be 1
    }

    It 'ontology_coverage: node_scope, parent_relationship, fallacy_tier, temporal_scope, bdi_layer, argument_map' {
        $r = (Measure-TaxonomyBaseline 6>$null).ontology_coverage
        $r._counts.nodes_with_scope | Should -Be 1
        $r._counts.nodes_with_parent | Should -Be 1
        $r._counts.fallacies_with_tier | Should -Be 1  # only the 'likely' fallacy carries a type
        $r._counts.claims_with_temporal | Should -Be 1
        $r._counts.debates_total | Should -Be 2
        $r._counts.debates_with_argmap | Should -Be 1
        $r._counts.disagreements_total | Should -Be 2
        $r._counts.disagreements_with_bdi | Should -Be 1
    }

    It 'honors -SampleDocIds to restrict the summary set' {
        $r = Measure-TaxonomyBaseline -SampleDocIds @('doc-001') 6>$null
        $r.metadata.summary_count | Should -Be 1
        $r.metadata.sample_doc_ids | Should -Be @('doc-001')
    }

    It 'does not throw when every doc in the filtered set has zero word count (t/3998 fixed)' {
        # Was a characterized bug: $AllKPPer1K | Sort-Object returned $null for an empty set, so
        # $SortedKP.Count threw under StrictMode. doc-002 has no snapshot.md -> zero word count.
        $r = Measure-TaxonomyBaseline -SampleDocIds @('doc-002') 6>$null
        $r.metadata.summary_count | Should -Be 1
        $r.density.doc_count | Should -Be 1
        $r.density.median_kp_per_1k | Should -Be 0
        $r.density.p10_kp_per_1k | Should -Be 0
        $r.density.p90_kp_per_1k | Should -Be 0
    }

    It 'writes the report to -OutputPath, identical to the returned object' {
        $outPath = Join-Path $TestDrive "baseline-out-$(New-Guid).json"
        $r = Measure-TaxonomyBaseline -OutputPath $outPath 6>$null
        Test-Path $outPath | Should -BeTrue
        $written = Get-Content -Raw $outPath | ConvertFrom-Json
        $written.metadata.node_count | Should -Be $r.metadata.node_count
        $written.node_mapping.total_key_points | Should -Be $r.node_mapping.total_key_points
    }

    It 'guards zero-division when the debates dir does not exist' {
        Mock Get-DebatesDir -ModuleName AITriad { Join-Path $TestDrive "no-such-debates-$(New-Guid)" }
        $r = (Measure-TaxonomyBaseline 6>$null).ontology_coverage
        $r.bdi_layer_coverage_pct | Should -Be 0
        $r.argument_map_coverage_pct | Should -Be 0
        $r._counts.debates_total | Should -Be 0
    }
}
