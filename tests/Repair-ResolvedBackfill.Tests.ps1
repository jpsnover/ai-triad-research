# Tag: summary (t/3900)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression tests for Repair-ResolvedBackfill's t/3900 fix: it must never
    write a dead resolved_node_id, and a null-linked backfill entry (same POV +
    same point text) counts as already represented regardless of its current
    taxonomy_node_id.
.DESCRIPTION
    Root cause (Rosetta, t/3900#1; TL-confirmed t/3900#2): a t/3595-style
    cleanup nulls a backfilled key_point's taxonomy_node_id (intentionally
    unlinked) but leaves unmapped_concepts[].resolved_node_id pointing at the
    now-dead id. The old dedupe set only ever added NON-null taxonomy_node_ids,
    so the null-linked entry looked unlinked and backfill re-appended a fresh
    duplicate carrying the dead id, every run.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force
}

Describe 'Repair-ResolvedBackfill (t/3900)' -Tag 'summary' {

    BeforeAll {
        $script:taxDir = Join-Path $TestDrive 'taxonomy'
        $script:summDir = Join-Path $TestDrive 'summaries'
        New-Item -ItemType Directory -Path $script:taxDir -Force | Out-Null
        New-Item -ItemType Directory -Path $script:summDir -Force | Out-Null

        # Live taxonomy: skp-intentions-050 exists; skp-intentions-100 does NOT
        # (it's the dead id from the real incident's dedupe source pointer).
        @{ nodes = @(@{ id = 'skp-intentions-050' }) } | ConvertTo-Json -Depth 5 |
            Set-Content -Path (Join-Path $script:taxDir 'skeptic.json')
        @{ nodes = @() } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $script:taxDir 'accelerationist.json')
        @{ nodes = @() } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $script:taxDir 'safetyist.json')
        @{ nodes = @() } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $script:taxDir 'situations.json')

        Mock Get-TaxonomyDir { $script:taxDir } -ModuleName AITriad
    }

    BeforeEach {
        # Fresh cache per test (Get-TaxonomyNodeIdSet caches by mtime; a fresh
        # module scope per Describe already avoids cross-test bleed, but reset
        # explicitly for clarity/safety across It blocks in this Describe).
        InModuleScope AITriad { $script:TaxonomyNodeIdSet = $null; $script:TaxonomyNodeIdSetTimestamp = [datetime]::MinValue }
    }

    It 'leaves a cleaned summary (null key_point + dead resolved_node_id) BYTE-UNCHANGED -- the real incident shape' {
        $docPath = Join-Path $script:summDir 'incident-doc.json'
        $summary = [ordered]@{
            doc_id = 'incident-doc'
            unmapped_concepts = @(
                [ordered]@{
                    concept             = 'The document cites a notable policy call.'
                    resolved_node_id    = 'skp-intentions-100'   # dead -- removed from taxonomy above
                    suggested_pov       = 'skeptic'
                    suggested_label     = 'Policy Call Citation'
                    suggested_category  = 'Intentions'
                }
            )
            pov_summaries = [ordered]@{
                skeptic = [ordered]@{
                    key_points = @(
                        [ordered]@{
                            stance                = 'aligned'
                            taxonomy_node_id       = $null   # intentionally unlinked by a prior cleanup
                            category               = 'Intentions'
                            point                  = 'The document cites a notable policy call.'
                            verbatim               = $null
                            excerpt_context        = 'unmapped_concept_backfill'
                            extraction_confidence  = 0.7
                            vocabulary_terms       = @()
                        }
                    )
                }
            }
        }
        $summary | ConvertTo-Json -Depth 10 | Set-Content -Path $docPath -Encoding utf8
        $hashBefore = (Get-FileHash -Path $docPath -Algorithm SHA256).Hash

        Mock Get-SummariesDir { $script:summDir } -ModuleName AITriad
        # -DocId scopes this run to just this test's file -- other It blocks in this
        # Describe share $script:summDir and leave their own fixtures behind in it.
        $result = Repair-ResolvedBackfill -DocId 'incident-doc' -Confirm:$false -WarningAction SilentlyContinue

        $hashAfter = (Get-FileHash -Path $docPath -Algorithm SHA256).Hash
        $hashAfter | Should -Be $hashBefore -Because 'a cleaned summary must round-trip through backfill byte-unchanged'
        $result.Statistics.TotalBackfilled | Should -Be 0
        $result.Statistics.FilesModified | Should -Be 0
        @($result.Skipped | Where-Object { $_.Reason -eq 'dead_node_id' }).Count | Should -Be 1
    }

    It 'still appends a genuinely NEW resolved concept with a LIVE id' {
        $docPath = Join-Path $script:summDir 'new-concept-doc.json'
        $summary = [ordered]@{
            doc_id = 'new-concept-doc'
            unmapped_concepts = @(
                [ordered]@{
                    concept             = 'A fresh concept never seen before.'
                    resolved_node_id    = 'skp-intentions-050'   # LIVE
                    suggested_pov       = 'skeptic'
                    suggested_label     = 'Fresh Concept'
                    suggested_category  = 'Intentions'
                }
            )
            pov_summaries = [ordered]@{
                skeptic = [ordered]@{ key_points = @() }
            }
        }
        $summary | ConvertTo-Json -Depth 10 | Set-Content -Path $docPath -Encoding utf8

        Mock Get-SummariesDir { $script:summDir } -ModuleName AITriad
        $result = Repair-ResolvedBackfill -DocId 'new-concept-doc' -Confirm:$false -WarningAction SilentlyContinue

        $result.Statistics.TotalBackfilled | Should -Be 1
        $result.Statistics.FilesModified | Should -Be 1
        $updated = Get-Content -Raw -Path $docPath | ConvertFrom-Json
        $updated.pov_summaries.skeptic.key_points.Count | Should -Be 1
        $updated.pov_summaries.skeptic.key_points[0].taxonomy_node_id | Should -Be 'skp-intentions-050'
    }

    It 'does NOT re-append when a LIVE id''s concept already has a null-linked backfill entry with the same point text (dedupe-by-text, independent of the dead-id skip)' {
        $docPath = Join-Path $script:summDir 'dedupe-by-text-doc.json'
        $summary = [ordered]@{
            doc_id = 'dedupe-by-text-doc'
            unmapped_concepts = @(
                [ordered]@{
                    concept             = 'A concept that was manually unlinked but whose source id is still live.'
                    resolved_node_id    = 'skp-intentions-050'   # LIVE -- proves this is the text-dedupe path, not the dead-id skip
                    suggested_pov       = 'skeptic'
                    suggested_label     = 'Manually Unlinked'
                    suggested_category  = 'Intentions'
                }
            )
            pov_summaries = [ordered]@{
                skeptic = [ordered]@{
                    key_points = @(
                        [ordered]@{
                            stance                = 'aligned'
                            taxonomy_node_id       = $null
                            category               = 'Intentions'
                            point                  = 'A concept that was manually unlinked but whose source id is still live.'
                            verbatim               = $null
                            excerpt_context        = 'unmapped_concept_backfill'
                            extraction_confidence  = 0.7
                            vocabulary_terms       = @()
                        }
                    )
                }
            }
        }
        $summary | ConvertTo-Json -Depth 10 | Set-Content -Path $docPath -Encoding utf8
        $hashBefore = (Get-FileHash -Path $docPath -Algorithm SHA256).Hash

        Mock Get-SummariesDir { $script:summDir } -ModuleName AITriad
        $result = Repair-ResolvedBackfill -DocId 'dedupe-by-text-doc' -Confirm:$false -WarningAction SilentlyContinue

        $hashAfter = (Get-FileHash -Path $docPath -Algorithm SHA256).Hash
        $hashAfter | Should -Be $hashBefore
        $result.Statistics.TotalBackfilled | Should -Be 0
        $result.Statistics.TotalAlreadyLinked | Should -Be 1
    }

    It 'still recognizes the ORIGINAL dedupe (exact taxonomy_node_id match) unchanged' {
        $docPath = Join-Path $script:summDir 'id-match-doc.json'
        $summary = [ordered]@{
            doc_id = 'id-match-doc'
            unmapped_concepts = @(
                [ordered]@{
                    concept             = 'Different text, but the node is already linked some other way.'
                    resolved_node_id    = 'skp-intentions-050'
                    suggested_pov       = 'skeptic'
                    suggested_label     = 'Already Linked Elsewhere'
                    suggested_category  = 'Intentions'
                }
            )
            pov_summaries = [ordered]@{
                skeptic = [ordered]@{
                    key_points = @(
                        [ordered]@{
                            stance                = 'aligned'
                            taxonomy_node_id       = 'skp-intentions-050'
                            category               = 'Intentions'
                            point                  = 'Some other point entirely, written by hand.'
                            verbatim               = 'quoted text'
                            excerpt_context        = 'manual'
                            extraction_confidence  = 0.9
                            vocabulary_terms       = @()
                        }
                    )
                }
            }
        }
        $summary | ConvertTo-Json -Depth 10 | Set-Content -Path $docPath -Encoding utf8
        $hashBefore = (Get-FileHash -Path $docPath -Algorithm SHA256).Hash

        Mock Get-SummariesDir { $script:summDir } -ModuleName AITriad
        $result = Repair-ResolvedBackfill -DocId 'id-match-doc' -Confirm:$false -WarningAction SilentlyContinue

        $hashAfter = (Get-FileHash -Path $docPath -Algorithm SHA256).Hash
        $hashAfter | Should -Be $hashBefore
        $result.Statistics.TotalAlreadyLinked | Should -Be 1
    }
}

Describe 'Repair-ResolvedBackfill (t/3907)' -Tag 'summary' {
    <#
    .SYNOPSIS
        A bare `null` element in unmapped_concepts[] (real-incident shape:
        when-ai-builds-itself-2026 on data main) must not abort the run under
        StrictMode, and the writer that produces it must be fixed to emit []
        instead -- covered by Merge-ChunkSummaries.Tests.ps1 (t/3907) and the
        Invoke-DocumentSummary Finalize-Summary path, not here.
    #>

    BeforeAll {
        $script:taxDir = Join-Path $TestDrive 'taxonomy-3907'
        $script:summDir = Join-Path $TestDrive 'summaries-3907'
        New-Item -ItemType Directory -Path $script:taxDir -Force | Out-Null
        New-Item -ItemType Directory -Path $script:summDir -Force | Out-Null

        @{ nodes = @(@{ id = 'skp-intentions-050' }) } | ConvertTo-Json -Depth 5 |
            Set-Content -Path (Join-Path $script:taxDir 'skeptic.json')
        @{ nodes = @() } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $script:taxDir 'accelerationist.json')
        @{ nodes = @() } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $script:taxDir 'safetyist.json')
        @{ nodes = @() } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $script:taxDir 'situations.json')

        Mock Get-TaxonomyDir { $script:taxDir } -ModuleName AITriad
        Mock Get-SummariesDir { $script:summDir } -ModuleName AITriad
    }

    BeforeEach {
        InModuleScope AITriad { $script:TaxonomyNodeIdSet = $null; $script:TaxonomyNodeIdSetTimestamp = [datetime]::MinValue }
    }

    It 'does not throw on a null unmapped_concepts entry mixed with a real one, skips the null, and still backfills the valid concept' {
        # Non-collapsing shape: ConvertFrom-Json only unwraps a SINGLE-element
        # array to a scalar, so a null alongside a real entry stays an array
        # and reaches the L128 filter -- this is the one shape (1 of the 97
        # on data main) that actually aborts a whole-corpus run.
        $docPath = Join-Path $script:summDir 'null-mixed-doc.json'
        $json = '{"doc_id":"null-mixed-doc","unmapped_concepts":[null,{"concept":"A fresh concept.","resolved_node_id":"skp-intentions-050","suggested_pov":"skeptic","suggested_label":"Fresh Concept","suggested_category":"Intentions"}],"pov_summaries":{"skeptic":{"key_points":[]}}}'
        Set-Content -Path $docPath -Value $json -Encoding utf8

        $result = Repair-ResolvedBackfill -DocId 'null-mixed-doc' -Confirm:$false -WarningAction SilentlyContinue
        $result.Statistics.TotalBackfilled | Should -Be 1
        $updated = Get-Content -Raw -Path $docPath | ConvertFrom-Json
        $updated.pov_summaries.skeptic.key_points[0].taxonomy_node_id | Should -Be 'skp-intentions-050'
    }

    It 'a whole-pattern run still processes a later file after one containing a null unmapped_concepts entry' {
        # Regression for the abort CL reproduced: the null-mixed file sorts
        # before the valid-only file, so a surviving abort would leave
        # 'z-later-doc' unprocessed.
        $nullDocPath = Join-Path $script:summDir 'a-null-mixed-doc.json'
        $nullJson = '{"doc_id":"a-null-mixed-doc","unmapped_concepts":[null,{"concept":"Ignore me.","resolved_node_id":"does-not-matter","suggested_pov":"situations"}],"pov_summaries":{"skeptic":{"key_points":[]}}}'
        Set-Content -Path $nullDocPath -Value $nullJson -Encoding utf8

        $laterDocPath = Join-Path $script:summDir 'z-later-doc.json'
        $laterJson = '{"doc_id":"z-later-doc","unmapped_concepts":[{"concept":"A later concept.","resolved_node_id":"skp-intentions-050","suggested_pov":"skeptic","suggested_label":"Later Concept","suggested_category":"Intentions"}],"pov_summaries":{"skeptic":{"key_points":[]}}}'
        Set-Content -Path $laterDocPath -Value $laterJson -Encoding utf8

        $null = Repair-ResolvedBackfill -DocId '*-doc' -Confirm:$false -WarningAction SilentlyContinue

        $updatedLater = Get-Content -Raw -Path $laterDocPath | ConvertFrom-Json
        $updatedLater.pov_summaries.skeptic.key_points[0].taxonomy_node_id |
            Should -Be 'skp-intentions-050' -Because 'z-later-doc must still be processed, not left behind by an abort on a-null-mixed-doc'
    }
}
