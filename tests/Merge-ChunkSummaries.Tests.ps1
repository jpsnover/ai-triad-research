# Tag: ingestion (t/1186)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Merge-ChunkSummaries resilience to malformed chunk summaries.
.DESCRIPTION
    Regression coverage for the StrictMode crash where a truncated /
    repair-salvaged chunk whose pov_summaries camp lacked a 'key_points'
    property (or whose claims lacked 'claim_label'/'claim') aborted the entire
    document merge with "The property 'key_points' cannot be found on this
    object." A single malformed chunk must degrade gracefully, not throw.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Merge-ChunkSummaries malformed-chunk resilience' -Tag 'ingestion' {

    It 'Does not throw when a chunk camp is missing key_points and still merges valid chunks' {
        InModuleScope AITriad {
            $Good = '{"pov_summaries":{"accelerationist":{"key_points":[{"point":"Automation raises productivity","taxonomy_node_id":"acc-beliefs-001"}]},"safetyist":{"key_points":[]},"skeptic":{"key_points":[]}},"factual_claims":[{"claim_label":"gdp-up","claim":"GDP rose"}],"unmapped_concepts":[{"suggested_label":"new-idea"}]}' | ConvertFrom-Json

            # Truncation-salvaged shapes: camp without key_points, claim with no
            # label/text, concept with no label, and a chunk with no
            # pov_summaries at all.
            $BadCamp   = '{"pov_summaries":{"safetyist":{}},"factual_claims":[{}],"unmapped_concepts":[{}]}' | ConvertFrom-Json
            $BadEmpty  = '{}' | ConvertFrom-Json

            { Merge-ChunkSummaries -ChunkResults @($Good, $BadCamp, $BadEmpty) } |
                Should -Not -Throw

            $Merged = Merge-ChunkSummaries -ChunkResults @($Good, $BadCamp, $BadEmpty)

            @($Merged['pov_summaries']['accelerationist']['key_points']).Count |
                Should -Be 1 -Because 'the one valid key_point must survive the merge'
            @($Merged['factual_claims']).Count |
                Should -BeGreaterThan 0 -Because 'the valid factual claim must survive'
        }
    }
}
