# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Invoke-Mechanism5RetrievalPass (t/2357).
.DESCRIPTION
    Covers: safety claim (taxonomy_node_id never mutated), margin trigger
    ((top1_score - assigned_score) > MarginThreshold), query-text fallback
    (attribution_text -> verbatim), and graceful degradation (no embeddings,
    missing candidates/confidence fields, batch-encode failure, StrictMode guard).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Install test helpers into the module's script scope so InModuleScope blocks
    # can call them without re-defining them in every It block.
    InModuleScope AITriad {
        # 3-dimensional unit vector along the given axis index.
        function script:M5-Vec { param([int]$Axis) $v = [double[]]@(0.0,0.0,0.0); $v[$Axis] = 1.0; $v }

        # Minimal key_point with margin-trigger fields.
        # Top1Score / AssignedScore control whether the margin fires (> MarginThreshold = 0.06).
        function script:M5-KP {
            param(
                [string]$NodeId        = 'acc-beliefs-001',
                [string]$Attribution   = 'some attribution text',
                [string]$Verbatim      = '',
                [double]$Top1Score     = 0.9,   # taxonomy_node_candidates[0].score
                [double]$AssignedScore = 0.2,   # retrieval_confidence (margin = 0.7 > 0.06 → fires)
                [string]$Top1Id        = 'acc-beliefs-002'
            )
            $Cand = [PSCustomObject]@{ id = $Top1Id; score = $Top1Score; label = 'Top Node' }
            [PSCustomObject]@{
                taxonomy_node_id         = $NodeId
                attribution_text         = $Attribution
                retrieval_confidence     = $AssignedScore
                taxonomy_node_candidates = @($Cand)
            }
        }

        # Populate module-scope embeddings and TaxonomyData; return a VectorMap for
        # mocking Invoke-BatchEmbedAttribution (query aligns with axis-0, i.e. Node One).
        function script:M5-SetFakeState { param([string]$Pov = 'acc')
            $script:CachedEmbeddings = @{
                "$Pov-beliefs-001" = M5-Vec 0
                "$Pov-beliefs-002" = M5-Vec 1
                'sit-001'          = M5-Vec 2
            }
            $script:TaxonomyData = @{
                $Pov = [PSCustomObject]@{
                    nodes = @(
                        [PSCustomObject]@{ id = "$Pov-beliefs-001"; label = 'Node One' }
                        [PSCustomObject]@{ id = "$Pov-beliefs-002"; label = 'Node Two' }
                    )
                }
            }
            # VectorMap for mocking: EmbedId m5_0 -> axis-0 vector
            @{ 'm5_0' = M5-Vec 0 }
        }
    }
}

Describe 'Invoke-Mechanism5RetrievalPass' -Tag 'mechanism5','retrieval' {

    # ── safety: taxonomy_node_id is NEVER mutated ──────────────────────────────

    Context 'Safety — taxonomy_node_id never modified' {

        It 'Does not mutate taxonomy_node_id on a margin-triggered key_point' {
            InModuleScope AITriad {
                $vm = M5-SetFakeState -Pov 'acc'
                Mock Invoke-BatchEmbedAttribution { $vm }

                # margin = 0.9 - 0.2 = 0.7 > 0.06 → fires
                $kp = M5-KP -NodeId 'acc-beliefs-001' -Top1Score 0.9 -AssignedScore 0.2
                Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' })

                $kp.taxonomy_node_id | Should -Be 'acc-beliefs-001' `
                    -Because 'flag+surface must never replace the assigned node'
            }
        }

        It 'Does not mutate taxonomy_node_id when a clearly better candidate exists' {
            InModuleScope AITriad {
                $vm = M5-SetFakeState -Pov 'acc'
                Mock Invoke-BatchEmbedAttribution { $vm }

                # large margin — a strong alternative is available
                $kp = M5-KP -NodeId 'acc-beliefs-001' -Top1Score 0.95 -AssignedScore 0.10 -Top1Id 'acc-beliefs-002'
                Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' })

                $kp.taxonomy_node_id | Should -Be 'acc-beliefs-001' `
                    -Because 'auto-correct is cancelled; must never replace the assigned node'
            }
        }
    }

    # ── margin trigger ─────────────────────────────────────────────────────────

    Context 'Margin trigger' {

        It 'Sets mechanism5_flag when (top1_score - assigned_score) exceeds MarginThreshold' {
            InModuleScope AITriad {
                $vm = M5-SetFakeState -Pov 'acc'
                Mock Invoke-BatchEmbedAttribution { $vm }

                # margin = 0.9 - 0.2 = 0.7 > 0.06 (default threshold)
                $kp = M5-KP -NodeId 'acc-beliefs-001' -Top1Score 0.9 -AssignedScore 0.2
                Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' })

                $kp.mechanism5_flag | Should -BeTrue -Because 'margin 0.7 exceeds threshold 0.06'
            }
        }

        It 'Sets mechanism5_flag even when assigned_score is high (high-conf misfire case)' {
            InModuleScope AITriad {
                $vm = M5-SetFakeState -Pov 'acc'
                Mock Invoke-BatchEmbedAttribution { $vm }

                # high confidence but top-1 dominates — the real-world misfire pattern
                $kp = M5-KP -NodeId 'acc-beliefs-001' -Top1Score 0.92 -AssignedScore 0.80
                Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' })

                $kp.mechanism5_flag | Should -BeTrue -Because 'margin 0.12 > 0.06; high conf should not suppress flag'
            }
        }

        It 'Does NOT flag when margin is at or below MarginThreshold' {
            InModuleScope AITriad {
                $script:CachedEmbeddings = @{ 'acc-beliefs-001' = M5-Vec 0 }
                $script:TaxonomyData = @{}

                # margin = 0.8 - 0.78 = 0.02 ≤ 0.06 → no flag (near-tie)
                $kp = M5-KP -NodeId 'acc-beliefs-001' -Top1Score 0.80 -AssignedScore 0.78
                Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' })

                $kp.PSObject.Properties['mechanism5_flag'] | Should -BeNullOrEmpty `
                    -Because 'near-tie (margin 0.02 ≤ 0.06) must not be flagged'
            }
        }

        It 'Surfaces mechanism5_candidates (top-3 POV-filtered) on a flagged key_point' {
            InModuleScope AITriad {
                $vm = M5-SetFakeState -Pov 'acc'
                Mock Invoke-BatchEmbedAttribution { $vm }

                $kp = M5-KP -NodeId 'acc-beliefs-001' -Top1Score 0.9 -AssignedScore 0.2
                Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' })

                $kp.PSObject.Properties['mechanism5_candidates'] | Should -Not -BeNullOrEmpty
                @($kp.mechanism5_candidates).Count | Should -BeLessOrEqual 3
                $kp.mechanism5_candidates[0].PSObject.Properties['id']    | Should -Not -BeNullOrEmpty
                $kp.mechanism5_candidates[0].PSObject.Properties['score'] | Should -Not -BeNullOrEmpty
            }
        }

        It 'Accepts custom MarginThreshold parameter' {
            InModuleScope AITriad {
                $script:CachedEmbeddings = @{ 'acc-beliefs-001' = M5-Vec 0 }
                $script:TaxonomyData = @{}

                # margin = 0.80 - 0.78 = 0.02; fires at threshold 0.01, not at 0.06
                $kp = M5-KP -NodeId 'acc-beliefs-001' -Top1Score 0.80 -AssignedScore 0.78
                Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' }) -MarginThreshold 0.06
                $kp.PSObject.Properties['mechanism5_flag'] | Should -BeNullOrEmpty -Because 'margin 0.02 ≤ 0.06'

                $kp2 = M5-KP -NodeId 'acc-beliefs-001' -Top1Score 0.80 -AssignedScore 0.78
                $vm2 = M5-SetFakeState -Pov 'acc'
                Mock Invoke-BatchEmbedAttribution { $vm2 }
                Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp2; POV = 'accelerationist' }) -MarginThreshold 0.01
                $kp2.mechanism5_flag | Should -BeTrue -Because 'margin 0.02 > custom threshold 0.01'
            }
        }
    }

    # ── query-text selection ───────────────────────────────────────────────────

    Context 'Query-text selection' {

        It 'Prefers attribution_text over verbatim when both present' {
            InModuleScope AITriad {
                $vm = M5-SetFakeState -Pov 'acc'
                Mock Invoke-BatchEmbedAttribution {
                    param($Items)
                    $script:M5CapturedItems = @($Items)
                    $vm
                }

                $kp = [PSCustomObject]@{
                    taxonomy_node_id         = 'acc-beliefs-001'
                    attribution_text         = 'the attribution'
                    verbatim                 = 'the verbatim'
                    retrieval_confidence     = 0.2
                    taxonomy_node_candidates = @([PSCustomObject]@{ id = 'acc-beliefs-002'; score = 0.9; label = '' })
                }
                Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' })

                $script:M5CapturedItems[0].Text | Should -Be 'the attribution' `
                    -Because 'attribution_text is the primary query source'
            }
        }

        It 'Falls back to verbatim when attribution_text is absent' {
            InModuleScope AITriad {
                $vm = M5-SetFakeState -Pov 'acc'
                Mock Invoke-BatchEmbedAttribution {
                    param($Items)
                    $script:M5CapturedItems = @($Items)
                    $vm
                }

                $kp = [PSCustomObject]@{
                    taxonomy_node_id         = 'acc-beliefs-001'
                    verbatim                 = 'only verbatim here'
                    retrieval_confidence     = 0.2
                    taxonomy_node_candidates = @([PSCustomObject]@{ id = 'acc-beliefs-002'; score = 0.9; label = '' })
                }
                Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' })

                $script:M5CapturedItems[0].Text | Should -Be 'only verbatim here' `
                    -Because 'verbatim is the fallback when attribution_text is absent'
            }
        }

        It 'Skips a margin-triggered key_point when both attribution_text and verbatim are absent' {
            InModuleScope AITriad {
                $script:CachedEmbeddings = @{ 'acc-beliefs-001' = M5-Vec 0 }
                $script:TaxonomyData = @{}
                $script:M5BatchWasCalled = $false
                Mock Invoke-BatchEmbedAttribution { $script:M5BatchWasCalled = $true; @{} }

                $kp = [PSCustomObject]@{
                    taxonomy_node_id         = 'acc-beliefs-001'
                    retrieval_confidence     = 0.2
                    taxonomy_node_candidates = @([PSCustomObject]@{ id = 'acc-beliefs-002'; score = 0.9; label = '' })
                }
                Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' })

                $script:M5BatchWasCalled | Should -BeFalse `
                    -Because 'no query text means no embed items, so batch must not be called'
                $kp.PSObject.Properties['mechanism5_flag'] | Should -BeNullOrEmpty
            }
        }
    }

    # ── graceful degradation ───────────────────────────────────────────────────

    Context 'Graceful degradation' {

        It 'Does not throw when CachedEmbeddings is empty' {
            InModuleScope AITriad {
                $script:CachedEmbeddings = @{}

                $kp = M5-KP -NodeId 'acc-beliefs-001' -Top1Score 0.9 -AssignedScore 0.2
                { Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' }) } |
                    Should -Not -Throw

                $kp.PSObject.Properties['mechanism5_flag'] | Should -BeNullOrEmpty `
                    -Because 'no embeddings means pass must silently skip'
            }
        }

        It 'Does not throw when CachedEmbeddings is null' {
            InModuleScope AITriad {
                $script:CachedEmbeddings = $null

                $kp = M5-KP -NodeId 'acc-beliefs-001' -Top1Score 0.9 -AssignedScore 0.2
                { Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' }) } |
                    Should -Not -Throw
            }
        }

        It 'Does not throw when taxonomy_node_candidates is absent — skips margin check' {
            InModuleScope AITriad {
                $script:CachedEmbeddings = @{ 'acc-beliefs-001' = M5-Vec 0 }
                $script:TaxonomyData = @{}

                $kp = [PSCustomObject]@{
                    taxonomy_node_id     = 'acc-beliefs-001'
                    attribution_text     = 'text'
                    retrieval_confidence = 0.2
                }
                { Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' }) } |
                    Should -Not -Throw
                $kp.PSObject.Properties['mechanism5_flag'] | Should -BeNullOrEmpty `
                    -Because 'missing candidates means top1_score is unknown; must skip'
            }
        }

        It 'Does not throw when retrieval_confidence is absent — skips margin check' {
            InModuleScope AITriad {
                $script:CachedEmbeddings = @{ 'acc-beliefs-001' = M5-Vec 0 }
                $script:TaxonomyData = @{}

                $kp = [PSCustomObject]@{
                    taxonomy_node_id         = 'acc-beliefs-001'
                    attribution_text         = 'text'
                    taxonomy_node_candidates = @([PSCustomObject]@{ id = 'acc-beliefs-002'; score = 0.9; label = '' })
                }
                { Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' }) } |
                    Should -Not -Throw
                $kp.PSObject.Properties['mechanism5_flag'] | Should -BeNullOrEmpty `
                    -Because 'missing retrieval_confidence means assigned_score unknown; must skip'
            }
        }

        It 'Does not throw when Invoke-BatchEmbedAttribution returns null' {
            InModuleScope AITriad {
                $script:CachedEmbeddings = @{ 'acc-beliefs-001' = M5-Vec 0 }
                $script:TaxonomyData = @{}
                Mock Invoke-BatchEmbedAttribution { $null }

                # margin = 0.9 - 0.2 = 0.7 > 0.06 → reaches batch-encode
                $kp = M5-KP -NodeId 'acc-beliefs-001' -Top1Score 0.9 -AssignedScore 0.2
                { Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' }) } |
                    Should -Not -Throw

                $kp.PSObject.Properties['mechanism5_flag'] | Should -BeNullOrEmpty `
                    -Because 'batch-encode failure must degrade gracefully without flagging'
            }
        }

        It 'Does not throw on a key_point missing taxonomy_node_id (StrictMode guard)' {
            InModuleScope AITriad {
                $script:CachedEmbeddings = @{ 'acc-beliefs-001' = M5-Vec 0 }

                $kp = [PSCustomObject]@{ attribution_text = 'text'; retrieval_confidence = 0.2 }
                { Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' }) } |
                    Should -Not -Throw -Because 'missing taxonomy_node_id must be skipped, not throw under StrictMode'
            }
        }

        It 'Does not throw on an empty KeyPointItems array' {
            InModuleScope AITriad {
                $script:CachedEmbeddings = @{ 'acc-beliefs-001' = M5-Vec 0 }
                { Invoke-Mechanism5RetrievalPass -KeyPointItems @() } | Should -Not -Throw
            }
        }
    }
}
