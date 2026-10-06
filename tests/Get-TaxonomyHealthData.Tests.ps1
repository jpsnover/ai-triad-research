# Tag: taxonomy (t/3910)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Characterization tests for Get-TaxonomyHealthData, written BEFORE the t/3910 complexity
    refactor (156 -> target <20 per function) so the same assertions pass unchanged after it.
.DESCRIPTION
    Covers: node-index construction (category/description defaults, situations POV), citation
    counting + orphan/most/least-cited derivation, malformed-summary warn-and-skip, unmapped-
    concept aggregation, semantic dedup merge/no-merge, node-embedding auto-resolve match/no-
    match, stance variance, POV/category coverage balance, cross-cutting reference health,
    density signals (depth_expand / width_expand / pov_imbalance), summary-level stats, the
    missing-summaries-dir throw, and GraphMode (present + missing edges.json warn) paths.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

    function New-SummaryFixture {
        param([string]$Dir)
        New-Item -ItemType Directory -Path $Dir -Force | Out-Null

        @{
            doc_id = 'doc1'
            pov_summaries = @{
                accelerationist = @{ key_points = @(@{ taxonomy_node_id = 'acc-beliefs-001'; stance = 'aligned' }) }
                safetyist       = @{ key_points = @(@{ taxonomy_node_id = 'saf-beliefs-001'; stance = 'opposed' }) }
                skeptic         = @{ key_points = @() }
            }
            factual_claims     = @('claim one', 'claim two')
            unmapped_concepts  = @(@{ concept = 'foo bar'; suggested_pov = 'skeptic'; suggested_category = 'Beliefs'; reason = 'new idea' })
        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $Dir 'doc1.json')

        @{
            doc_id = 'doc2'
            pov_summaries = @{
                accelerationist = @{ key_points = @(@{ taxonomy_node_id = 'acc-beliefs-001'; stance = 'opposed' }) }
                safetyist       = @{ key_points = @() }
                skeptic         = @{ key_points = @() }
            }
        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $Dir 'doc2.json')

        Set-Content -Path (Join-Path $Dir 'doc3.json') -Value '{ not valid json'

        @{ doc_id = 'doc4' } | ConvertTo-Json | Set-Content -Path (Join-Path $Dir 'doc4.json')
    }

    function Set-TaxonomyFixture {
        InModuleScope AITriad {
            $script:TaxonomyData = @{
                accelerationist = [PSCustomObject]@{ nodes = @(
                    [PSCustomObject]@{ id = 'acc-beliefs-001'; label = 'Acc B1'; description = 'd1'; category = 'Beliefs'; parent_id = $null; children = @() }
                    [PSCustomObject]@{ id = 'acc-beliefs-002'; label = 'Acc B2'; category = 'Beliefs'; parent_id = 'acc-beliefs-001'; children = @() }  # no description -> defaults to ''
                ) }
                safetyist = [PSCustomObject]@{ nodes = @(
                    [PSCustomObject]@{ id = 'saf-beliefs-001'; label = 'Saf B1'; description = 'd3'; category = 'Beliefs'; parent_id = $null; children = @() }
                ) }
                skeptic = [PSCustomObject]@{ nodes = @(
                    [PSCustomObject]@{ id = 'skp-beliefs-001'; label = 'Skp B1'; description = 'd4'; category = 'Beliefs'; parent_id = $null; children = @() }
                ) }
                situations = [PSCustomObject]@{ nodes = @(
                    [PSCustomObject]@{ id = 'sit-001'; label = 'Sit 1' }  # no category -> 'Situations'; no description -> ''
                ) }
            }
        }
    }
}

Describe 'Get-TaxonomyHealthData (t/3910 characterization)' -Tag 'taxonomy' {

    BeforeEach {
        $script:SummDir = Join-Path $TestDrive "summaries-$(New-Guid)"
        $script:SrcDir  = Join-Path $TestDrive "sources-$(New-Guid)"
        New-Item -ItemType Directory -Path $script:SrcDir -Force | Out-Null
        New-SummaryFixture -Dir $script:SummDir
        Set-TaxonomyFixture
    }

    Context 'node index + citation metrics' {
        BeforeEach {
            InModuleScope AITriad -Parameters @{ SummDir = $script:SummDir; SrcDir = $script:SrcDir } {
                param($SummDir, $SrcDir)
                Mock Get-SummariesDir { $SummDir }
                Mock Get-SourcesDir { $SrcDir }
                Mock Get-TaxonomyDir { Join-Path $TestDrive 'no-embeddings-dir' }
                Mock Get-VersionFile { Join-Path $TestDrive 'NOPE_VERSION' }
                $script:__Result = Get-TaxonomyHealthData -WarningAction SilentlyContinue
            }
        }

        It 'counts citations per node and flags the uncited node as orphan' {
            $r = InModuleScope AITriad { $script:__Result }
            ($r.NodeCitations | Where-Object Id -eq 'acc-beliefs-001').Citations | Should -Be 2
            ($r.NodeCitations | Where-Object Id -eq 'saf-beliefs-001').Citations | Should -Be 1
            $r.OrphanNodes.Id | Should -Contain 'skp-beliefs-001'
            $r.OrphanNodes.Id | Should -Not -Contain 'acc-beliefs-001'
        }

        It 'defaults category to Situations and description to empty string when absent' {
            $r = InModuleScope AITriad { $script:__Result }
            $sit = $r.NodeCitations | Where-Object Id -eq 'sit-001'
            $sit.Category | Should -Be 'Situations'
        }

        It 'reports TaxonomyVersion as unknown when the version file is absent' {
            $r = InModuleScope AITriad { $script:__Result }
            $r.TaxonomyVersion | Should -Be 'unknown'
        }

        It 'counts exactly the 4 fixture summaries, including the malformed one' {
            $r = InModuleScope AITriad { $script:__Result }
            $r.SummaryCount | Should -Be 3  # doc3 is malformed and skipped
        }

        It 'WARNS and skips the malformed summary file rather than throwing' {
            InModuleScope AITriad -Parameters @{ SummDir = $script:SummDir; SrcDir = $script:SrcDir } {
                param($SummDir, $SrcDir)
                Mock Get-SummariesDir { $SummDir }
                Mock Get-SourcesDir { $SrcDir }
                Mock Get-TaxonomyDir { Join-Path $TestDrive 'no-embeddings-dir' }
                Mock Get-VersionFile { Join-Path $TestDrive 'NOPE_VERSION' }
                $w = $null
                Get-TaxonomyHealthData -WarningVariable w -WarningAction SilentlyContinue | Out-Null
                (@($w) -join ';') | Should -Match 'doc3\.json'
            }
        }

        It 'reads TaxonomyVersion from the version file when present' {
            $vf = Join-Path $TestDrive 'VERSION'
            Set-Content -Path $vf -Value '4.2.0'
            $r = InModuleScope AITriad -Parameters @{ SummDir = $script:SummDir; SrcDir = $script:SrcDir; Vf = $vf } {
                param($SummDir, $SrcDir, $Vf)
                Mock Get-SummariesDir { $SummDir }
                Mock Get-SourcesDir { $SrcDir }
                Mock Get-TaxonomyDir { Join-Path $TestDrive 'no-embeddings-dir' }
                Mock Get-VersionFile { $Vf }
                Get-TaxonomyHealthData -WarningAction SilentlyContinue
            }
            $r.TaxonomyVersion | Should -Be '4.2.0'
        }
    }

    Context 'unmapped concepts (no semantic dedup triggered, single concept)' {
        It 'aggregates the single unmapped concept from doc1 with its suggested pov/category' {
            $r = InModuleScope AITriad -Parameters @{ SummDir = $script:SummDir; SrcDir = $script:SrcDir } {
                param($SummDir, $SrcDir)
                Mock Get-SummariesDir { $SummDir }
                Mock Get-SourcesDir { $SrcDir }
                Mock Get-TaxonomyDir { Join-Path $TestDrive 'no-embeddings-dir' }
                Mock Get-VersionFile { Join-Path $TestDrive 'NOPE_VERSION' }
                Get-TaxonomyHealthData -WarningAction SilentlyContinue
            }
            $r.UnmappedConcepts.Count | Should -Be 1
            $r.UnmappedConcepts[0].Concept | Should -Be 'foo bar'
            $r.UnmappedConcepts[0].SuggestedPov | Should -Be 'skeptic'
            $r.UnmappedConcepts[0].Frequency | Should -Be 1
        }
    }

    Context 'semantic dedup of unmapped concepts' {
        BeforeEach {
            $script:DedupDir = Join-Path $TestDrive "dedup-$(New-Guid)"
            New-Item -ItemType Directory -Path $script:DedupDir -Force | Out-Null
            @{ doc_id = 'd1'; unmapped_concepts = @(@{ concept = 'alpha concept'; suggested_pov = 'skeptic'; suggested_category = 'Beliefs' }) } |
                ConvertTo-Json -Depth 10 | Set-Content (Join-Path $script:DedupDir 'd1.json')
            @{ doc_id = 'd2'; unmapped_concepts = @(@{ concept = 'beta concept'; suggested_pov = 'skeptic'; suggested_category = 'Beliefs' }) } |
                ConvertTo-Json -Depth 10 | Set-Content (Join-Path $script:DedupDir 'd2.json')
        }

        It 'merges two unmapped concepts whose embeddings are near-identical (sim >= 0.75)' {
            $r = InModuleScope AITriad -Parameters @{ SummDir = $script:DedupDir; SrcDir = $script:SrcDir } {
                param($SummDir, $SrcDir)
                Mock Get-SummariesDir { $SummDir }
                Mock Get-SourcesDir { $SrcDir }
                Mock Get-TaxonomyDir { Join-Path $TestDrive 'no-embeddings-dir' }
                Mock Get-VersionFile { Join-Path $TestDrive 'NOPE_VERSION' }
                Mock Get-TaxonomyDir { Join-Path $TestDrive 'no-embeddings-dir' }  # skip node auto-resolve
                Mock Get-TextEmbedding { @{ '0' = [double[]]@(1, 0); '1' = [double[]]@(1, 0) } }  # identical vectors
                Get-TaxonomyHealthData -WarningAction SilentlyContinue
            }
            $r.UnmappedConcepts.Count | Should -Be 1
            $r.UnmappedConcepts[0].Frequency | Should -Be 2
            $r.UnmappedConcepts[0].ClusterSize | Should -Be 2
        }

        It 'does NOT merge two unmapped concepts whose embeddings are orthogonal (sim 0)' {
            $r = InModuleScope AITriad -Parameters @{ SummDir = $script:DedupDir; SrcDir = $script:SrcDir } {
                param($SummDir, $SrcDir)
                Mock Get-SummariesDir { $SummDir }
                Mock Get-SourcesDir { $SrcDir }
                Mock Get-TaxonomyDir { Join-Path $TestDrive 'no-embeddings-dir' }
                Mock Get-VersionFile { Join-Path $TestDrive 'NOPE_VERSION' }
                Mock Get-TaxonomyDir { Join-Path $TestDrive 'no-embeddings-dir' }
                Mock Get-TextEmbedding { @{ '0' = [double[]]@(1, 0); '1' = [double[]]@(0, 1) } }  # orthogonal
                Get-TaxonomyHealthData -WarningAction SilentlyContinue
            }
            $r.UnmappedConcepts.Count | Should -Be 2
        }
    }

    Context 'node-embedding auto-resolve of unmapped concepts' {
        BeforeEach {
            $script:ResolveDir = Join-Path $TestDrive "resolve-$(New-Guid)"
            New-Item -ItemType Directory -Path $script:ResolveDir -Force | Out-Null
            @{ doc_id = 'd1'; unmapped_concepts = @(@{ concept = 'solo concept'; suggested_pov = 'skeptic'; suggested_category = 'Beliefs' }) } |
                ConvertTo-Json -Depth 10 | Set-Content (Join-Path $script:ResolveDir 'd1.json')

            $script:EmbDir = Join-Path $TestDrive "emb-$(New-Guid)"
            New-Item -ItemType Directory -Path $script:EmbDir -Force | Out-Null
            @{ nodes = @{ 'acc-beliefs-001' = @{ vector = @(1, 0) } } } | ConvertTo-Json -Depth 10 |
                Set-Content (Join-Path $script:EmbDir 'embeddings.json')
        }

        It 'auto-resolves (removes) an unmapped concept that matches a node above the 0.80 threshold' {
            $r = InModuleScope AITriad -Parameters @{ SummDir = $script:ResolveDir; SrcDir = $script:SrcDir; EmbDir = $script:EmbDir } {
                param($SummDir, $SrcDir, $EmbDir)
                Mock Get-SummariesDir { $SummDir }
                Mock Get-SourcesDir { $SrcDir }
                Mock Get-TaxonomyDir { Join-Path $TestDrive 'no-embeddings-dir' }
                Mock Get-VersionFile { Join-Path $TestDrive 'NOPE_VERSION' }
                Mock Get-TaxonomyDir { $EmbDir }
                Mock Get-TextEmbedding { @{ '0' = [double[]]@(1, 0) } }  # identical to the node vector -> sim 1.0
                Get-TaxonomyHealthData -WarningAction SilentlyContinue
            }
            $r.UnmappedConcepts.Count | Should -Be 0
            $r.NearestNodeMap.Count | Should -Be 1
        }

        It 'leaves an unmapped concept in place when no node matches above threshold' {
            $r = InModuleScope AITriad -Parameters @{ SummDir = $script:ResolveDir; SrcDir = $script:SrcDir; EmbDir = $script:EmbDir } {
                param($SummDir, $SrcDir, $EmbDir)
                Mock Get-SummariesDir { $SummDir }
                Mock Get-SourcesDir { $SrcDir }
                Mock Get-TaxonomyDir { Join-Path $TestDrive 'no-embeddings-dir' }
                Mock Get-VersionFile { Join-Path $TestDrive 'NOPE_VERSION' }
                Mock Get-TaxonomyDir { $EmbDir }
                Mock Get-TextEmbedding { @{ '0' = [double[]]@(0, 1) } }  # orthogonal to the node vector -> sim 0
                Get-TaxonomyHealthData -WarningAction SilentlyContinue
            }
            $r.UnmappedConcepts.Count | Should -Be 1
        }
    }

    Context 'stance variance, coverage balance, cross-cutting health, summary stats' {
        BeforeEach {
            $script:R = InModuleScope AITriad -Parameters @{ SummDir = $script:SummDir; SrcDir = $script:SrcDir } {
                param($SummDir, $SrcDir)
                Mock Get-SummariesDir { $SummDir }
                Mock Get-SourcesDir { $SrcDir }
                Mock Get-TaxonomyDir { Join-Path $TestDrive 'no-embeddings-dir' }
                Mock Get-VersionFile { Join-Path $TestDrive 'NOPE_VERSION' }
                Get-TaxonomyHealthData -WarningAction SilentlyContinue
            }
        }

        It 'flags acc-beliefs-001 as high-variance (both aligned and opposed stances cited)' {
            $script:R.HighVarianceNodes.Id | Should -Contain 'acc-beliefs-001'
            $script:R.StanceVariance['acc-beliefs-001'].HighVariance | Should -BeTrue
        }

        It 'computes coverage balance counts per POV x category' {
            $script:R.CoverageBalance['accelerationist']['Beliefs'] | Should -Be 2
            $script:R.CoverageBalance['safetyist']['Beliefs'] | Should -Be 1
            $script:R.CoverageBalance['skeptic']['Beliefs'] | Should -Be 1
        }

        It 'reports cross-cutting (situations) orphan health' {
            $script:R.CrossCuttingHealth.TotalNodes | Should -Be 1
            $script:R.CrossCuttingHealth.OrphanedCount | Should -Be 1
            $script:R.CrossCuttingHealth.ReferencedCount | Should -Be 0
        }

        It 'computes summary-level stats (totals and average key points)' {
            $script:R.SummaryStats.TotalDocs | Should -Be 3  # doc3 is malformed and skipped
            $script:R.SummaryStats.TotalKeyPoints | Should -Be 3
            $script:R.SummaryStats.AvgKeyPoints | Should -Be 1  # (2 + 1 + 0) / 3 docs
        }
    }

    Context 'density signals' {
        It 'flags depth_expand when a parent has >= 8 direct children' {
            InModuleScope AITriad {
                $nodes = @([PSCustomObject]@{ id = 'acc-beliefs-parent'; label = 'Parent'; category = 'Beliefs'; parent_id = $null; children = @() })
                for ($i = 1; $i -le 8; $i++) {
                    $nodes += [PSCustomObject]@{ id = "acc-beliefs-child$i"; label = "C$i"; category = 'Beliefs'; parent_id = 'acc-beliefs-parent'; children = @() }
                }
                $script:TaxonomyData = @{
                    accelerationist = [PSCustomObject]@{ nodes = $nodes }
                    safetyist       = [PSCustomObject]@{ nodes = @() }
                    skeptic         = [PSCustomObject]@{ nodes = @() }
                    situations      = [PSCustomObject]@{ nodes = @() }
                }
            }
            # One minimal summary file, not a literally empty dir -- an empty-corpus directory
            # hits a separate pre-existing bug (Measure-Object on 0 input returns $null, and
            # StrictMode throws on .Sum), out of scope for this pure-complexity refactor.
            $emptyDir = Join-Path $TestDrive "minimal-summ-$(New-Guid)"
            New-Item -ItemType Directory -Path $emptyDir -Force | Out-Null
            @{ doc_id = 'solo' } | ConvertTo-Json | Set-Content -Path (Join-Path $emptyDir 'solo.json')
            $r = InModuleScope AITriad -Parameters @{ SummDir = $emptyDir; SrcDir = $script:SrcDir } {
                param($SummDir, $SrcDir)
                Mock Get-SummariesDir { $SummDir }
                Mock Get-SourcesDir { $SrcDir }
                Mock Get-TaxonomyDir { Join-Path $TestDrive 'no-embeddings-dir' }
                Mock Get-VersionFile { Join-Path $TestDrive 'NOPE_VERSION' }
                Get-TaxonomyHealthData -WarningAction SilentlyContinue
            }
            $sig = $r.DensitySignals | Where-Object { $_.signal -eq 'depth_expand' }
            $sig.node_id | Should -Be 'acc-beliefs-parent'
            $sig.metric | Should -Be 8
        }

        It 'flags pov_imbalance_under for a POV well below the cross-POV mean' {
            $r = InModuleScope AITriad -Parameters @{ SummDir = $script:SummDir; SrcDir = $script:SrcDir } {
                param($SummDir, $SrcDir)
                Mock Get-SummariesDir { $SummDir }
                Mock Get-SourcesDir { $SrcDir }
                Mock Get-TaxonomyDir { Join-Path $TestDrive 'no-embeddings-dir' }
                Mock Get-VersionFile { Join-Path $TestDrive 'NOPE_VERSION' }
                Get-TaxonomyHealthData -WarningAction SilentlyContinue
            }
            # Fixture: acc=2, saf=1, skp=1 Beliefs nodes -> mean 1.333; saf/skp ratio 0.75 (not < 0.6) so
            # no imbalance signal is expected here -- this proves the signal does NOT over-fire on a mild skew.
            ($r.DensitySignals | Where-Object { $_.signal -like 'pov_imbalance*' }) | Should -BeNullOrEmpty
        }
    }

    Context 'missing summaries directory' {
        It 'throws when the summaries directory does not exist' {
            InModuleScope AITriad {
                Mock Get-SummariesDir { Join-Path $TestDrive 'does-not-exist' }
                Mock Get-SourcesDir { $TestDrive }
                Mock Get-VersionFile { Join-Path $TestDrive 'NOPE_VERSION' }
                { Get-TaxonomyHealthData -WarningAction SilentlyContinue } | Should -Throw '*Summaries directory not found*'
            }
        }
    }

    Context '-GraphMode' {
        BeforeEach {
            $script:GraphTaxDir = Join-Path $TestDrive "graphtax-$(New-Guid)"
            New-Item -ItemType Directory -Path $script:GraphTaxDir -Force | Out-Null
        }

        It 'returns $null GraphHealth and WARNS when edges.json is missing' {
            InModuleScope AITriad -Parameters @{ SummDir = $script:SummDir; SrcDir = $script:SrcDir; GraphTaxDir = $script:GraphTaxDir } {
                param($SummDir, $SrcDir, $GraphTaxDir)
                Mock Get-SummariesDir { $SummDir }
                Mock Get-SourcesDir { $SrcDir }
                Mock Get-TaxonomyDir { Join-Path $TestDrive 'no-embeddings-dir' }
                Mock Get-VersionFile { Join-Path $TestDrive 'NOPE_VERSION' }
                Mock Get-TaxonomyDir { $GraphTaxDir }
                $w = $null
                $r = Get-TaxonomyHealthData -GraphMode -WarningVariable w -WarningAction SilentlyContinue
                $r.GraphHealth | Should -BeNullOrEmpty
                (@($w) -join ';') | Should -Match 'edges\.json not found'
            }
        }

        It 'computes echo-chamber, cross-POV connectivity, orphan and hub metrics from edges.json' {
            @{
                edges = @(
                    @{ source = 'acc-beliefs-001'; target = 'acc-beliefs-002'; type = 'SUPPORTS'; status = 'approved' }
                    @{ source = 'acc-beliefs-001'; target = 'saf-beliefs-001'; type = 'CONTRADICTS'; status = 'approved' }
                    @{ source = 'acc-beliefs-002'; target = 'saf-beliefs-001'; type = 'SUPPORTS'; status = 'approved' }
                )
            } | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $script:GraphTaxDir 'edges.json')

            $r = InModuleScope AITriad -Parameters @{ SummDir = $script:SummDir; SrcDir = $script:SrcDir; GraphTaxDir = $script:GraphTaxDir } {
                param($SummDir, $SrcDir, $GraphTaxDir)
                Mock Get-SummariesDir { $SummDir }
                Mock Get-SourcesDir { $SrcDir }
                Mock Get-TaxonomyDir { Join-Path $TestDrive 'no-embeddings-dir' }
                Mock Get-VersionFile { Join-Path $TestDrive 'NOPE_VERSION' }
                Mock Get-TaxonomyDir { $GraphTaxDir }
                Get-TaxonomyHealthData -GraphMode -WarningAction SilentlyContinue
            }
            $r.GraphHealth | Should -Not -BeNullOrEmpty
            $r.GraphHealth.CrossPovConnectivity.TotalEdges | Should -Be 3
            $r.GraphHealth.CrossPovConnectivity.CrossPovEdges | Should -Be 2
            $r.GraphHealth.EdgeOrphans | Should -Contain 'skp-beliefs-001'
            $r.GraphHealth.EdgeOrphans | Should -Contain 'sit-001'
            $r.GraphHealth.EchoChamberScores['accelerationist'].SamePovSupports | Should -Be 1
        }
    }
}
