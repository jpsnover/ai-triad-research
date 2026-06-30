# Tag: ingestion (t/1186)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force
}

Describe 'Get-AITClaim' -Tag 'ingestion' {

    BeforeAll {
        $script:summDir = Join-Path $TestDrive 'summaries'
        New-Item -ItemType Directory -Path $script:summDir -Force | Out-Null

        $summary = @{
            doc_id = 'test-doc-001'
            generated_at = '2026-06-01T12:00:00Z'
            factual_claims = @(
                @{
                    claim = 'AI adoption grew 30% in 2025.'
                    claim_label = 'AI Growth Rate'
                    doc_position = 'supports'
                    temporal_scope = 'historical'
                    temporal_bound = '2025'
                    extraction_confidence = 0.95
                    fire_confidence = 0.8
                    linked_taxonomy_nodes = @('acc-beliefs-001')
                    evidence_criteria = @{
                        specificity = 'precise'
                        has_warrant = $true
                        category_criteria = @{ evidence_level = 'direct_empirical' }
                    }
                }
                @{
                    claim = 'Regulation may slow progress.'
                    claim_label = 'Regulation Impact'
                    doc_position = 'disputes'
                    temporal_scope = 'predictive'
                    extraction_confidence = 0.6
                    fire_confidence = 0.5
                    linked_taxonomy_nodes = @('saf-desires-010')
                    evidence_criteria = @{
                        specificity = 'vague'
                        has_warrant = $false
                        category_criteria = @{ evidence_level = 'theoretical' }
                    }
                }
            )
            pov_summaries = @{
                accelerationist = @{
                    key_points = @(
                        @{
                            stance = 'aligned'
                            taxonomy_node_id = 'acc-beliefs-001'
                            category = 'Beliefs'
                            point = 'AI development should proceed rapidly.'
                            verbatim = 'We must accelerate.'
                            extraction_confidence = 0.9
                        }
                    )
                }
                skeptic = @{
                    key_points = @(
                        @{
                            stance = 'opposed'
                            taxonomy_node_id = 'skp-beliefs-020'
                            category = 'Beliefs'
                            point = 'Claims of AI progress are overstated.'
                            verbatim = 'The evidence is insufficient.'
                            extraction_confidence = 0.85
                        }
                        @{
                            stance = 'neutral'
                            taxonomy_node_id = 'skp-desires-005'
                            category = 'Desires'
                            point = 'More empirical research is needed.'
                            extraction_confidence = 0.7
                        }
                        @{
                            stance = 'aligned'
                            taxonomy_node_id = 'skp-intentions-003'
                            category = 'Intentions'
                            point = 'Regulate based on demonstrated harm.'
                            verbatim = @('Quote from paragraph 2.', 'Supporting data from paragraph 7.')
                            extraction_confidence = 0.8
                        }
                    )
                }
            }
        }

        $summary | ConvertTo-Json -Depth 10 |
            Set-Content -Path (Join-Path $script:summDir 'test-doc-001.json')

        Mock Get-SummariesDir { $script:summDir } -ModuleName AITriad
    }

    It 'returns all claims when no filters specified' {
        $claims = Get-AITClaim
        $claims.Count | Should -Be 6
        ($claims | Where-Object Type -eq 'FactualClaim').Count | Should -Be 2
        ($claims | Where-Object Type -eq 'KeyPoint').Count | Should -Be 4
    }

    It 'returns typed AITClaim objects' {
        $claim = Get-AITClaim | Select-Object -First 1
        $claim.GetType().Name | Should -Be 'AITClaim'
        $claim.DocId | Should -Be 'test-doc-001'
    }

    It 'filters by -Type FactualClaim' {
        $claims = Get-AITClaim -Type FactualClaim
        $claims.Count | Should -Be 2
        $claims | ForEach-Object { $_.Type | Should -Be 'FactualClaim' }
    }

    It 'filters by -Type KeyPoint' {
        $claims = Get-AITClaim -Type KeyPoint
        $claims.Count | Should -Be 4
        $claims | ForEach-Object { $_.Type | Should -Be 'KeyPoint' }
    }

    It 'filters by -DocId wildcard' {
        $claims = Get-AITClaim -DocId 'test-doc-*'
        $claims.Count | Should -Be 6

        $claims = Get-AITClaim -DocId 'nonexistent-*'
        $claims | Should -BeNullOrEmpty
    }

    It 'filters by -Pov and suppresses factual claims' {
        $claims = Get-AITClaim -Pov skeptic
        $claims.Count | Should -Be 3
        $claims | ForEach-Object {
            $_.Type | Should -Be 'KeyPoint'
            $_.POV | Should -Be 'skeptic'
        }
    }

    It 'filters by -MinConfidence' {
        $claims = Get-AITClaim -MinConfidence 0.9
        $claims.Count | Should -Be 2
        $claims | ForEach-Object { $_.Confidence | Should -BeGreaterOrEqual 0.9 }
    }

    It 'filters by -DocPosition and suppresses key points' {
        $claims = Get-AITClaim -DocPosition 'disputes'
        $claims.Count | Should -Be 1
        $claims[0].Label | Should -Be 'Regulation Impact'
        $claims[0].Type | Should -Be 'FactualClaim'
    }

    It 'filters by -Stance and suppresses factual claims' {
        $claims = Get-AITClaim -Stance 'opposed'
        $claims.Count | Should -Be 1
        $claims[0].POV | Should -Be 'skeptic'
        $claims[0].Type | Should -Be 'KeyPoint'
    }

    It 'filters by -TemporalScope and suppresses key points' {
        $claims = Get-AITClaim -TemporalScope 'historical'
        $claims.Count | Should -Be 1
        $claims[0].Label | Should -Be 'AI Growth Rate'
    }

    It 'filters by -TaxonomyNode wildcard' {
        $claims = Get-AITClaim -TaxonomyNode 'acc-beliefs-*'
        $claims.Count | Should -Be 2
        $claims | ForEach-Object {
            ($_.LinkedNodes | Where-Object { $_ -like 'acc-beliefs-*' }).Count | Should -BeGreaterThan 0
        }
    }

    It 'populates evidence fields on factual claims' {
        $fc = Get-AITClaim -Type FactualClaim | Where-Object Label -eq 'AI Growth Rate'
        $fc.Specificity | Should -Be 'precise'
        $fc.HasWarrant | Should -BeTrue
        $fc.EvidenceLevel | Should -Be 'direct_empirical'
        $fc.FireConfidence | Should -Be 0.8
        $fc.TemporalBound | Should -Be '2025'
    }

    It 'populates verbatim on key points' {
        $kp = Get-AITClaim -Pov accelerationist
        $kp.Count | Should -Be 1
        $kp[0].Verbatim | Should -Be 'We must accelerate.'
        $kp[0].Category | Should -Be 'Beliefs'
    }

    It 'joins multi-span verbatim arrays into single string' {
        $kp = Get-AITClaim -Pov skeptic | Where-Object Category -eq 'Intentions'
        $kp.Count | Should -Be 1
        $kp[0].Verbatim | Should -Be 'Quote from paragraph 2. [...] Supporting data from paragraph 7.'
    }

    It 'warns when summaries directory does not exist' {
        Mock Get-SummariesDir { Join-Path $TestDrive 'nonexistent' } -ModuleName AITriad
        Get-AITClaim -WarningVariable w -WarningAction SilentlyContinue
        $w | Should -Match 'not found'
    }
}
