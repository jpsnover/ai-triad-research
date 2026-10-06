# Tag: strictmode (t/4010)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression tests for t/4010 — unguarded dot-access on parsed summary JSON under
    Set-StrictMode -Version Latest.
.DESCRIPTION
    A bare `$Summary.factual_claims` (or `.pov_summaries.<camp>`, `.doc_id`, `.unmapped_concepts`,
    a claim's `.linked_taxonomy_nodes`, a key point's `.taxonomy_node_id`) throws
    PropertyNotFoundException when the key is absent, instead of yielding $null. Each cmdlet below
    is driven with:
      * a LIVE shape — a factual claim with no linked_taxonomy_nodes (an unmapped claim carrying
        potential_taxonomy_nodes instead; one such claim exists in the real corpus and crashed
        Get-TopicFrequency -IncludeFactualClaims before this fix), and/or
      * a key-less summary (parsed fine, but only `model_info`) — the latent shape.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    function script:Write-Json([object]$Obj, [string]$Path) {
        $Obj | ConvertTo-Json -Depth 8 | Set-Content -Path $Path -Encoding utf8NoBOM
    }
}

Describe 'Get-TopicFrequency tolerates absent summary / claim keys (t/4010)' -Tag 'strictmode' {
    BeforeAll {
        $script:TfSum = Join-Path $TestDrive 'tf-summaries'
        New-Item -ItemType Directory -Path $script:TfSum -Force | Out-Null

        # Normal doc: one key point + one mapped claim + one UNMAPPED claim (the live corpus shape).
        Write-Json @{
            doc_id        = 'doc-normal'
            pov_summaries = @{ accelerationist = @{ key_points = @(@{ taxonomy_node_id = 'acc-beliefs-001'; point = 'kp' }) } }
            factual_claims = @(
                @{ claim = 'mapped';   linked_taxonomy_nodes    = @('acc-beliefs-002') }
                @{ claim = 'unmapped'; potential_taxonomy_nodes = @('acc-beliefs-099') }
            )
        } (Join-Path $script:TfSum 'doc-normal.json')

        # Key-less doc: parsed fine, but no doc_id / pov_summaries / factual_claims.
        Write-Json @{ model_info = @{ model = 'm' } } (Join-Path $script:TfSum 'doc-keyless.json')

        # Key point lacking taxonomy_node_id (the code intends to skip it).
        Write-Json @{
            doc_id        = 'doc-kp-nonode'
            pov_summaries = @{ safetyist = @{ key_points = @(@{ point = 'no node id' }) } }
        } (Join-Path $script:TfSum 'doc-kp-nonode.json')
    }

    It 'does not throw with -IncludeFactualClaims, and still counts the mapped claim' {
        InModuleScope AITriad -Parameters @{ SD = $script:TfSum; TD = $TestDrive } {
            param($SD, $TD)
            Mock Get-SummariesDir { $SD }
            Mock Get-TaxonomyDir  { Join-Path $TD 'no-taxonomy' }   # no embeddings.json -> each node its own cluster
            $r = Get-TopicFrequency -NoAI -IncludeFactualClaims -POV accelerationist 6>$null 3>$null
            # Flatten whatever the container shape is and look for the mapped claim's node.
            ($r | ConvertTo-Json -Depth 8) | Should -Match 'acc-beliefs-002'
            ($r | ConvertTo-Json -Depth 8) | Should -Not -Match 'acc-beliefs-099'   # unmapped claim is skipped, not counted
        }
    }

    It 'does not throw without -IncludeFactualClaims (key-less summary + key point without a node id)' {
        InModuleScope AITriad -Parameters @{ SD = $script:TfSum; TD = $TestDrive } {
            param($SD, $TD)
            Mock Get-SummariesDir { $SD }
            Mock Get-TaxonomyDir  { Join-Path $TD 'no-taxonomy' }
            { Get-TopicFrequency -NoAI 6>$null 3>$null } | Should -Not -Throw
        }
    }
}

Describe 'Invoke-QbafConflictAnalysis skips a key-less summary (t/4010)' -Tag 'strictmode' {
    BeforeAll {
        $script:QbFix = Join-Path $TestDrive 'qbaf'
        $script:QbSum = Join-Path $script:QbFix 'summaries'
        New-Item -ItemType Directory -Path $script:QbSum -Force | Out-Null
        # Two real claims: the cmdlet returns early (nothing to compare) when it has fewer than 2.
        Write-Json @{ factual_claims = @(@{ claim = 'Audits should be mandatory.'; claim_label = 'A1'; linked_taxonomy_nodes = @('saf-desires-001'); doc_position = 'supports' }) } (Join-Path $script:QbSum 'docA.json')
        Write-Json @{ factual_claims = @(@{ claim = 'Audits slow deployment without safety gains.'; claim_label = 'B1'; linked_taxonomy_nodes = @('saf-desires-001'); doc_position = 'disputes' }) } (Join-Path $script:QbSum 'docB.json')
        Write-Json @{ model_info = @{ model = 'm' } } (Join-Path $script:QbSum 'doc-keyless.json')
    }

    It 'does not throw and counts only the real claims' {
        InModuleScope AITriad -Parameters @{ SD = $script:QbSum; FD = $script:QbFix } {
            param($SD, $FD)
            Mock Get-SummariesDir  { $SD }
            Mock Get-DataRoot      { $FD }
            Mock Get-TextEmbedding { $null }
            $r = Invoke-QbafConflictAnalysis -DryRun -PassThru 6>$null 3>$null
            $r.ClaimCount | Should -Be 2
        }
    }
}

Describe 'Test-ExtractionQuality tolerates a key-less summary (t/4010)' -Tag 'strictmode' {
    BeforeAll {
        $script:TqGold = Join-Path $TestDrive 'gold'
        $script:TqSum  = Join-Path $TestDrive 'tq-summaries'
        New-Item -ItemType Directory -Path $script:TqGold, $script:TqSum -Force | Out-Null
        # A complete gold file per tests/gold-standard/_template.gold.json (all six keys).
        Write-Json @{
            doc_id                     = 'doc-keyless'
            annotated_by               = 'test'
            annotated_at               = '2026-10-06'
            expected_key_points        = @(@{ taxonomy_node_id = 'acc-beliefs-001' })
            expected_factual_claims    = @(@{ linked_taxonomy_nodes = @('acc-beliefs-002') })
            expected_unmapped_concepts = @()
        } (Join-Path $script:TqGold 'doc-keyless.gold.json')
        Write-Json @{ model_info = @{ model = 'm' } } (Join-Path $script:TqSum 'doc-keyless.json')
    }

    It 'scores the doc as 0% recall instead of throwing' {
        InModuleScope AITriad -Parameters @{ SD = $script:TqSum; GD = $script:TqGold } {
            param($SD, $GD)
            Mock Get-SummariesDir { $SD }
            $r = @(Test-ExtractionQuality -GoldDir $GD -DocId 'doc-keyless' -PassThru 6>$null 3>$null)
            $row = $r | Where-Object { $_.PSObject.Properties['DocId'] -and $_.DocId -eq 'doc-keyless' } | Select-Object -First 1
            $row             | Should -Not -BeNullOrEmpty
            $row.KPRecall    | Should -Be 0
            $row.ClaimRecall | Should -Be 0
        }
    }
}

Describe 'Update-AITSourceIndex fallback counts what a summary DOES have (t/4010)' -Tag 'strictmode' {
    BeforeAll {
        $script:UiSrc = Join-Path $TestDrive 'ui-sources'
        $script:UiSum = Join-Path $TestDrive 'ui-summaries'
        New-Item -ItemType Directory -Path (Join-Path $script:UiSrc 'doc-nofc'), $script:UiSum -Force | Out-Null
        # metadata WITHOUT total_claims -> forces the summary-file fallback
        Write-Json @{
            id = 'doc-nofc'; title = 'No FC'; date_published = '2026-01-01'; date_ingested = '2026-01-02'
            source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'current'
        } (Join-Path $script:UiSrc 'doc-nofc' 'metadata.json')
        # Summary that parsed fine and HAS key points + unmapped concepts, but no factual_claims.
        Write-Json @{
            pov_summaries     = @{ accelerationist = @{ key_points = @(@{ point = 'a' }, @{ point = 'b' }) } }
            unmapped_concepts = @(@{ concept = 'x' })
        } (Join-Path $script:UiSum 'doc-nofc.json')
    }

    It 'records total_facts and unmapped_concepts instead of silently zeroing them' {
        InModuleScope AITriad -Parameters @{ SourcesDir = $script:UiSrc; SummariesDir = $script:UiSum } {
            param($SourcesDir, $SummariesDir)
            Mock Get-SourcesDir   { $SourcesDir }
            Mock Get-SummariesDir { $SummariesDir }
            Update-AITSourceIndex -Quiet
            $Entry = (Get-Content -Raw (Join-Path $SourcesDir '_index.json') | ConvertFrom-Json).sources |
                Where-Object { $_.id -eq 'doc-nofc' }
            $Entry.total_claims      | Should -Be 0
            $Entry.total_facts       | Should -Be 2
            $Entry.unmapped_concepts | Should -Be 1
        }
    }
}
