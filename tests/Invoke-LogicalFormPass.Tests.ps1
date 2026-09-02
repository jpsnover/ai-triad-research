# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# t/3215 — FOL Phase-1 formalization pass. Two layers:
#   1. Pure helpers (InModuleScope) — placeholder join, grounding enforcement, enum validation —
#      exercised WITHOUT a live LLM.
#   2. The Invoke-LogicalFormPass orchestrator over $TestDrive fixtures, with Invoke-AIByUsage mocked
#      so a single canned model response proves grounding is per-claim (mint-drop, copy-not-judge,
#      mechanical modality, factual modality:null, about projection), plus idempotence + -WhatIf.
# Schema of record: t/3126, research/comp-linguist/docs/logical-form-schema.md.

Describe 'Invoke-LogicalFormPass — helpers (t/3215)' -Tag 'unit', 'fol' {
    BeforeAll {
        Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
    }

    It 'ConvertTo-EntityRefsPromptJson joins the register dolce_category into sort' {
        InModuleScope AITriad {
            $map = @{ 'ent-001' = 'perdurant'; 'ent-055' = 'non-agentive-functional-artifact' }
            $refs = @(
                [pscustomobject]@{ ref = 'ent-055'; surface = 'GPT-5'; match_level = 'exact' }
                [pscustomobject]@{ ref = 'ent-777'; surface = 'Unknown'; match_level = 'exact' }  # no dolce -> dropped
            )
            $table = Get-LogicalFormRefTable -EntityRefs $refs -DolceMap $map
            @($table).Count | Should -Be 1
            $table[0].sort  | Should -Be 'non-agentive-functional-artifact'
            $json = ConvertTo-EntityRefsPromptJson -RefTable $table
            $json | Should -BeLike '*"ref":"ent-055"*'
            $json | Should -BeLike '*"sort":"non-agentive-functional-artifact"*'
        }
    }

    It 'ConvertTo-EntityRefsPromptJson returns [] for an empty table' {
        InModuleScope AITriad {
            (ConvertTo-EntityRefsPromptJson -RefTable @()) | Should -Be '[]'
        }
    }

    It 'Get-ClaimProposition: factual reads .claim; BDI reads canonical_proposition then falls back to point' {
        InModuleScope AITriad {
            $factual = [pscustomobject]@{ claim = 'The Apollo Project cost billions.'; point = 'ignored' }
            Get-ClaimProposition -Claim $factual -IsFactual | Should -Be 'The Apollo Project cost billions.'

            $bdi = [pscustomobject]@{ canonical_proposition = 'OpenAI released GPT-5.'; point = 'longer prose' }
            Get-ClaimProposition -Claim $bdi | Should -Be 'OpenAI released GPT-5.'

            $bdiEmpty = [pscustomobject]@{ canonical_proposition = ''; point = 'fallback prose' }
            Get-ClaimProposition -Claim $bdiEmpty | Should -Be 'fallback prose'
        }
    }

    It 'ConvertTo-GroundedLogicalForm drops minted ent ids and copies sort/match_level from the register (not the model)' {
        InModuleScope AITriad {
            $table = @([pscustomobject]@{ ref = 'ent-055'; surface = 'GPT-5'; match_level = 'exact'; sort = 'non-agentive-functional-artifact' })
            $raw = [pscustomobject]@{
                predicate  = 'release'
                event_ref  = 'e1'
                args       = @(
                    [pscustomobject]@{ role = 'patient'; ref = 'ent-055'; sort = 'perdurant'; match_level = 'related' }  # model's sort/ml are WRONG
                    [pscustomobject]@{ role = 'agent';   ref = 'ent-999'; sort = 'perdurant'; match_level = 'exact' }    # minted -> dropped
                    [pscustomobject]@{ role = 'theme';   ref = 'lit:"the public"'; sort = 'agentive-physical-object'; match_level = 'exact' }
                )
                polarity   = 'positive'
                modality   = [pscustomobject]@{ holder = 'camp:WRONG'; attitude = 'WRONG' }
                temporal   = [pscustomobject]@{ type = 'at'; value = '2025-08' }
                about      = @([pscustomobject]@{ ref = 'ent-999'; match_level = 'exact' })  # minted -> dropped
                formalization_confidence = 0.9
                status     = 'proposed'
            }
            $lf = ConvertTo-GroundedLogicalForm -Raw $raw -RefTable $table -Category 'Beliefs' -Camp 'acc'
            $args = @($lf.args)
            $args.Count | Should -Be 2                              # ent-999 dropped, ent-055 + lit kept
            ($args | Where-Object { $_.ref -eq 'ent-999' }) | Should -BeNullOrEmpty
            $ent = $args | Where-Object { $_.ref -eq 'ent-055' }
            $ent.sort        | Should -Be 'non-agentive-functional-artifact'   # copied from register, model's 'perdurant' discarded
            $ent.match_level | Should -Be 'exact'                              # copied from entity_ref, model's 'related' discarded
            $lf.modality.holder   | Should -Be 'camp:acc'          # mechanical from camp
            $lf.modality.attitude | Should -Be 'belief'            # mechanical from category
            @($lf.about).Count    | Should -Be 0                   # minted about ref dropped
            $lf.status            | Should -Be 'proposed'
        }
    }

    It 'ConvertTo-GroundedLogicalForm: factual claim gets modality:null; honors status rejected (meta-descriptive)' {
        InModuleScope AITriad {
            $raw = [pscustomobject]@{
                predicate = 'discuss'; event_ref = 'e1'; args = @()
                polarity = 'positive'
                modality = [pscustomobject]@{ holder = 'camp:acc'; attitude = 'belief' }  # must be nulled for factual
                temporal = [pscustomobject]@{ type = 'unspecified'; value = '2099' }       # value must null-out
                about = @(); formalization_confidence = 0.15; status = 'rejected'
            }
            $lf = ConvertTo-GroundedLogicalForm -Raw $raw -RefTable @() -Category 'factual' -Camp ''
            $lf.modality        | Should -BeNullOrEmpty
            $lf.status          | Should -Be 'rejected'
            $lf.temporal.type   | Should -Be 'unspecified'
            $lf.temporal.value  | Should -BeNullOrEmpty
        }
    }

    It 'ConvertTo-GroundedLogicalForm forces status proposed when the model claims accepted' {
        InModuleScope AITriad {
            $raw = [pscustomobject]@{ predicate = 'x'; event_ref = 'e1'; args = @(); polarity = 'positive'
                modality = $null; temporal = [pscustomobject]@{ type = 'unspecified'; value = $null }
                about = @(); formalization_confidence = 0.8; status = 'accepted' }
            (ConvertTo-GroundedLogicalForm -Raw $raw -RefTable @() -Category 'factual' -Camp '').status | Should -Be 'proposed'
        }
    }

    It 'Test-LogicalFormStructure enforces the DolceCategory sort enum' {
        InModuleScope AITriad {
            $bad = [pscustomobject][ordered]@{
                predicate = 'x'; event_ref = 'e1'
                args = @([ordered]@{ role = 'agent'; ref = 'lit:"z"'; sort = 'not-a-dolce-sort'; match_level = 'exact' })
                polarity = 'positive'; modality = $null
                temporal = [ordered]@{ type = 'unspecified'; value = $null }
                about = @(); formalization_confidence = 0.5; status = 'proposed'
            }
            $r = Test-LogicalFormStructure -LogicalForm $bad -Category 'factual'
            $r.Ok     | Should -BeFalse
            $r.Reason | Should -BeLike '*DolceCategory*'
        }
    }

    It 'Test-LogicalFormStructure passes a well-formed factual form and a rejected form' {
        InModuleScope AITriad {
            $ok = [pscustomobject][ordered]@{
                predicate = 'cost'; event_ref = 'e1'
                args = @([ordered]@{ role = 'patient'; ref = 'ent-001'; sort = 'perdurant'; match_level = 'exact' })
                polarity = 'positive'; modality = $null
                temporal = [ordered]@{ type = 'at'; value = '2025' }
                about = @([ordered]@{ ref = 'ent-001'; match_level = 'exact' })
                formalization_confidence = 0.85; status = 'proposed'
            }
            (Test-LogicalFormStructure -LogicalForm $ok -Category 'factual').Ok | Should -BeTrue

            $rejected = [pscustomobject][ordered]@{
                predicate = 'discuss'; event_ref = 'e1'; args = @(); polarity = 'positive'; modality = $null
                temporal = [ordered]@{ type = 'unspecified'; value = $null }; about = @()
                formalization_confidence = 0.1; status = 'rejected'
            }
            (Test-LogicalFormStructure -LogicalForm $rejected -Category 'factual').Ok | Should -BeTrue
        }
    }
}

Describe 'Invoke-LogicalFormPass — orchestrator (t/3215)' -Tag 'unit', 'fol' {
    BeforeAll {
        Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

        function New-Entities {
            param([string]$Path)
            $entities = [ordered]@{
                _schema_version = '1.0.0'; _doc = 'test'; entity_count = 2; last_modified = '2026-09-02'
                entities = @(
                    [ordered]@{ id = 'ent-001'; name = 'Apollo Project'; aliases = @(); entity_type = 'event'; dolce_category = 'perdurant'; status = 'approved' }
                    [ordered]@{ id = 'ent-055'; name = 'GPT-5'; aliases = @(); entity_type = 'artifact'; dolce_category = 'non-agentive-functional-artifact'; status = 'approved' }
                )
            }
            ($entities | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
        }

        # A single canned model response reused for every claim. It references ent-001, ent-055, a
        # minted ent-999, and a lit — so grounding is proven per-claim (each claim keeps only its own
        # ent ref). Model-supplied sort/match_level/modality are all WRONG on purpose.
        $script:MockLf = @{
            predicate = 'release'; event_ref = 'e1'
            args = @(
                @{ role = 'agent';   ref = 'ent-001'; sort = 'agentive-physical-object'; match_level = 'related' }
                @{ role = 'patient'; ref = 'ent-055'; sort = 'perdurant';                match_level = 'subclass' }
                @{ role = 'instrument'; ref = 'ent-999'; sort = 'perdurant';             match_level = 'exact' }
                @{ role = 'theme';   ref = 'lit:"the public"'; sort = 'agentive-physical-object'; match_level = 'exact' }
            )
            polarity = 'positive'
            modality = @{ holder = 'camp:zzz'; attitude = 'zzz' }
            temporal = @{ type = 'at'; value = '2025-08' }
            about = @(@{ ref = 'ent-001'; match_level = 'related' }, @{ ref = 'ent-999'; match_level = 'exact' })
            formalization_confidence = 0.9; status = 'proposed'
        } | ConvertTo-Json -Depth 6 -Compress
    }

    BeforeEach {
        $script:root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:root -Force | Out-Null
        $script:entPath = Join-Path $script:root 'entities.json'
        $script:sumPath = Join-Path $script:root '170306856v3-2026.json'
        New-Entities -Path $script:entPath

        # A BDI key_point (entity_refs -> ent-055) and a factual_claim (entity_refs -> ent-001).
        $doc = @{
            doc_id = 'd1'
            pov_summaries = @{
                accelerationist = @{ key_points = @(
                        @{
                            category = 'Beliefs'; taxonomy_node_id = 'acc-beliefs-001'
                            canonical_proposition = 'OpenAI released GPT-5.'; point = 'longer prose'
                            entity_refs = @(@{ ref = 'ent-055'; surface = 'GPT-5'; method = 'exact'; link_confidence = 1.0; match_level = 'exact'; status = 'linked' })
                        }
                    ) }
            }
            factual_claims = @(
                @{
                    claim = 'The Apollo Project cost billions.'
                    entity_refs = @(@{ ref = 'ent-001'; surface = 'Apollo Project'; method = 'exact'; link_confidence = 1.0; match_level = 'exact'; status = 'linked' })
                }
                @{ claim = 'A claim with no register links at all.' }  # no entity_refs -> skipped by default
            )
        }
        ($doc | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $script:sumPath -Encoding utf8NoBOM
    }

    It 'Formalizes grounded claims, enforcing per-claim grounding + copy-not-judge + mechanical modality' {
        Mock -ModuleName AITriad Invoke-AIByUsage { [pscustomobject]@{ Text = $script:MockLf; Backend = 'test'; Model = 'test' } }

        $r = Invoke-LogicalFormPass -EntitiesPath $script:entPath -SummariesPath $script:sumPath
        $r.LogicalFormsWritten | Should -Be 2      # BDI + factual; the ref-less factual is skipped
        $r.FilesWritten        | Should -Be 1
        $r.Skipped             | Should -Be 1       # the no-entity_refs claim

        $doc = Get-Content -Raw -LiteralPath $script:sumPath -Encoding utf8 | ConvertFrom-Json

        # BDI claim: keeps only ent-055, sort/ml copied from register, mechanical modality, empty about.
        $bdi = $doc.pov_summaries.accelerationist.key_points[0].logical_form
        $bdi.status | Should -Be 'proposed'
        $bdiEnt = @($bdi.args | Where-Object { $_.ref -eq 'ent-055' })
        $bdiEnt.Count            | Should -Be 1
        $bdiEnt[0].sort          | Should -Be 'non-agentive-functional-artifact'   # register, not model's 'perdurant'
        $bdiEnt[0].match_level   | Should -Be 'exact'                              # entity_ref, not model's 'subclass'
        @($bdi.args | Where-Object { $_.ref -eq 'ent-001' }) | Should -BeNullOrEmpty  # not in this claim's refs
        @($bdi.args | Where-Object { $_.ref -eq 'ent-999' }) | Should -BeNullOrEmpty  # minted -> dropped
        $bdi.modality.holder   | Should -Be 'camp:acc'
        $bdi.modality.attitude | Should -Be 'belief'
        @($bdi.about).Count    | Should -Be 0        # ent-001 (not a ref here) + ent-999 (minted) both dropped

        # Factual claim: keeps only ent-001, modality null, about projects ent-001.
        $fc = $doc.factual_claims[0].logical_form
        $fc.modality | Should -BeNullOrEmpty
        $fcEnt = @($fc.args | Where-Object { $_.ref -eq 'ent-001' })
        $fcEnt.Count      | Should -Be 1
        $fcEnt[0].sort    | Should -Be 'perdurant'
        @($fc.about | Where-Object { $_.ref -eq 'ent-001' }).Count | Should -Be 1

        # The ref-less factual claim was not formalized.
        $doc.factual_claims[1].PSObject.Properties['logical_form'] | Should -BeNullOrEmpty
    }

    It 'Is idempotent — a second run skips claims that already have a logical_form' {
        Mock -ModuleName AITriad Invoke-AIByUsage { [pscustomobject]@{ Text = $script:MockLf; Backend = 'test'; Model = 'test' } }
        Invoke-LogicalFormPass -EntitiesPath $script:entPath -SummariesPath $script:sumPath | Out-Null
        $second = Invoke-LogicalFormPass -EntitiesPath $script:entPath -SummariesPath $script:sumPath
        $second.LogicalFormsWritten | Should -Be 0
        $second.FilesWritten        | Should -Be 0
    }

    It '-IncludeUngrounded also formalizes claims with no entity_refs (all-literal args)' {
        Mock -ModuleName AITriad Invoke-AIByUsage {
            [pscustomobject]@{ Text = (@{ predicate = 'exist'; event_ref = 'e1'
                        args = @(@{ role = 'theme'; ref = 'lit:"x"'; sort = 'perdurant'; match_level = 'exact' })
                        polarity = 'positive'; modality = $null; temporal = @{ type = 'unspecified'; value = $null }
                        about = @(); formalization_confidence = 0.5; status = 'proposed' } | ConvertTo-Json -Depth 6 -Compress)
                Backend = 'test'; Model = 'test' }
        }
        $r = Invoke-LogicalFormPass -EntitiesPath $script:entPath -SummariesPath $script:sumPath -IncludeUngrounded
        $r.LogicalFormsWritten | Should -Be 3       # BDI + both factual claims now
    }

    It 'Drops an invalid model output without persisting it' {
        Mock -ModuleName AITriad Invoke-AIByUsage {
            [pscustomobject]@{ Text = (@{ predicate = ''; event_ref = 'e1'; args = @(); polarity = 'positive'
                        modality = $null; temporal = @{ type = 'unspecified'; value = $null }; about = @()
                        formalization_confidence = 0.5; status = 'proposed' } | ConvertTo-Json -Depth 6 -Compress)
                Backend = 'test'; Model = 'test' }
        }
        $r = Invoke-LogicalFormPass -EntitiesPath $script:entPath -SummariesPath $script:sumPath
        $r.InvalidDropped      | Should -BeGreaterThan 0
        $r.LogicalFormsWritten | Should -Be 0
        $r.FilesWritten        | Should -Be 0
    }

    It '-WhatIf makes no model call and no write' {
        Mock -ModuleName AITriad Invoke-AIByUsage { [pscustomobject]@{ Text = $script:MockLf; Backend = 'test'; Model = 'test' } }
        $before = Get-Content -Raw -LiteralPath $script:sumPath -Encoding utf8
        Invoke-LogicalFormPass -EntitiesPath $script:entPath -SummariesPath $script:sumPath -WhatIf | Out-Null
        (Get-Content -Raw -LiteralPath $script:sumPath -Encoding utf8) | Should -Be $before
        Should -Invoke -CommandName Invoke-AIByUsage -ModuleName AITriad -Times 0 -Exactly
    }

    It '-MaxClaims caps the number of formalizations' {
        Mock -ModuleName AITriad Invoke-AIByUsage { [pscustomobject]@{ Text = $script:MockLf; Backend = 'test'; Model = 'test' } }
        $r = Invoke-LogicalFormPass -EntitiesPath $script:entPath -SummariesPath $script:sumPath -MaxClaims 1
        $r.ClaimsSelected      | Should -Be 1
        $r.LogicalFormsWritten | Should -Be 1
    }
}
