# Tag: config (t/3596)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Build-NodeSourceIndex — derived belief-node→source sidecar (t/3596).
    Covers the SO-cleared conditions (e/192): byte-determinism + no timestamp,
    ordinal sort, 4-tuple dedup with max-confidence survivor, all-live-nodes with
    empty arrays, self-describing header, dead-link skip.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force

    # ── Build an isolated fixture data tree (no real corpus touched) ────────────
    $script:Fx = Join-Path ([System.IO.Path]::GetTempPath()) ("bnsi-" + [guid]::NewGuid().ToString('N'))
    $script:TaxDir = Join-Path $Fx 'taxonomy'
    $script:SumDir = Join-Path $Fx 'summaries'
    New-Item -ItemType Directory -Force -Path $script:TaxDir, $script:SumDir | Out-Null

    function script:WriteJson($path, $obj) {
        Set-Content -LiteralPath $path -Value ($obj | ConvertTo-Json -Depth 10) -Encoding utf8NoBOM
    }

    # 4 live belief nodes across two POV files; skeptic file present but empty-ish.
    script:WriteJson (Join-Path $script:TaxDir 'safetyist.json') @{
        pov = 'saf'; nodes = @(
            @{ id = 'saf-beliefs-201' }, @{ id = 'saf-beliefs-206' }, @{ id = 'saf-intentions-201' }
        )
    }
    script:WriteJson (Join-Path $script:TaxDir 'accelerationist.json') @{
        pov = 'acc'; nodes = @( @{ id = 'acc-beliefs-010' } )   # a live node with NO links → empty []
    }
    script:WriteJson (Join-Path $script:TaxDir 'skeptic.json') @{ pov = 'skp'; nodes = @() }

    # Summary 1: key_points (some dead links + a dedup collision) + factual_claims.
    script:WriteJson (Join-Path $script:SumDir 'doc-alpha.json') @{
        doc_id = 'src-alpha'
        pov_summaries = @{
            saf = @{ key_points = @(
                @{ taxonomy_node_id = 'saf-beliefs-201'; verbatim = 'Q-one'; extraction_confidence = 0.7 }
                @{ taxonomy_node_id = 'saf-beliefs-201'; verbatim = 'Q-one'; extraction_confidence = 0.9 } # dedup collision → keep 0.9
                @{ taxonomy_node_id = 'saf-dead-999';    verbatim = 'ignored'; extraction_confidence = 0.5 } # dead → skipped
                @{ taxonomy_node_id = 'saf-beliefs-206'; verbatim = 'Q-two'; extraction_confidence = 0.6 }
            ) }
        }
        factual_claims = @(
            @{ claim = 'Claim-A'; doc_position = 'supports'; evidence_criteria = 'strong'; extraction_confidence = 0.8; linked_taxonomy_nodes = @('saf-intentions-201', 'saf-dead-000') }
            @{ claim = 'Claim-A'; doc_position = 'contests'; evidence_criteria = 'weak';   extraction_confidence = 0.4; linked_taxonomy_nodes = @('saf-intentions-201') } # same claim/quote/source but different doc_position → NOT deduped
        )
    }

    $script:Out = Join-Path $Fx 'source_index.json'
    $script:Ix  = Build-NodeSourceIndex -SummariesDir $script:SumDir -TaxonomyDir $script:TaxDir -OutputPath $script:Out -PassThru
}

AfterAll {
    if ($script:Fx -and (Test-Path $script:Fx)) { Remove-Item -Recurse -Force $script:Fx -ErrorAction SilentlyContinue }
}

Describe 'Build-NodeSourceIndex (t/3596)' -Tag 'config' {

    It 'is exported and callable' {
        Get-Command Build-NodeSourceIndex -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
    }

    It 'emits a self-describing header (schemaVersion, builder, inputHash, totals) — SO cond 1' {
        $script:Ix.schemaVersion  | Should -Be 1
        $script:Ix.builder        | Should -Be 'Build-NodeSourceIndex'
        $script:Ix.builderVersion | Should -Not -BeNullOrEmpty
        $script:Ix.inputHash      | Should -Match '^[0-9a-f]{64}$'
        $script:Ix.totals.nodes   | Should -Be 4
    }

    It 'includes ALL live nodes, zero-source nodes as empty arrays — SO cond 4' {
        $keys = @($script:Ix.index.PSObject.Properties.Name)
        $keys.Count | Should -Be 4                          # == live node count
        $keys | Should -Contain 'acc-beliefs-010'
        @($script:Ix.index.'acc-beliefs-010').Count | Should -Be 0   # explicit empty []
    }

    It 'skips dead (non-live) links' {
        # saf-dead-999 / saf-dead-000 must appear nowhere
        ($script:Ix | ConvertTo-Json -Depth 8) | Should -Not -Match 'saf-dead-'
    }

    It 'dedups the 4-tuple keeping max extraction_confidence — SO cond 2' {
        $e = @($script:Ix.index.'saf-beliefs-201')
        $e.Count | Should -Be 1                              # the 0.7/0.9 collision collapsed
        $e[0].extraction_confidence | Should -Be 0.9         # survivor = max
        $e[0].link_source | Should -Be 'key_point'
        $e[0].quote | Should -Be 'Q-one'
    }

    It 'does NOT dedup entries that differ only by doc_position (semantically distinct)' {
        $e = @($script:Ix.index.'saf-intentions-201')
        $e.Count | Should -Be 2
        @($e.doc_position | Sort-Object) | Should -Be @('contests', 'supports')
        $e | ForEach-Object { $_.link_source | Should -Be 'factual_claim'; $_.quote | Should -Be 'Claim-A' }
    }

    It 'maps key_point vs factual_claim fields correctly' {
        $kp = @($script:Ix.index.'saf-beliefs-206')[0]
        $kp.link_source | Should -Be 'key_point'
        $kp.quote | Should -Be 'Q-two'
        $kp.doc_position | Should -BeNullOrEmpty
        $kp.evidence_level | Should -BeNullOrEmpty
        $fc = @($script:Ix.index.'saf-intentions-201')[0]
        $fc.evidence_level | Should -Not -BeNullOrEmpty      # from evidence_criteria
    }

    It 'totals reconcile with the emitted entries' {
        $entryCount = 0
        foreach ($p in $script:Ix.index.PSObject.Properties) { $entryCount += @($p.Value).Count }
        $script:Ix.totals.entries | Should -Be $entryCount
    }

    It 'byLinkSource is counted POST-dedup and sums to entries (t/3596#8 regression)' {
        # The bug: byLinkSource counted raw pre-dedup links, so its sum exceeded totals.entries.
        # The fixture has a dedup collision + a doc_position-distinct pair, so pre-dedup != post-dedup.
        $kp = $script:Ix.totals.byLinkSource.key_point
        $fc = $script:Ix.totals.byLinkSource.factual_claim
        ($kp + $fc) | Should -Be $script:Ix.totals.entries
        # cross-check against the actual emitted entries by link_source
        $actualKp = 0; $actualFc = 0
        foreach ($p in $script:Ix.index.PSObject.Properties) {
            foreach ($e in @($p.Value)) { if ($e.link_source -eq 'key_point') { $actualKp++ } else { $actualFc++ } }
        }
        $kp | Should -Be $actualKp
        $fc | Should -Be $actualFc
    }

    It 'writes byte-identical output on re-run — SO cond 1/3 (determinism)' {
        $first = [System.IO.File]::ReadAllBytes($script:Out)
        $out2 = Join-Path $script:Fx 'source_index_2.json'
        Build-NodeSourceIndex -SummariesDir $script:SumDir -TaxonomyDir $script:TaxDir -OutputPath $out2 | Out-Null
        $second = [System.IO.File]::ReadAllBytes($out2)
        [System.Convert]::ToBase64String($second) | Should -Be ([System.Convert]::ToBase64String($first))
    }

    It 'contains NO wall-clock timestamp — SO cond 1' {
        $text = Get-Content -Raw -LiteralPath $script:Out
        $text | Should -Not -Match '(?i)generated_at|generatedAt|"timestamp"|"date"'
        $text | Should -Not -Match '20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}'   # no ISO datetime
    }

    It '-WhatIf writes no file' {
        $wf = Join-Path $script:Fx 'whatif.json'
        Build-NodeSourceIndex -SummariesDir $script:SumDir -TaxonomyDir $script:TaxDir -OutputPath $wf -WhatIf | Out-Null
        Test-Path $wf | Should -BeFalse
    }

    It 'throws an ActionableError when the summaries dir is missing' {
        { Build-NodeSourceIndex -SummariesDir (Join-Path $script:Fx 'nope') -TaxonomyDir $script:TaxDir -OutputPath (Join-Path $script:Fx 'x.json') } |
            Should -Throw -ExpectedMessage '*Summaries directory not found*'
    }
}
