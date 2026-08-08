# Tag: ingestion (t/2287)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Get-RelevantTaxonomyNodes -CrossEncoderRerank (t/2287).
.DESCRIPTION
    Exercises the cross-encoder re-ranking pass with the scoring subprocess
    (Invoke-RerankScoring) mocked, so the reorder / metrics / fallback logic is
    verified without a live model. The synthetic reorder stands in for the
    mechanism; the real SAF-167 repro fixture is CL-owned and tracked in t/2294.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Get-RelevantTaxonomyNodes -CrossEncoderRerank (t/2287)' -Tag 'ingestion' {

    # Shared fixture: 3 Beliefs nodes; the query is closest to acc-beliefs-001
    # by bi-encoder cosine (0.99 > saf 0.11 > skp 0.00).
    BeforeEach {
        InModuleScope AITriad {
            Mock Assert-TaxonomyCacheFresh { }  # keep our seeded cache; don't reload from disk
            $script:CachedSyntheticVectors = @{}  # non-null → skip synthetic-file load
            $script:LastRAGMetrics = $null
            $script:LastCrossEncoderScores = $null

            $script:CachedEmbeddings = @{
                'acc-beliefs-001' = [double[]]@(1, 0, 0)
                'saf-beliefs-001' = [double[]]@(0, 1, 0)
                'skp-beliefs-001' = [double[]]@(0, 0, 1)
            }
            $script:TaxonomyData = @{
                'accelerationist' = [PSCustomObject]@{ nodes = @([PSCustomObject]@{ id = 'acc-beliefs-001'; label = 'Acc B1'; description = 'Accelerationist belief one.'; category = 'Beliefs'; parent_id = ''; children = @() }) }
                'safetyist'       = [PSCustomObject]@{ nodes = @([PSCustomObject]@{ id = 'saf-beliefs-001'; label = 'Saf B1'; description = 'Safetyist belief one.'; category = 'Beliefs'; parent_id = ''; children = @() }) }
                'skeptic'         = [PSCustomObject]@{ nodes = @([PSCustomObject]@{ id = 'skp-beliefs-001'; label = 'Skp B1'; description = 'Skeptic belief one.'; category = 'Beliefs'; parent_id = ''; children = @() }) }
            }
        }
    }

    It 'reranks top-1 by cross-encoder score, overwriting Score and setting metrics' {
        InModuleScope AITriad {
            # Cross-encoder promotes saf (bi-encoder rank 2) to #1.
            Mock Invoke-RerankScoring {
                @(
                    [PSCustomObject]@{ id = 'saf-beliefs-001'; score = 0.99; raw = 5.0 }
                    [PSCustomObject]@{ id = 'acc-beliefs-001'; score = 0.20; raw = -1.0 }
                    [PSCustomObject]@{ id = 'skp-beliefs-001'; score = 0.10; raw = -2.5 }
                )
            }

            $r = Get-RelevantTaxonomyNodes -Query 'q' -QueryVector ([double[]]@(0.9, 0.1, 0.0)) `
                -CrossEncoderRerank -Format objects 3>$null

            $r[0].Id | Should -Be 'saf-beliefs-001'          # reordered (was acc)
            $r[0].Score | Should -Be 0.99                    # Score overwritten with CE score
            $script:LastRAGMetrics.flags['rerank_applied'] | Should -BeTrue
            $script:LastRAGMetrics.flags['rerank_top1_delta'] | Should -Be 1   # climbed from bi-encoder rank 2
        }
    }

    It 'exposes reranked candidates with retained bi-encoder cosine (t/2288 coupling)' {
        InModuleScope AITriad {
            Mock Invoke-RerankScoring {
                @(
                    [PSCustomObject]@{ id = 'saf-beliefs-001'; score = 0.99; raw = 5.0 }
                    [PSCustomObject]@{ id = 'acc-beliefs-001'; score = 0.20; raw = -1.0 }
                    [PSCustomObject]@{ id = 'skp-beliefs-001'; score = 0.10; raw = -2.5 }
                )
            }

            $null = Get-RelevantTaxonomyNodes -Query 'q' -QueryVector ([double[]]@(0.9, 0.1, 0.0)) `
                -CrossEncoderRerank -Format objects 3>$null

            $exposed = $script:LastCrossEncoderScores
            $exposed | Should -Not -BeNullOrEmpty
            $top = $exposed | Where-Object { $_.Id -eq 'saf-beliefs-001' }
            $top.RerankScore | Should -Be 0.99
            $top.RerankRaw | Should -Be 5.0
            # bi-encoder cosine retained as the diagnostic (≈0.11 for saf), NOT the CE score
            $top.BiEncoderCosine | Should -BeGreaterThan 0.10
            $top.BiEncoderCosine | Should -BeLessThan 0.20
        }
    }

    It 'falls back to bi-encoder ranking when the scorer is unavailable (never throws)' {
        InModuleScope AITriad {
            Mock Invoke-RerankScoring { $null }   # simulate python/model unavailable

            # Direct call: a throw here would fail the test as an error, so a clean
            # return proves the never-throw fallback contract.
            $r = Get-RelevantTaxonomyNodes -Query 'q' -QueryVector ([double[]]@(0.9, 0.1, 0.0)) `
                -CrossEncoderRerank -Format objects 3>$null

            $r[0].Id | Should -Be 'acc-beliefs-001'           # bi-encoder order preserved
            $script:LastRAGMetrics.flags['rerank_applied'] | Should -BeFalse
            $script:LastRAGMetrics.flags['rerank_top1_delta'] | Should -Be 0
        }
    }

    It 'does not invoke the scorer and leaves ranking unchanged when switch is off' {
        InModuleScope AITriad {
            Mock Invoke-RerankScoring { throw 'should not be called' }

            $r = Get-RelevantTaxonomyNodes -Query 'q' -QueryVector ([double[]]@(0.9, 0.1, 0.0)) `
                -Format objects 3>$null

            $r[0].Id | Should -Be 'acc-beliefs-001'
            $script:LastRAGMetrics.flags['rerank_applied'] | Should -BeFalse
            Should -Invoke Invoke-RerankScoring -Times 0 -Exactly
        }
    }
}
