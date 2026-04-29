# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Invoke-IterativeExtraction semantic drift detection (gap 4.1).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Invoke-IterativeExtraction drift detection (gap 4.1)' {

    It 'Flags drift_warning when refined claim diverges from taxonomy node' {
        InModuleScope AITriad {
            $script:TaxonomyData = @{
                'accelerationist' = [PSCustomObject]@{
                    nodes = @(
                        [PSCustomObject]@{
                            id          = 'acc-beliefs-001'
                            label       = 'Rapid AI development benefits humanity'
                            description = 'Accelerationist belief that fast AI progress yields economic and social gains.'
                            category    = 'Beliefs'
                        }
                    )
                }
            }
            $script:CachedEmbeddings = $null

            # Initial extraction (MaxTokens=32768) returns a claim with taxonomy mapping
            Mock Invoke-AIApi -ParameterFilter { $MaxTokens -eq 32768 } {
                [PSCustomObject]@{
                    Text = '{"factual_claims":[{"claim_label":"claim-0","claim":"Rapid AI development benefits humanity through economic growth","taxonomy_node_id":"acc-beliefs-001","evidence_criteria":{"specificity":"vague","has_warrant":false,"internally_consistent":true}}],"pov_summaries":{},"unmapped_concepts":[]}'
                    Backend = 'gemini'; Model = 'gemini-2.5-flash'; Truncated = $false; Usage = $null; RawResponse = @{}
                }
            }

            # Refinement (MaxTokens=2048) returns a drifted claim
            Mock Invoke-AIApi -ParameterFilter { $MaxTokens -eq 2048 } {
                [PSCustomObject]@{
                    Text = '{"claim_label":"claim-0","verified":true,"refined_claim":"International trade tariffs reduce consumer purchasing power across all sectors","evidence_criteria":{"specificity":"precise","has_warrant":true,"internally_consistent":true},"confidence":0.85}'
                    Backend = 'gemini'; Model = 'gemini-2.5-flash'; Truncated = $false; Usage = $null; RawResponse = @{}
                }
            }

            $result = Invoke-IterativeExtraction `
                -Prompt 'test' -Model 'gemini-2.5-flash' -ApiKey 'fake' `
                -ConfidenceThreshold 0.7 -MaxIterPerClaim 1 -WallClockSeconds 30 3>$null

            $result.Summary.factual_claims[0].drift_warning | Should -BeTrue
            $result.FireStats.claims_drifted | Should -BeGreaterOrEqual 1
        }
    }

    It 'Does not flag drift when refined claim stays semantically close' {
        InModuleScope AITriad {
            $script:TaxonomyData = @{
                'accelerationist' = [PSCustomObject]@{
                    nodes = @(
                        [PSCustomObject]@{
                            id          = 'acc-beliefs-001'
                            label       = 'Rapid AI development benefits humanity'
                            description = 'Accelerationist belief that fast AI progress yields economic and social gains.'
                            category    = 'Beliefs'
                        }
                    )
                }
            }
            $script:CachedEmbeddings = $null

            Mock Invoke-AIApi -ParameterFilter { $MaxTokens -eq 32768 } {
                [PSCustomObject]@{
                    Text = '{"factual_claims":[{"claim_label":"claim-0","claim":"Fast AI development helps people","taxonomy_node_id":"acc-beliefs-001","evidence_criteria":{"specificity":"vague","has_warrant":false,"internally_consistent":true}}],"pov_summaries":{},"unmapped_concepts":[]}'
                    Backend = 'gemini'; Model = 'gemini-2.5-flash'; Truncated = $false; Usage = $null; RawResponse = @{}
                }
            }

            # Refined claim stays close: still about rapid AI development benefits
            Mock Invoke-AIApi -ParameterFilter { $MaxTokens -eq 2048 } {
                [PSCustomObject]@{
                    Text = '{"claim_label":"claim-0","verified":true,"refined_claim":"Rapid AI development yields significant economic benefits and social gains for humanity","evidence_criteria":{"specificity":"precise","has_warrant":true,"internally_consistent":true},"confidence":0.85}'
                    Backend = 'gemini'; Model = 'gemini-2.5-flash'; Truncated = $false; Usage = $null; RawResponse = @{}
                }
            }

            $result = Invoke-IterativeExtraction `
                -Prompt 'test' -Model 'gemini-2.5-flash' -ApiKey 'fake' `
                -ConfidenceThreshold 0.7 -MaxIterPerClaim 1 -WallClockSeconds 30 3>$null

            $result.Summary.factual_claims[0].PSObject.Properties['drift_warning'] | Should -BeNullOrEmpty
            $result.FireStats.claims_drifted | Should -Be 0
        }
    }

    It 'Skips drift check for claims without taxonomy_node_id' {
        InModuleScope AITriad {
            $script:TaxonomyData = @{
                'accelerationist' = [PSCustomObject]@{
                    nodes = @([PSCustomObject]@{ id = 'acc-beliefs-001'; label = 'X'; description = 'Y'; category = 'Beliefs' })
                }
            }
            $script:CachedEmbeddings = $null

            Mock Invoke-AIApi -ParameterFilter { $MaxTokens -eq 32768 } {
                [PSCustomObject]@{
                    Text = '{"factual_claims":[{"claim_label":"claim-0","claim":"Some observation","evidence_criteria":{"specificity":"vague","has_warrant":false,"internally_consistent":true}}],"pov_summaries":{},"unmapped_concepts":[]}'
                    Backend = 'gemini'; Model = 'gemini-2.5-flash'; Truncated = $false; Usage = $null; RawResponse = @{}
                }
            }

            Mock Invoke-AIApi -ParameterFilter { $MaxTokens -eq 2048 } {
                [PSCustomObject]@{
                    Text = '{"claim_label":"claim-0","verified":true,"refined_claim":"Completely different marine biology topic","evidence_criteria":{"specificity":"precise","has_warrant":true,"internally_consistent":true},"confidence":0.85}'
                    Backend = 'gemini'; Model = 'gemini-2.5-flash'; Truncated = $false; Usage = $null; RawResponse = @{}
                }
            }

            $result = Invoke-IterativeExtraction `
                -Prompt 'test' -Model 'gemini-2.5-flash' -ApiKey 'fake' `
                -ConfidenceThreshold 0.7 -MaxIterPerClaim 1 -WallClockSeconds 30 3>$null

            $result.FireStats.claims_drifted | Should -Be 0
        }
    }

    It 'Includes claims_drifted key in FireStats even with no iteration' {
        InModuleScope AITriad {
            $script:TaxonomyData = @{}
            $script:CachedEmbeddings = $null

            # All claims already confident — no iteration needed
            Mock Invoke-AIApi -ParameterFilter { $MaxTokens -eq 32768 } {
                [PSCustomObject]@{
                    Text = '{"factual_claims":[{"claim_label":"claim-0","claim":"A claim","evidence_criteria":{"specificity":"precise","has_warrant":true,"internally_consistent":true}}],"pov_summaries":{},"unmapped_concepts":[]}'
                    Backend = 'gemini'; Model = 'gemini-2.5-flash'; Truncated = $false; Usage = $null; RawResponse = @{}
                }
            }

            $result = Invoke-IterativeExtraction `
                -Prompt 'test' -Model 'gemini-2.5-flash' -ApiKey 'fake' `
                -ConfidenceThreshold 0.7 -MaxIterPerClaim 1 -WallClockSeconds 30 3>$null

            $result.FireStats.ContainsKey('claims_drifted') | Should -BeTrue
            $result.FireStats.claims_drifted | Should -Be 0
        }
    }
}
