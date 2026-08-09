# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Invoke-Mechanism5RetrievalPass (t/2357).
.DESCRIPTION
    Covers: v1 safety claim (taxonomy_node_id never mutated), flag criteria
    (retrieval_low_confidence OR absent from candidates), query-text fallback
    (attribution_text -> verbatim), and graceful degradation (no embeddings,
    batch-encode failure, kp missing taxonomy_node_id under StrictMode).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Install test helpers into the module's script scope so InModuleScope blocks
    # can call them without re-defining them in every It block.
    InModuleScope AITriad {
        # 3-dimensional unit vector along the given axis index.
        function script:M5-Vec { param([int]$Axis) $v = [double[]]@(0.0,0.0,0.0); $v[$Axis] = 1.0; $v }

        # Minimal key_point with commonly-needed fields.
        function script:M5-KP {
            param(
                [string]$NodeId      = 'acc-beliefs-001',
                [string]$Attribution = 'some attribution text',
                [string]$Verbatim    = '',
                [bool]  $LowConf     = $false,
                [object[]]$Candidates = @()
            )
            [PSCustomObject]@{
                taxonomy_node_id         = $NodeId
                attribution_text         = $Attribution
                retrieval_low_confidence  = $LowConf
                taxonomy_node_candidates  = $Candidates
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

    # ── v1 safety: taxonomy_node_id is NEVER mutated ───────────────────────────

    Context 'v1 safety — taxonomy_node_id never modified' {

        It 'Does not mutate taxonomy_node_id on a flagged key_point (low confidence)' {
            InModuleScope AITriad {
                $vm = M5-SetFakeState -Pov 'acc'
                Mock Invoke-BatchEmbedAttribution { $vm }

                $kp = M5-KP -NodeId 'acc-beliefs-001' -LowConf $true
                Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' })

                $kp.taxonomy_node_id | Should -Be 'acc-beliefs-001' `
                    -Because 'v1 flag+surface must never replace the assigned node'
            }
        }

        It 'Does not mutate taxonomy_node_id when assigned node is absent from candidates' {
            InModuleScope AITriad {
                $vm = M5-SetFakeState -Pov 'acc'
                Mock Invoke-BatchEmbedAttribution { $vm }

                $Cands = @([PSCustomObject]@{ id = 'acc-beliefs-002'; score = 0.9 })
                $kp = M5-KP -NodeId 'acc-beliefs-001' -LowConf $false -Candidates $Cands
                Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' })

                $kp.taxonomy_node_id | Should -Be 'acc-beliefs-001' `
                    -Because 'v1 must not auto-correct even when a better candidate exists'
            }
        }
    }

    # ── flag criteria ──────────────────────────────────────────────────────────

    Context 'Flag criteria' {

        It 'Sets mechanism5_flag when retrieval_low_confidence is true' {
            InModuleScope AITriad {
                $vm = M5-SetFakeState -Pov 'acc'
                Mock Invoke-BatchEmbedAttribution { $vm }

                $kp = M5-KP -NodeId 'acc-beliefs-001' -LowConf $true
                Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' })

                $kp.mechanism5_flag | Should -BeTrue -Because 'low confidence satisfies condition 1'
            }
        }

        It 'Sets mechanism5_flag when assigned node is absent from taxonomy_node_candidates' {
            InModuleScope AITriad {
                $vm = M5-SetFakeState -Pov 'acc'
                Mock Invoke-BatchEmbedAttribution { $vm }

                $Cands = @([PSCustomObject]@{ id = 'acc-beliefs-002'; score = 0.9 })
                $kp = M5-KP -NodeId 'acc-beliefs-001' -LowConf $false -Candidates $Cands
                Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' })

                $kp.mechanism5_flag | Should -BeTrue -Because 'absent from candidates satisfies condition 2'
            }
        }

        It 'Does NOT flag when confidence is good and assigned node is in candidates' {
            InModuleScope AITriad {
                $script:CachedEmbeddings = @{ 'acc-beliefs-001' = M5-Vec 0 }
                $script:TaxonomyData = @{}
                Mock Invoke-BatchEmbedAttribution { @{} }

                $Cands = @([PSCustomObject]@{ id = 'acc-beliefs-001'; score = 0.8 })
                $kp = M5-KP -NodeId 'acc-beliefs-001' -LowConf $false -Candidates $Cands
                Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' })

                $kp.PSObject.Properties['mechanism5_flag'] | Should -BeNullOrEmpty `
                    -Because 'neither condition is met; key_point must not be flagged'
            }
        }

        It 'Surfaces mechanism5_candidates (top-3) on a flagged key_point' {
            InModuleScope AITriad {
                $vm = M5-SetFakeState -Pov 'acc'
                Mock Invoke-BatchEmbedAttribution { $vm }

                $kp = M5-KP -NodeId 'acc-beliefs-001' -LowConf $true
                Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' })

                $kp.PSObject.Properties['mechanism5_candidates'] | Should -Not -BeNullOrEmpty
                @($kp.mechanism5_candidates).Count | Should -BeLessOrEqual 3
                $kp.mechanism5_candidates[0].PSObject.Properties['id']    | Should -Not -BeNullOrEmpty
                $kp.mechanism5_candidates[0].PSObject.Properties['score'] | Should -Not -BeNullOrEmpty
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
                    retrieval_low_confidence  = $true
                    taxonomy_node_candidates  = @()
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
                    retrieval_low_confidence  = $true
                    taxonomy_node_candidates  = @()
                }
                Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' })

                $script:M5CapturedItems[0].Text | Should -Be 'only verbatim here' `
                    -Because 'verbatim is the fallback when attribution_text is absent'
            }
        }

        It 'Skips a flagged key_point when both attribution_text and verbatim are absent' {
            InModuleScope AITriad {
                $script:CachedEmbeddings = @{ 'acc-beliefs-001' = M5-Vec 0 }
                $script:TaxonomyData = @{}
                $script:M5BatchWasCalled = $false
                Mock Invoke-BatchEmbedAttribution { $script:M5BatchWasCalled = $true; @{} }

                $kp = [PSCustomObject]@{
                    taxonomy_node_id         = 'acc-beliefs-001'
                    retrieval_low_confidence  = $true
                    taxonomy_node_candidates  = @()
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

                $kp = M5-KP -NodeId 'acc-beliefs-001' -LowConf $true
                { Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' }) } |
                    Should -Not -Throw

                $kp.PSObject.Properties['mechanism5_flag'] | Should -BeNullOrEmpty `
                    -Because 'no embeddings means pass must silently skip'
            }
        }

        It 'Does not throw when CachedEmbeddings is null' {
            InModuleScope AITriad {
                $script:CachedEmbeddings = $null

                $kp = M5-KP -NodeId 'acc-beliefs-001' -LowConf $true
                { Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' }) } |
                    Should -Not -Throw
            }
        }

        It 'Does not throw when Invoke-BatchEmbedAttribution returns null' {
            InModuleScope AITriad {
                $script:CachedEmbeddings = @{ 'acc-beliefs-001' = M5-Vec 0 }
                $script:TaxonomyData = @{}
                Mock Invoke-BatchEmbedAttribution { $null }

                $kp = M5-KP -NodeId 'acc-beliefs-001' -LowConf $true
                { Invoke-Mechanism5RetrievalPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'accelerationist' }) } |
                    Should -Not -Throw

                $kp.PSObject.Properties['mechanism5_flag'] | Should -BeNullOrEmpty `
                    -Because 'batch-encode failure must degrade gracefully without flagging'
            }
        }

        It 'Does not throw on a key_point missing taxonomy_node_id (StrictMode guard)' {
            InModuleScope AITriad {
                $script:CachedEmbeddings = @{ 'acc-beliefs-001' = M5-Vec 0 }

                $kp = [PSCustomObject]@{ attribution_text = 'text'; retrieval_low_confidence = $true }
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
