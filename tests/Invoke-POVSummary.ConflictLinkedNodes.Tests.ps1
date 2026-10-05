# Tag: conflict (t/3948)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    End-to-end regression test for t/3948: Invoke-POVSummary wrote
    linked_taxonomy_nodes as a doubly-nested array into new conflict files.
.DESCRIPTION
    Introduced in 7e4ea544 (the PS 5.1 rewrite):
    `$linkedNodes = ,@($claim.linked_taxonomy_nodes)`. The unary comma on a
    plain ASSIGNMENT (not a `return`) wraps the array in another array
    instead of protecting it from unrolling, so a conflict file with exactly
    one linked node serialized as linked_taxonomy_nodes: [["id"]] instead of
    ["id"]. This drives the pipeline end-to-end through Invoke-POVSummary
    (mocking only the AI extraction step and dir resolvers) and asserts on
    the actual written conflict JSON -- not on a copy of the logic -- so it
    fails if the old `,@(...)` line is restored.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue
    Import-Module "$PSScriptRoot/../scripts/AIEnrich.psm1" -Force -WarningAction SilentlyContinue
}

Describe 'Invoke-POVSummary -- conflict linked_taxonomy_nodes shape' -Tag 'conflict' {

    BeforeEach {
        $script:root        = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        $script:sourcesDir   = Join-Path $root 'sources'
        $script:summariesDir = Join-Path $root 'summaries'
        $script:conflictsDir = Join-Path $root 'conflicts'
        $script:taxonomyDir  = Join-Path $root 'taxonomy'
        $script:docDir       = Join-Path $sourcesDir 'doc-1'
        New-Item -ItemType Directory -Path $sourcesDir, $summariesDir, $conflictsDir, $taxonomyDir, $docDir -Force | Out-Null

        Set-Content -Path (Join-Path $docDir 'snapshot.md') -Value "# Doc`n`nSome content." -Encoding utf8
        $metadata = [ordered]@{ title = 'Doc 1'; pov_tags = @('accelerationist'); summary_status = 'pending' }
        Set-Content -Path (Join-Path $docDir 'metadata.json') -Value ($metadata | ConvertTo-Json -Depth 10) -Encoding utf8

        $versionFile = Join-Path $root 'TAXONOMY_VERSION'
        Set-Content -Path $versionFile -Value '1.0.0' -Encoding utf8

        Mock Get-SourcesDir    -ModuleName AITriad { $script:sourcesDir }
        Mock Get-SummariesDir  -ModuleName AITriad { $script:summariesDir }
        Mock Get-ConflictsDir  -ModuleName AITriad { $script:conflictsDir }
        Mock Get-TaxonomyDir   -ModuleName AITriad { $script:taxonomyDir }
        Mock Get-VersionFile   -ModuleName AITriad { $versionFile }
        Mock Resolve-AIApiKey  -ModuleName AITriad { 'fake-key' }
        Mock Get-Prompt        -ModuleName AITriad { 'prompt text' }

        # Single factual claim with exactly ONE linked taxonomy node and no
        # potential_conflict_id -- the "create new conflict file" branch,
        # which is where t/3948 serialized the doubly-nested array.
        $script:fakeSummary = [PSCustomObject]@{
            pov_summaries      = [PSCustomObject]@{
                accelerationist = [PSCustomObject]@{ key_points = @() }
                safetyist       = [PSCustomObject]@{ key_points = @() }
                skeptic         = [PSCustomObject]@{ key_points = @() }
            }
            factual_claims     = @(
                [PSCustomObject]@{
                    claim                   = 'The model was trained on 10T tokens.'
                    claim_label             = 'training-scale'
                    doc_position            = 'supports'
                    potential_conflict_id   = $null
                    linked_taxonomy_nodes   = @('acc-ethics-004')
                }
            )
            unmapped_concepts  = @()
        }

        Mock Invoke-SummaryPipeline -ModuleName AITriad {
            [PSCustomObject]@{
                Success          = $true
                Summary          = $script:fakeSummary
                FactualCount     = 1
                UnmappedCount    = 0
                TaxonomyJson     = '{}'
                FireStats        = $null
                UsedFire         = $false
                ElapsedSeconds   = 1
                Backend          = 'gemini'
            }
        }
    }

    It 'writes a NEW conflict file with linked_taxonomy_nodes as a flat array, not [["id"]]' {
        Invoke-POVSummary -DocId 'doc-1' -RepoRoot $root -Model 'gemini-3.5-flash-lite' -WarningAction SilentlyContinue | Out-Null

        $conflictFiles = @(Get-ChildItem -Path $conflictsDir -Filter '*.json')
        $conflictFiles.Count | Should -Be 1 -Because 'exactly one factual claim with no potential_conflict_id should create exactly one new conflict file'

        # The raw text is the ground truth: [["acc-ethics-004"]] (bug) vs
        # ["acc-ethics-004"] (fixed). Parsed-object comparisons are not safe
        # here -- PowerShell's -eq/-Be on an array-vs-scalar RHS can return a
        # non-empty filtered array that still reads as truthy, masking a
        # nested-array regression (caught empirically running this test
        # against the unfixed code).
        $rawJson = (Get-Content $conflictFiles[0].FullName -Raw).Trim()
        $rawJson | Should -Match '"linked_taxonomy_nodes"\s*:\s*\[\s*"acc-ethics-004"\s*\]' `
            -Because 'the t/3948 bug nested it one level deeper: [["acc-ethics-004"]] instead of ["acc-ethics-004"]'
        $rawJson | Should -Not -Match '"linked_taxonomy_nodes"\s*:\s*\[\s*\['

        $conflictData = Get-Content $conflictFiles[0].FullName -Raw | ConvertFrom-Json -AsHashtable
        $linked = $conflictData['linked_taxonomy_nodes']
        @($linked).Count | Should -Be 1
        $linked[0] | Should -BeOfType [string] -Because 'the t/3948 bug made element 0 itself an array, not the id string'
        $linked[0] | Should -Be 'acc-ethics-004'
    }

    It 'merges linked_taxonomy_nodes flat when APPENDING to an existing conflict file (lines 521-524)' {
        # Seed an existing conflict with one linked node already attached.
        $existingConflict = [ordered]@{
            claim_id              = 'conflict-existing-001'
            claim_label           = 'existing-claim'
            description            = 'An existing conflict.'
            status                 = 'open'
            linked_taxonomy_nodes  = @('acc-ethics-001')
            instances              = @()
            human_notes            = @()
        }
        $existingPath = Join-Path $conflictsDir 'conflict-existing-001.json'
        Set-Content -Path $existingPath -Value ($existingConflict | ConvertTo-Json -Depth 10) -Encoding utf8

        # Claim hints at the existing conflict and links a DIFFERENT node --
        # drives the "append to existing conflict" branch (lines 511-528),
        # which does `$existing + $linkedNodes`. Under the t/3948 bug,
        # $linkedNodes was a 1-element array wrapping a nested array, so `+`
        # appended that nested array as a single element instead of merging
        # the id in flat.
        $script:fakeSummary.factual_claims = @(
            [PSCustomObject]@{
                claim                   = 'A second claim about the same conflict.'
                claim_label             = 'second-claim'
                doc_position            = 'disputes'
                potential_conflict_id   = 'conflict-existing-001'
                linked_taxonomy_nodes   = @('acc-ethics-004')
            }
        )

        Invoke-POVSummary -DocId 'doc-1' -RepoRoot $root -Model 'gemini-3.5-flash-lite' -WarningAction SilentlyContinue | Out-Null

        $rawJson = (Get-Content $existingPath -Raw).Trim()
        $rawJson | Should -Not -Match '"linked_taxonomy_nodes"\s*:\s*\[[^\]]*\[' `
            -Because 'the t/3948 bug appended the nested array as a single element instead of merging ids flat'

        $conflictData = Get-Content $existingPath -Raw | ConvertFrom-Json -AsHashtable
        $linked = @($conflictData['linked_taxonomy_nodes'])
        $linked.Count | Should -Be 2 -Because 'acc-ethics-001 (pre-existing) + acc-ethics-004 (new) merged flat'
        foreach ($n in $linked) { $n | Should -BeOfType [string] }
        $linked | Should -Contain 'acc-ethics-001'
        $linked | Should -Contain 'acc-ethics-004'
    }
}
