BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force
}

Describe 'Get-ExcludesFragments' -Tag 'retrieval' {
    It 'Returns $null when no Excludes: marker present' {
        InModuleScope AITriad {
            $Result = Get-ExcludesFragments -Description 'Broad AI governance and policy mechanisms.'
            $Result | Should -BeNullOrEmpty
        }
    }

    It 'Splits description at Excludes: into Core and Excludes strings' {
        InModuleScope AITriad {
            $Result = Get-ExcludesFragments -Description 'Regulatory oversight mechanisms. Excludes: voluntary commitments only.'
            $Result           | Should -Not -BeNullOrEmpty
            $Result.Core      | Should -Be 'Regulatory oversight mechanisms.'
            $Result.Excludes  | Should -Be 'voluntary commitments only.'
        }
    }

    It 'Is case-insensitive on the Excludes: marker' {
        InModuleScope AITriad {
            $Result = Get-ExcludesFragments -Description 'Core content here. excludes: lower case marker.'
            $Result           | Should -Not -BeNullOrEmpty
            $Result.Core      | Should -Be 'Core content here.'
            $Result.Excludes  | Should -Be 'lower case marker.'
        }
    }

    It 'Returns $null when core text is empty (marker at start)' {
        InModuleScope AITriad {
            $Result = Get-ExcludesFragments -Description 'Excludes: something here'
            $Result | Should -BeNullOrEmpty
        }
    }
}

Describe 'Test-ExcludesVeto' -Tag 'retrieval' {
    It 'Returns Veto when excludes sim > core sim and margin > delta' {
        InModuleScope AITriad {
            # sim(KpVec, ExclVec) = 1.0, sim(KpVec, CoreVec) = 0.0 → margin = 1.0 > delta (0.0) → Veto
            $KpVec   = [double[]]::new(384); $KpVec[0]   = 1.0
            $ExclVec = [double[]]::new(384); $ExclVec[0] = 1.0
            $CoreVec = [double[]]::new(384); $CoreVec[1] = 1.0
            $Result = Test-ExcludesVeto -KpVec $KpVec -CoreVec $CoreVec -ExclVec $ExclVec -VetoMargin 0.0
            $Result.Verdict | Should -Be 'Veto'
            $Result.Margin  | Should -BeGreaterThan 0.0
        }
    }

    It 'Returns Pass when core sim >= excludes sim (margin <= 0)' {
        InModuleScope AITriad {
            # sim(KpVec, CoreVec) = 1.0, sim(KpVec, ExclVec) = 0.0 → margin = -1.0 ≤ 0 → Pass
            $KpVec   = [double[]]::new(384); $KpVec[0]   = 1.0
            $CoreVec = [double[]]::new(384); $CoreVec[0] = 1.0
            $ExclVec = [double[]]::new(384); $ExclVec[1] = 1.0
            $Result = Test-ExcludesVeto -KpVec $KpVec -CoreVec $CoreVec -ExclVec $ExclVec -VetoMargin 0.0
            $Result.Verdict | Should -Be 'Pass'
            $Result.Margin  | Should -BeLessOrEqual 0.0
        }
    }

    It 'Returns Ambiguous when 0 < margin <= delta' {
        InModuleScope AITriad {
            # VecD = [0.6, 0.8, 0...]: sim(VecD, VecA) = 0.6, sim(VecD, VecB) = 0.8
            # margin = 0.8 - 0.6 = 0.2; with delta = 0.3 → Ambiguous
            $VecA = [double[]]::new(384); $VecA[0] = 1.0
            $VecB = [double[]]::new(384); $VecB[1] = 1.0
            $VecD = [double[]]::new(384); $VecD[0] = 0.6; $VecD[1] = 0.8
            $Result = Test-ExcludesVeto -KpVec $VecD -CoreVec $VecA -ExclVec $VecB -VetoMargin 0.3
            $Result.Verdict | Should -Be 'Ambiguous'
            $Result.Margin  | Should -BeGreaterThan 0.0
            $Result.Margin  | Should -BeLessOrEqual 0.3
        }
    }
}

Describe 'Invoke-ExcludesVetoPass' -Tag 'retrieval' {
    It 'Nulls taxonomy_node_id and sets retrieval_low_confidence on Veto' {
        InModuleScope AITriad {
            $script:ExcludesVetoMargin = 0.0
            $script:TaxonomyData = @{
                'saf' = [PSCustomObject]@{
                    nodes = @(
                        [PSCustomObject]@{
                            id          = 'saf-bel-167'
                            label       = 'Behavioral telemetry'
                            description = 'AI monitoring controls. Excludes: software-only behavioral telemetry.'
                        }
                    )
                }
            }
            # kp and excludes both map to dim-0 unit vec; core maps to dim-1
            # margin = sim(kp, excl) - sim(kp, core) = 1.0 - 0.0 = 1.0 > 0 → Veto
            Mock Invoke-BatchEmbedVeto {
                $V0 = [double[]]::new(384); $V0[0] = 1.0
                $V1 = [double[]]::new(384); $V1[1] = 1.0
                return @{
                    'vkp_0'             = $V0
                    'vcore_saf-bel-167' = $V1
                    'vexcl_saf-bel-167' = $V0
                }
            }
            $kp = [PSCustomObject]@{
                taxonomy_node_id        = 'saf-bel-167'
                attribution_text        = 'platform product mandates'
                retrieval_low_confidence = $false
            }
            Invoke-ExcludesVetoPass -KeyPoints @($kp)
            $kp.taxonomy_node_id        | Should -BeNullOrEmpty
            $kp.retrieval_low_confidence | Should -BeTrue
        }
    }

    It 'Does not veto kp assigned to a node without Excludes: marker' {
        InModuleScope AITriad {
            $script:ExcludesVetoMargin = 0.0
            $script:TaxonomyData = @{
                'acc' = [PSCustomObject]@{
                    nodes = @(
                        [PSCustomObject]@{
                            id          = 'acc-bel-001'
                            label       = 'AI progress'
                            description = 'Belief in accelerating AI development.'
                        }
                    )
                }
            }
            Mock Invoke-BatchEmbedVeto { return @{} }
            $kp = [PSCustomObject]@{
                taxonomy_node_id = 'acc-bel-001'
                attribution_text = 'AI should advance quickly'
            }
            Invoke-ExcludesVetoPass -KeyPoints @($kp)
            $kp.taxonomy_node_id | Should -Be 'acc-bel-001'
            Should -Invoke Invoke-BatchEmbedVeto -Times 0 -Exactly
        }
    }

    It 'Forces retrieval_low_confidence true on Ambiguous without nulling node_id' {
        InModuleScope AITriad {
            $script:ExcludesVetoMargin = 0.5
            $script:TaxonomyData = @{
                'saf' = [PSCustomObject]@{
                    nodes = @(
                        [PSCustomObject]@{
                            id          = 'saf-bel-010'
                            label       = 'Some node'
                            description = 'Core monitoring content. Excludes: excluded edge cases.'
                        }
                    )
                }
            }
            # VecD margin = 0.2, delta = 0.5 → Ambiguous
            Mock Invoke-BatchEmbedVeto {
                $VecA = [double[]]::new(384); $VecA[0] = 1.0
                $VecB = [double[]]::new(384); $VecB[1] = 1.0
                $VecD = [double[]]::new(384); $VecD[0] = 0.6; $VecD[1] = 0.8
                return @{
                    'vkp_0'             = $VecD
                    'vcore_saf-bel-010' = $VecA
                    'vexcl_saf-bel-010' = $VecB
                }
            }
            $kp = [PSCustomObject]@{
                taxonomy_node_id        = 'saf-bel-010'
                attribution_text        = 'borderline content'
                retrieval_low_confidence = $false
            }
            Invoke-ExcludesVetoPass -KeyPoints @($kp)
            $kp.taxonomy_node_id        | Should -Be 'saf-bel-010'
            $kp.retrieval_low_confidence | Should -BeTrue
        }
    }

    It 'Skips kp with null taxonomy_node_id without throwing' {
        InModuleScope AITriad {
            $script:ExcludesVetoMargin = 0.0
            $script:TaxonomyData = @{
                'acc' = [PSCustomObject]@{
                    nodes = @(
                        [PSCustomObject]@{
                            id          = 'acc-bel-001'
                            label       = 'Some'
                            description = 'Core. Excludes: bad.'
                        }
                    )
                }
            }
            Mock Invoke-BatchEmbedVeto { return @{} }
            $kp = [PSCustomObject]@{ taxonomy_node_id = $null; attribution_text = 'some text' }
            { Invoke-ExcludesVetoPass -KeyPoints @($kp) } | Should -Not -Throw
            Should -Invoke Invoke-BatchEmbedVeto -Times 0 -Exactly
        }
    }

    It 'Returns zero counts gracefully when Invoke-BatchEmbedVeto returns $null' {
        InModuleScope AITriad {
            $script:ExcludesVetoMargin = 0.0
            $script:TaxonomyData = @{
                'saf' = [PSCustomObject]@{
                    nodes = @(
                        [PSCustomObject]@{
                            id          = 'saf-bel-001'
                            label       = 'Some'
                            description = 'Core content. Excludes: excluded content.'
                        }
                    )
                }
            }
            Mock Invoke-BatchEmbedVeto { return $null }
            $kp = [PSCustomObject]@{
                taxonomy_node_id = 'saf-bel-001'
                attribution_text = 'some text'
            }
            $Result = Invoke-ExcludesVetoPass -KeyPoints @($kp)
            $Result.VetoCount | Should -Be 0
            $Result.AmbiguousCount | Should -Be 0
        }
    }
}
