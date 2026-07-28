# Tag: unit (t/1806 Phase 1)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Covers Invoke-EntityExtraction — Phase 1 entity ontology extraction (t/1806).
.DESCRIPTION
    AI is mocked (Invoke-AIByUsage) so tests run offline — never a real AI call.
    -Concurrency 1 everywhere: ForEach-Object -Parallel spins fresh runspaces that
    re-import the real module, so a Pester Mock set in this session would not be
    visible there (same reason Invoke-OrgStanceExtraction's tests pin Concurrency 1).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Invoke-EntityExtraction (t/1806 Phase 1)' -Tag 'unit' {

    BeforeEach {
        $script:workDir = Join-Path $TestDrive "run-$(Get-Random)"
        $null = New-Item -ItemType Directory -Path $script:workDir -Force
        $script:emptyTaxDir = Join-Path $script:workDir 'taxdir'
        $null = New-Item -ItemType Directory -Path $script:emptyTaxDir -Force
        $script:emptyDataRoot = Join-Path $script:workDir 'dataroot'
        $null = New-Item -ItemType Directory -Path $script:emptyDataRoot -Force

        $script:entPath = Join-Path $script:workDir 'entities.json'
        $script:embPath = Join-Path $script:workDir 'entity_embeddings.json'
        $script:logPath = Join-Path $script:workDir 'entity_extraction_log.json'
        $script:seiPath = Join-Path $script:workDir 'source_evidence_index.json'
    }

    Context 'Runtime guard — UsageID not yet registered (t/1819 dependency)' {
        It 'Throws an ActionableError naming t/1819 when enrichment.entity-extraction does not resolve' {
            InModuleScope AITriad {
                Mock Get-UsageRegistry -MockWith { [PSCustomObject]@{} }
                { Invoke-EntityExtraction -Confirm:$false } | Should -Throw -ExpectedMessage '*t/1819*'
            }
        }
    }

    Context 'Resolution before minting + confidence gate + person exception' {

        BeforeEach {
            # One pre-existing entity so a proposal can MATCH it (not mint).
            Import-Entity -Proposal @(@{
                name           = 'Existing Corp'
                entity_type    = 'institution'
                dolce_category = 'non-agentive-social-object'
                aliases        = @('ExistingCo')
            }) -Path $script:entPath -SkipEmbedding | Out-Null

            $seiContent = @{
                'node-match' = @{ facts = @(@{ claim = 'Existing Corp published a statement.'; doc_id = 'doc-1' }) }
                'node-mint'  = @{ facts = @(@{ claim = 'A new artifact was announced.'; doc_id = 'doc-2' }) }
                'node-person' = @{ facts = @(@{ claim = 'Jane Analyst authored the report.'; doc_id = 'doc-3' }) }
                'node-gate'  = @{ facts = @(@{ claim = 'Several claims about confidence levels.'; doc_id = 'doc-4' }) }
                'node-invalid' = @{ facts = @(@{ claim = 'A claim about an unclassifiable thing.'; doc_id = 'doc-5' }) }
            }
            ($seiContent | ConvertTo-Json -Depth 8) | Set-Content -Path $script:seiPath -Encoding utf8NoBOM
        }

        It 'Links a proposal that matches an existing entity by name (does NOT mint) and mints an unmatched proposal' {
            InModuleScope AITriad -Parameters @{ TaxDir = $script:emptyTaxDir; DataRoot = $script:emptyDataRoot; EntPath = $script:entPath; EmbPath = $script:embPath; SeiPath = $script:seiPath; LogPath = $script:logPath } {
                param($TaxDir, $DataRoot, $EntPath, $EmbPath, $SeiPath, $LogPath)

                Mock Get-UsageRegistry -MockWith { [PSCustomObject]@{ 'enrichment.entity-extraction' = @{} } }
                Mock Get-TaxonomyDir -MockWith ({ $TaxDir }.GetNewClosure())
                Mock Get-DataRoot -MockWith ({ $DataRoot }.GetNewClosure())
                Mock Invoke-AIByUsage -MockWith {
                    param($UsageId, $Values, $Override, $ApiKey, $FallbackModels)
                    switch ($Values.node_id) {
                        'node-match' {
                            [PSCustomObject]@{
                                Text = '{"proposals":[{"name":"Existing Corp","entity_type":"institution","aliases":[],"quote":"q","confidence":0.9}],"org_mentions":[]}'
                                Model = 'stub'
                            }
                        }
                        'node-mint' {
                            [PSCustomObject]@{
                                Text = '{"proposals":[{"name":"New Artifact Inc","entity_type":"artifact","aliases":["NAI"],"quote":"q","confidence":0.9}],"org_mentions":[{"name":"Some Org"}]}'
                                Model = 'stub'
                            }
                        }
                        default { [PSCustomObject]@{ Text = '{"proposals":[],"org_mentions":[]}'; Model = 'stub' } }
                    }
                }

                $r = Invoke-EntityExtraction -NodeId 'node-match', 'node-mint' -Concurrency 1 `
                    -EntitiesPath $EntPath -EmbeddingsPath $EmbPath -SourceEvidenceIndexPath $SeiPath -OutputPath $LogPath -Confirm:$false

                $r.Minted | Should -Be 1 -Because 'only the unmatched New Artifact Inc proposal mints'
                $r.Linked | Should -Be 1 -Because 'Existing Corp matches by exact name and links instead'
                $r.DroppedBelowGate | Should -Be 0

                $linked = $r.LinkedDispositions | Where-Object { $_.proposal_name -eq 'Existing Corp' }
                $linked.matched_kind | Should -Be 'entity'
                $linked.matched_id  | Should -Be 'ent-001'

                $minted = $r.MintedEntities | Where-Object { $_.name -eq 'New Artifact Inc' }
                $minted | Should -Not -BeNullOrEmpty
                $minted.entity_type    | Should -Be 'artifact'
                $minted.dolce_category | Should -Be 'non-agentive-functional-artifact'

                $store = Get-Content -Raw -Path $EntPath | ConvertFrom-Json
                @($store.entities).Count | Should -Be 2 -Because 'Existing Corp was not re-minted; New Artifact Inc was added'
            }
        }

        It 'Mints a PERSON proposal with NO description (design invariant — LLM never authors one)' {
            InModuleScope AITriad -Parameters @{ TaxDir = $script:emptyTaxDir; DataRoot = $script:emptyDataRoot; EntPath = $script:entPath; EmbPath = $script:embPath; SeiPath = $script:seiPath; LogPath = $script:logPath } {
                param($TaxDir, $DataRoot, $EntPath, $EmbPath, $SeiPath, $LogPath)

                Mock Get-UsageRegistry -MockWith { [PSCustomObject]@{ 'enrichment.entity-extraction' = @{} } }
                Mock Get-TaxonomyDir -MockWith ({ $TaxDir }.GetNewClosure())
                Mock Get-DataRoot -MockWith ({ $DataRoot }.GetNewClosure())
                Mock Invoke-AIByUsage -MockWith {
                    param($UsageId, $Values, $Override, $ApiKey, $FallbackModels)
                    if ($Values.node_id -eq 'node-person') {
                        [PSCustomObject]@{
                            Text = '{"proposals":[{"name":"Jane Analyst","entity_type":"person","aliases":[],"quote":"authored the report","confidence":0.9}],"org_mentions":[]}'
                            Model = 'stub'
                        }
                    } else { [PSCustomObject]@{ Text = '{"proposals":[],"org_mentions":[]}'; Model = 'stub' } }
                }

                $r = Invoke-EntityExtraction -NodeId 'node-person' -Concurrency 1 `
                    -EntitiesPath $EntPath -EmbeddingsPath $EmbPath -SourceEvidenceIndexPath $SeiPath -OutputPath $LogPath -Confirm:$false

                $r.Minted | Should -Be 1
                $minted = $r.MintedEntities | Where-Object { $_.name -eq 'Jane Analyst' }
                $minted.entity_type    | Should -Be 'person'
                $minted.dolce_category | Should -Be 'agentive-physical-object'

                $store = Get-Content -Raw -Path $EntPath | ConvertFrom-Json
                $rec = $store.entities | Where-Object { $_.id -eq $minted.id }
                $rec.entity_type | Should -Be 'person'
                [string]::IsNullOrWhiteSpace($rec.description) | Should -BeTrue -Because 'person records are never minted with an LLM-authored description'
            }
        }

        It 'Drops below-gate proposals, mints at/above the gate, and flags near-gate proposals' {
            InModuleScope AITriad -Parameters @{ TaxDir = $script:emptyTaxDir; DataRoot = $script:emptyDataRoot; EntPath = $script:entPath; EmbPath = $script:embPath; SeiPath = $script:seiPath; LogPath = $script:logPath } {
                param($TaxDir, $DataRoot, $EntPath, $EmbPath, $SeiPath, $LogPath)

                Mock Get-UsageRegistry -MockWith { [PSCustomObject]@{ 'enrichment.entity-extraction' = @{} } }
                Mock Get-TaxonomyDir -MockWith ({ $TaxDir }.GetNewClosure())
                Mock Get-DataRoot -MockWith ({ $DataRoot }.GetNewClosure())
                Mock Invoke-AIByUsage -MockWith {
                    param($UsageId, $Values, $Override, $ApiKey, $FallbackModels)
                    if ($Values.node_id -eq 'node-gate') {
                        [PSCustomObject]@{
                            Text = '{"proposals":[' +
                                   '{"name":"Low Conf Thing","entity_type":"artifact","aliases":[],"quote":"q","confidence":0.4},' +
                                   '{"name":"High Conf Thing","entity_type":"artifact","aliases":[],"quote":"q","confidence":0.8},' +
                                   '{"name":"Near Gate Thing","entity_type":"artifact","aliases":[],"quote":"q","confidence":0.65}' +
                                   '],"org_mentions":[]}'
                            Model = 'stub'
                        }
                    } else { [PSCustomObject]@{ Text = '{"proposals":[],"org_mentions":[]}'; Model = 'stub' } }
                }

                $r = Invoke-EntityExtraction -NodeId 'node-gate' -Concurrency 1 `
                    -EntitiesPath $EntPath -EmbeddingsPath $EmbPath -SourceEvidenceIndexPath $SeiPath -OutputPath $LogPath -Confirm:$false

                $r.DroppedBelowGate | Should -Be 1 -Because 'Low Conf Thing (0.4) is below the 0.6 default threshold'
                $r.Minted           | Should -Be 2 -Because 'High Conf Thing and Near Gate Thing both clear the gate'
                $r.NearGateMinted   | Should -Be 1 -Because 'Near Gate Thing (0.65) is in [0.6, 0.7)'

                $nearGateEntry = $r.MintedEntities | Where-Object { $_.name -eq 'Near Gate Thing' }
                $nearGateEntry.near_gate | Should -BeTrue
                $highConfEntry = $r.MintedEntities | Where-Object { $_.name -eq 'High Conf Thing' }
                $highConfEntry.near_gate | Should -BeFalse
            }
        }

        It 'Drops a proposal with an unrecognized entity_type (shape validation, not a gate drop)' {
            InModuleScope AITriad -Parameters @{ TaxDir = $script:emptyTaxDir; DataRoot = $script:emptyDataRoot; EntPath = $script:entPath; EmbPath = $script:embPath; SeiPath = $script:seiPath; LogPath = $script:logPath } {
                param($TaxDir, $DataRoot, $EntPath, $EmbPath, $SeiPath, $LogPath)

                Mock Get-UsageRegistry -MockWith { [PSCustomObject]@{ 'enrichment.entity-extraction' = @{} } }
                Mock Get-TaxonomyDir -MockWith ({ $TaxDir }.GetNewClosure())
                Mock Get-DataRoot -MockWith ({ $DataRoot }.GetNewClosure())
                Mock Invoke-AIByUsage -MockWith {
                    param($UsageId, $Values, $Override, $ApiKey, $FallbackModels)
                    if ($Values.node_id -eq 'node-invalid') {
                        [PSCustomObject]@{
                            Text = '{"proposals":[{"name":"Bad Type Thing","entity_type":"alien","aliases":[],"quote":"q","confidence":0.9}],"org_mentions":[]}'
                            Model = 'stub'
                        }
                    } else { [PSCustomObject]@{ Text = '{"proposals":[],"org_mentions":[]}'; Model = 'stub' } }
                }

                $r = Invoke-EntityExtraction -NodeId 'node-invalid' -Concurrency 1 `
                    -EntitiesPath $EntPath -EmbeddingsPath $EmbPath -SourceEvidenceIndexPath $SeiPath -OutputPath $LogPath -Confirm:$false

                $r.InvalidDropped | Should -Be 1
                $r.Minted         | Should -Be 0
                ($r.InvalidItems -join '|') | Should -Match "entity_type 'alien'"
            }
        }
    }

    Context 'Idempotence' {
        BeforeEach {
            $seiContent = @{ 'node-idem' = @{ facts = @(@{ claim = 'A repeatable claim.'; doc_id = 'doc-9' }) } }
            ($seiContent | ConvertTo-Json -Depth 8) | Set-Content -Path $script:seiPath -Encoding utf8NoBOM
        }

        It 'Skips already-processed node ids on re-run unless -Force' {
            InModuleScope AITriad -Parameters @{ TaxDir = $script:emptyTaxDir; DataRoot = $script:emptyDataRoot; EntPath = $script:entPath; EmbPath = $script:embPath; SeiPath = $script:seiPath; LogPath = $script:logPath } {
                param($TaxDir, $DataRoot, $EntPath, $EmbPath, $SeiPath, $LogPath)

                Mock Get-UsageRegistry -MockWith { [PSCustomObject]@{ 'enrichment.entity-extraction' = @{} } }
                Mock Get-TaxonomyDir -MockWith ({ $TaxDir }.GetNewClosure())
                Mock Get-DataRoot -MockWith ({ $DataRoot }.GetNewClosure())
                Mock Invoke-AIByUsage -MockWith {
                    [PSCustomObject]@{ Text = '{"proposals":[{"name":"Repeatable Inc","entity_type":"artifact","aliases":[],"quote":"q","confidence":0.9}],"org_mentions":[]}'; Model = 'stub' }
                }

                $r1 = Invoke-EntityExtraction -Concurrency 1 -EntitiesPath $EntPath -EmbeddingsPath $EmbPath -SourceEvidenceIndexPath $SeiPath -OutputPath $LogPath -Confirm:$false
                $r1.Minted | Should -Be 1

                $r2 = Invoke-EntityExtraction -Concurrency 1 -EntitiesPath $EntPath -EmbeddingsPath $EmbPath -SourceEvidenceIndexPath $SeiPath -OutputPath $LogPath -Confirm:$false
                $r2.SkippedAlreadyDone | Should -Be 1
                $r2.NodesProcessed     | Should -Be 0

                $r3 = Invoke-EntityExtraction -Concurrency 1 -Force -EntitiesPath $EntPath -EmbeddingsPath $EmbPath -SourceEvidenceIndexPath $SeiPath -OutputPath $LogPath -Confirm:$false
                $r3.SkippedAlreadyDone | Should -Be 0
                $r3.NodesProcessed     | Should -Be 1
            }
        }
    }
}
