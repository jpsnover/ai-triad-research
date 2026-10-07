# Tag: unit (t/4075)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    t/4075: advisory existing-entity candidates (TL ruling p/360#571, SO e/280#2, TL e/280#3).
.DESCRIPTION
    Name-only cosine cannot tell a duplicate from a distinct sibling, so Invoke-EntityExtraction never
    links on it: each new proposal is minted, and its nearest existing entities are written to the
    sidecar's existing_entity_candidates[] for a human to review with Get-EntityExtractionCandidates.

    The real-pair cases use name vectors copied from the data repo (tests/fixtures/entity-candidates/
    real-vectors.json, 8 entities), so the similarities are the real ones:
      Claude 3.5 Sonnet vs Claude 3.7 Sonnet 0.9869, GPT-4 vs GPT-5 0.8795,
      the NCI calculator duplicate pair 0.9910, Claude 4 Opus vs Claude 4 0.8426.
    AI calls are mocked; Get-TextEmbedding returns the stored real vector for each proposal name.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
    $script:Real = Get-Content -Raw (Join-Path $PSScriptRoot 'fixtures' 'entity-candidates' 'real-vectors.json') | ConvertFrom-Json
    function script:RealVec([string]$Id) { ,[double[]]@($script:Real.vectors.$Id.name_vector) }

    # One Invoke-EntityExtraction run: $Existing (name -> vector) is the approved store, $Proposal is
    # the one new name proposed for node-1, $ProbeVec is the vector the embedder returns for it.
    # Returns @{ Result; Log }.
    function script:Invoke-CandidateRun([System.Collections.Specialized.OrderedDictionary]$Existing, [string]$Proposal, [double[]]$ProbeVec) {
        $dir = Join-Path $TestDrive "cand-$(Get-Random)"
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        $tax = Join-Path $dir 'tax'; New-Item -ItemType Directory -Path $tax -Force | Out-Null
        $paths = @{
            Ent = Join-Path $dir 'entities.json'; Emb = Join-Path $dir 'entity_embeddings.json'
            Log = Join-Path $dir 'entity_extraction_log.json'; Sei = Join-Path $dir 'sei.json'; Tax = $tax; Root = $dir
        }
        (@{ 'node-1' = @{ facts = @(@{ claim = 'A claim.'; doc_id = 'doc-1' }) } } | ConvertTo-Json -Depth 6) |
            Set-Content -Path $paths.Sei -Encoding utf8NoBOM

        # Plain arrays: an OrderedDictionary passed through InModuleScope -Parameters loses int indexing.
        $names = [string[]]@($Existing.Keys)
        $vecs = [object[]]@($Existing.Values)
        InModuleScope AITriad -Parameters @{ P = $paths; Names = $names; Vecs = $vecs; Proposal = $Proposal; ProbeVec = $ProbeVec } {
            param($P, $Names, $Vecs, $Proposal, $ProbeVec)
            $vectors = [ordered]@{}
            if (@($Names).Count -gt 0) {
                $seed = @($Names | ForEach-Object { @{ name = $_; entity_type = 'artifact'; dolce_category = 'non-agentive-functional-artifact'; status = 'approved'; description = "The $_ entity." } })
                $minted = @(Import-Entity -Proposal $seed -Path $P.Ent -SkipEmbedding -Confirm:$false)
                for ($i = 0; $i -lt $minted.Count; $i++) { $vectors[$minted[$i].Id] = [ordered]@{ name_vector = @($Vecs[$i]) } }
            }
            ([ordered]@{ _schema_version = '2.0.0'; model = 'all-MiniLM-L6-v2'; dim = 384; vectors = $vectors } | ConvertTo-Json -Depth 6) |
                Set-Content -Path $P.Emb -Encoding utf8NoBOM

            Mock Get-UsageRegistry { [PSCustomObject]@{ 'enrichment.entity-extraction' = @{} } }
            Mock Get-TaxonomyDir ({ $P.Tax }.GetNewClosure())
            Mock Get-DataRoot ({ $P.Root }.GetNewClosure())
            Mock Assert-DataWriteAllowed { }
            Mock Invoke-AIByUsage ({
                [PSCustomObject]@{ Model = 'stub'; Text = '{"proposals":[{"name":"' + $Proposal + '","entity_type":"artifact","aliases":[],"quote":"q","confidence":0.9}],"org_mentions":[]}' }
            }.GetNewClosure())
            # No closure here: a GetNewClosure() mock body cannot see the mocked call's bound $Ids.
            $script:T4075Probe = $ProbeVec
            Mock Get-TextEmbedding { $o = @{}; foreach ($id in @($Ids)) { $o[[string]$id] = $script:T4075Probe }; $o }

            $w = $null
            $r = Invoke-EntityExtraction -NodeId 'node-1' -Concurrency 1 -EntitiesPath $P.Ent -EmbeddingsPath $P.Emb `
                -SourceEvidenceIndexPath $P.Sei -OutputPath $P.Log -Confirm:$false -WarningVariable w -WarningAction SilentlyContinue 6> $null
            @{ Result = $r; Log = (Get-Content -Raw $P.Log | ConvertFrom-Json); LogPath = $P.Log; Warnings = @($w | ForEach-Object { [string]$_ }) }
        }
    }
}

Describe 'Test-EntityVersionSibling (t/4075, SO e/280#2 condition 1)' -Tag 'unit' {
    It '<A> vs <B> -> <Expected>' -ForEach @(
        @{ A = 'Claude 3.5 Sonnet'; B = 'Claude 3.7 Sonnet'; Expected = $true }
        @{ A = 'GPT-4'; B = 'GPT-5'; Expected = $true }
        @{ A = 'GPT-4.1'; B = 'GPT-4.5'; Expected = $true }
        @{ A = 'Article 3 of the CDSM Directive'; B = 'Article 4 of the CDSM Directive'; Expected = $true }
        @{ A = 'Title VI'; B = 'Title VII'; Expected = $true }
        @{ A = 'Gemini v2 Flash'; B = 'Gemini v3 Flash'; Expected = $true }
        @{ A = 'Model 70b'; B = 'Model 8b'; Expected = $true }
        # Tier and variant siblings are NOT detected: false means "no version difference", not "same".
        @{ A = 'Claude Sonnet 4'; B = 'Claude Opus 4'; Expected = $false }
        @{ A = 'gpt-4o'; B = 'gpt-4o-mini'; Expected = $false }
        @{ A = 'Claude 4 Opus'; B = 'Claude 4'; Expected = $false }
        @{ A = 'National Cancer Institute Rectal Cancer Survival Calculator'; B = "National Cancer Institute's Rectal Cancer Survival Calculator"; Expected = $false }
        @{ A = 'AI Action Plan'; B = 'AI Action Plan'; Expected = $false }
        @{ A = '4'; B = '5'; Expected = $false }
        @{ A = 'Civil Rights Act'; B = 'Civil Liberties Act'; Expected = $false }
    ) {
        InModuleScope AITriad -Parameters @{ A = $A; B = $B } { param($A, $B) Test-EntityVersionSibling -A $A -B $B } | Should -Be $Expected
    }
}

Describe 'Select-EntityCandidateRanking (t/4075, SO e/280#2 condition 2)' -Tag 'unit' {
    It 'lists up to K non-siblings, keeps every version sibling flagged, and ranks by similarity' {
        $ranked = InModuleScope AITriad {
            $scored = @(
                [pscustomobject]@{ EntityId = 'ent-s1'; EntityName = 'X 2'; Similarity = 0.99; VersionSibling = $true }
                [pscustomobject]@{ EntityId = 'ent-s2'; EntityName = 'X 3'; Similarity = 0.98; VersionSibling = $true }
                [pscustomobject]@{ EntityId = 'ent-s3'; EntityName = 'X 4'; Similarity = 0.97; VersionSibling = $true }
                [pscustomobject]@{ EntityId = 'ent-dup'; EntityName = 'X'; Similarity = 0.95; VersionSibling = $false }
                [pscustomobject]@{ EntityId = 'ent-n2'; EntityName = 'Y'; Similarity = 0.80; VersionSibling = $false }
                [pscustomobject]@{ EntityId = 'ent-n3'; EntityName = 'Z'; Similarity = 0.70; VersionSibling = $false }
                [pscustomobject]@{ EntityId = 'ent-n4'; EntityName = 'W'; Similarity = 0.65; VersionSibling = $false }
            )
            Select-EntityCandidateRanking -Scored $scored -K 3
        }
        @($ranked).EntityId | Should -Be @('ent-s1', 'ent-s2', 'ent-s3', 'ent-dup', 'ent-n2', 'ent-n3')
        @($ranked | ForEach-Object { $_.Rank }) | Should -Be @(1, 2, 3, 4, 5, 6)
        # The arm the condition exists for: a plain top-3 would have shown the reviewer only siblings.
        @($ranked | Select-Object -First 3).EntityId | Should -Not -Contain 'ent-dup'
    }
}

Describe 'Invoke-EntityExtraction existing-entity candidates on real vectors (t/4075)' -Tag 'unit' {

    It 'Claude 3.7 Sonnet vs existing Claude 3.5 Sonnet (0.9869): minted, never linked, flagged version_sibling' {
        $existing = [ordered]@{ 'Claude 3.5 Sonnet' = (script:RealVec 'ent-149') }
        $run = script:Invoke-CandidateRun -Existing $existing -Proposal 'Claude 3.7 Sonnet' -ProbeVec (script:RealVec 'ent-176')
        $run.Result.Minted | Should -Be 1
        $run.Result.Linked | Should -Be 0
        $c = @($run.Result.ExistingEntityCandidates)
        $c.Count | Should -Be 1
        $c[0].entity_name | Should -Be 'Claude 3.5 Sonnet'
        $c[0].similarity | Should -Be 0.9869
        $c[0].version_sibling | Should -BeTrue
    }

    It 'GPT-5 vs existing GPT-4 (0.8795): minted, never linked, flagged version_sibling' {
        $existing = [ordered]@{ 'GPT-4' = (script:RealVec 'ent-014') }
        $run = script:Invoke-CandidateRun -Existing $existing -Proposal 'GPT-5' -ProbeVec (script:RealVec 'ent-081')
        $run.Result.Minted | Should -Be 1
        $run.Result.Linked | Should -Be 0
        $c = @($run.Result.ExistingEntityCandidates)
        $c[0].entity_name | Should -Be 'GPT-4'
        $c[0].similarity | Should -Be 0.8795
        $c[0].version_sibling | Should -BeTrue
    }

    It 'a tier/variant pair (Claude Sonnet 4 vs Claude 4 Opus, real 0.8426) is version_sibling FALSE and still not linked' {
        # The probe is Claude 4's real vector (ent-339), proposed under the name 'Claude Sonnet 4': the store
        # has no Sonnet 4 vector. The documented limitation: false means no version difference, not "same".
        $existing = [ordered]@{ 'Claude 4 Opus' = (script:RealVec 'ent-204') }
        $run = script:Invoke-CandidateRun -Existing $existing -Proposal 'Claude Sonnet 4' -ProbeVec (script:RealVec 'ent-339')
        $run.Result.Minted | Should -Be 1
        $run.Result.Linked | Should -Be 0
        $c = @($run.Result.ExistingEntityCandidates)
        $c[0].entity_name | Should -Be 'Claude 4 Opus'
        $c[0].similarity | Should -Be 0.8426
        $c[0].version_sibling | Should -BeFalse
    }

    It 'the NCI-calculator true duplicate (0.9910) is still listed when version siblings would crowd it out' {
        # Three version siblings of the proposal's name score 1.0 (they carry the probe's own vector), above
        # the true duplicate. With a plain top-3 the duplicate would drop out of the list the reviewer sees.
        $probe = script:RealVec 'ent-452'
        $name = 'National Cancer Institute Rectal Cancer Survival Calculator'
        $existing = [ordered]@{
            "$name 2" = $probe; "$name 3" = $probe; "$name 4" = $probe
            "National Cancer Institute's Rectal Cancer Survival Calculator" = (script:RealVec 'ent-186')
        }
        $run = script:Invoke-CandidateRun -Existing $existing -Proposal $name -ProbeVec $probe
        $run.Result.Linked | Should -Be 0
        $c = @($run.Result.ExistingEntityCandidates)
        $c.Count | Should -Be 4
        @($c | Where-Object version_sibling).Count | Should -Be 3
        $dup = @($c | Where-Object { -not $_.version_sibling })
        $dup.Count | Should -Be 1
        $dup[0].entity_name | Should -Be "National Cancer Institute's Rectal Cancer Survival Calculator"
        $dup[0].similarity | Should -Be 0.991
        $dup[0].rank | Should -Be 4
    }

    It 'persists existing_entity_candidates[] with embedding_model under log schema 1.3.0, leaving possible_duplicates[] as it was' {
        $existing = [ordered]@{ 'GPT-4' = (script:RealVec 'ent-014') }
        $run = script:Invoke-CandidateRun -Existing $existing -Proposal 'GPT-5' -ProbeVec (script:RealVec 'ent-081')
        $run.Log._schema_version | Should -Be '1.3.0'
        $node = @($run.Log.nodes | Where-Object node_id -eq 'node-1')[0]
        $node.embedding_model | Should -Be 'all-MiniLM-L6-v2'
        @($node.possible_duplicates).Count | Should -Be 0
        $row = @($node.existing_entity_candidates)[0]
        @($row.PSObject.Properties.Name) | Should -Be @('candidate_id', 'proposal_name', 'entity_id', 'entity_name', 'similarity', 'rank', 'version_sibling')
        $row.candidate_id | Should -Be @($run.Result.MintedEntities)[0].id
    }

    It 'WARNs when the stage finds nothing at or above the floor (never silent, TL p/360#571)' {
        $existing = [ordered]@{ 'GPT-4' = (script:RealVec 'ent-014') }
        $orth = [double[]]::new(384); $orth[0] = 1.0
        $run = script:Invoke-CandidateRun -Existing $existing -Proposal 'Boeing 737 MAX' -ProbeVec $orth
        @($run.Result.ExistingEntityCandidates).Count | Should -Be 0
        $run.Result.Minted | Should -Be 1
        @($run.Warnings | Where-Object { $_ -match 'existing-entity candidate stage found no candidate at or above 0\.6 for 1 minted proposal' }).Count | Should -Be 1
    }

    It 'WARNs when the stage is skipped because the store has no vectors' {
        $run = script:Invoke-CandidateRun -Existing ([ordered]@{}) -Proposal 'GPT-5' -ProbeVec (script:RealVec 'ent-081')
        @($run.Warnings | Where-Object { $_ -match 'existing-entity candidate stage skipped \(entity_embeddings\.json has no entity vectors\)' }).Count | Should -Be 1
    }
}

Describe 'Get-EntityExtractionCandidates (t/4075 review surface, TL e/280#3)' -Tag 'unit' {

    BeforeAll {
        $script:LogPath = Join-Path $TestDrive 'log-1.3.json'
        $log = [ordered]@{
            _schema_version = '1.3.0'; nodes = @(
                [ordered]@{ node_id = 'node-b'; processed_at = '2026-10-07T00:00:00.0000000Z'; embedding_model = 'all-MiniLM-L6-v2'; existing_entity_candidates = @(
                        [ordered]@{ candidate_id = 'ent-010'; proposal_name = 'GPT-5'; entity_id = 'ent-014'; entity_name = 'GPT-4'; similarity = 0.8795; rank = 1; version_sibling = $true }) }
                [ordered]@{ node_id = 'node-a'; processed_at = '2026-10-07T00:00:00.0000000Z'; embedding_model = 'all-MiniLM-L6-v2'; existing_entity_candidates = @(
                        [ordered]@{ candidate_id = 'ent-011'; proposal_name = 'NCI calc'; entity_id = 'ent-186'; entity_name = 'NCI calculator'; similarity = 0.991; rank = 2; version_sibling = $false }
                        [ordered]@{ candidate_id = 'ent-011'; proposal_name = 'NCI calc'; entity_id = 'ent-999'; entity_name = 'NCI calc 2'; similarity = 0.999; rank = 1; version_sibling = $true }) }
                [ordered]@{ node_id = 'node-old'; processed_at = '2026-01-01T00:00:00.0000000Z'; possible_duplicates = @() }
            ) }
        ($log | ConvertTo-Json -Depth 8) | Set-Content -Path $script:LogPath -Encoding utf8NoBOM
    }

    It 'lists every candidate row, typed, sorted by node, candidate and rank; a pre-1.3.0 node contributes nothing' {
        $rows = @(Get-EntityExtractionCandidates -Path $script:LogPath)
        $rows.Count | Should -Be 3
        @($rows).NodeId | Should -Be @('node-a', 'node-a', 'node-b')
        @($rows | ForEach-Object { $_.Rank }) | Should -Be @(1, 2, 1)
        $rows[0].PSObject.TypeNames[0] | Should -Be 'AITriad.EntityExtractionCandidate'
        $rows[1].VersionSibling | Should -BeFalse
        $rows[1].EmbeddingModel | Should -Be 'all-MiniLM-L6-v2'
    }

    It 'filters by -NodeId and by -EntityId (matching either side of the pair)' {
        @(Get-EntityExtractionCandidates -Path $script:LogPath -NodeId 'node-b').EntityId | Should -Be @('ent-014')
        @(Get-EntityExtractionCandidates -Path $script:LogPath -EntityId 'ent-186').CandidateId | Should -Be @('ent-011')
        @(Get-EntityExtractionCandidates -Path $script:LogPath -EntityId 'ent-010').EntityId | Should -Be @('ent-014')
    }

    It 'WARNs, and returns nothing, for a log older than schema 1.3.0' {
        $old = Join-Path $TestDrive 'log-1.2.json'
        ([ordered]@{ _schema_version = '1.2.0'; nodes = @([ordered]@{ node_id = 'n'; possible_duplicates = @() }) } | ConvertTo-Json -Depth 5) |
            Set-Content -Path $old -Encoding utf8NoBOM
        $w = $null
        $rows = @(Get-EntityExtractionCandidates -Path $old -WarningVariable w -WarningAction SilentlyContinue)
        $rows.Count | Should -Be 0
        "$w" | Should -Match 'predates existing_entity_candidates \(1\.3\.0\)'
    }

    It 'throws an ActionableError when the log does not exist' {
        { Get-EntityExtractionCandidates -Path (Join-Path $TestDrive 'nope.json') } | Should -Throw -ExpectedMessage '*entity_extraction_log.json not found*'
    }

    It 'documents that a confirmed match is recorded via Import-Entity merged_into, never in the log' {
        $help = (Get-Help Get-EntityExtractionCandidates -Full | Out-String)
        $help | Should -Match 'merged_into'
        $help | Should -Match 'never records a decision'
        $help | Should -Match 'not "safe to merge"'
    }
}
