# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# t/1894 Phase 2-B — batch entity mention indexer. Uses the no-mock fixture pattern:
# every call passes explicit -EntitiesPath / -SourceEvidenceIndexPath / -SummariesPath /
# -OutputPath under $TestDrive, so no Private path-helper mocking is required.
# t/3160 G7: node:* (POV/situation grounding) moved to CL's Python reconciler; this cmdlet
# now owns {sei:*, summary:*} only (the -PovPath parameter was removed).

Describe 'Update-EntityMentionIndex (t/1894 Phase 2-B)' -Tag 'unit' {
    BeforeAll {
        Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

        function New-Sei {
            param([hashtable]$Map, [string]$Path)
            ($Map | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
        }

        function New-Summary {
            param([hashtable]$Doc, [string]$Path)
            ($Doc | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
        }
    }

    BeforeEach {
        $script:root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:root -Force | Out-Null
        $script:entPath = Join-Path $script:root 'entities.json'
        $script:seiPath = Join-Path $script:root 'source_evidence_index.json'
        $script:outPath = Join-Path $script:root 'entity_mentions.json'

        # Two approved entities; ent-001 has an alias, ent-002 is a shorter overlapping name.
        $entities = [ordered]@{
            _schema_version = '1.0.0'
            _doc            = 'test'
            entity_count    = 2
            last_modified   = '2026-07-28'
            entities        = @(
                [ordered]@{ id = 'ent-001'; name = 'Apollo Project'; aliases = @('Apollo Program'); entity_type = 'event'; status = 'approved' }
                [ordered]@{ id = 'ent-002'; name = 'Apollo'; aliases = $null; entity_type = 'event'; status = 'approved' }
            )
        }
        ($entities | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $script:entPath -Encoding utf8NoBOM
    }

    Context 'Alias-first matching' {

        It 'Writes a schema-valid file with a correct alias mention (quote/offset/entity_ref/discovered_by)' {
            New-Sei -Path $script:seiPath -Map @{
                'acc-desires-001' = @{ facts = @(@{ claim = 'The Apollo Project reshaped ambition.'; doc_id = 'd1' }) }
            }

            $r = Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -SummariesPath @() -OutputPath $script:outPath
            $r.Written | Should -BeTrue

            $file = Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json
            $file._schema_version | Should -Be '1.0.0'
            $file.PSObject.Properties['_doc'] | Should -Not -BeNullOrEmpty
            $file.PSObject.Properties['last_modified'] | Should -Not -BeNullOrEmpty

            $c = $file.containers.'sei:acc-desires-001'
            $c | Should -Not -BeNullOrEmpty
            @($c.mentions).Count | Should -Be 1
            $m = $c.mentions[0]
            $m.entity_ref | Should -Be 'ent-001'
            $m.quote | Should -Be 'Apollo Project'
            $m.offset | Should -Be 4
            $m.discovered_by | Should -Be 'alias'
            # text_sha256 present, 64-char lowercase hex.
            $c.text_sha256 | Should -Match '^[0-9a-f]{64}$'
        }

        It 'Settles overlapping matches by longest-most-specific (Apollo Program beats Apollo)' {
            New-Sei -Path $script:seiPath -Map @{
                'n1' = @{ facts = @(@{ claim = 'Apollo Program milestone'; doc_id = 'd1' }) }
            }
            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -SummariesPath @() -OutputPath $script:outPath | Out-Null

            $file = Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json
            $m = @($file.containers.'sei:n1'.mentions)
            $m.Count | Should -Be 1
            $m[0].entity_ref | Should -Be 'ent-001'
            $m[0].quote | Should -Be 'Apollo Program'
        }

        It 'Matches across the pinned whitespace set (NBSP separator still links)' {
            # Per the D1 parity contract, U+00A0 (NBSP) collapses like a space; "Apollo<NBSP>Program"
            # must match the alias "Apollo Program". Build NBSP by code point (never literal in source).
            $nbsp = [char]0xA0
            New-Sei -Path $script:seiPath -Map @{
                'n1' = @{ facts = @(@{ claim = "Apollo${nbsp}Program advanced"; doc_id = 'd1' }) }
            }
            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -SummariesPath @() -OutputPath $script:outPath | Out-Null

            $file = Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json
            $m = @($file.containers.'sei:n1'.mentions)
            $m.Count | Should -Be 1
            $m[0].entity_ref | Should -Be 'ent-001'
            $m[0].offset | Should -Be 0
        }

        It 'Handles hyphen/numeric names (GPT-4o, o4-mini) — internal - and digits, boundary only at ends' {
            # .NET \w is Unicode-aware; internal '-' is NOT a word char, so it is a literal in the
            # pattern and the (?<!\w)/(?!\w) boundaries apply only at the token ends. Prove that a
            # name embedded in a longer word does NOT match, but the standalone form does.
            $ents = [ordered]@{
                _schema_version = '1.0.0'; _doc = 'test'; entity_count = 2; last_modified = '2026-07-28'
                entities        = @(
                    [ordered]@{ id = 'ent-010'; name = 'GPT-4o'; aliases = $null; entity_type = 'artifact'; status = 'approved' }
                    [ordered]@{ id = 'ent-011'; name = 'o4-mini'; aliases = $null; entity_type = 'artifact'; status = 'approved' }
                )
            }
            ($ents | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $script:entPath -Encoding utf8NoBOM
            New-Sei -Path $script:seiPath -Map @{
                'n1' = @{ facts = @(@{ claim = 'GPT-4o beats o4-mini but GPT-4omini is fake.'; doc_id = 'd1' }) }
            }
            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -SummariesPath @() -OutputPath $script:outPath | Out-Null

            $m = @((Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json).containers.'sei:n1'.mentions)
            $m.Count | Should -Be 2   # standalone GPT-4o + o4-mini; the 'GPT-4omini' occurrence must NOT match
            ($m.entity_ref | Sort-Object) | Should -Be @('ent-010', 'ent-011')
            ($m | Where-Object entity_ref -eq 'ent-010').quote | Should -Be 'GPT-4o'
            ($m | Where-Object entity_ref -eq 'ent-011').quote | Should -Be 'o4-mini'
        }

        It 'Matches case-insensitively with word boundaries (no substring false positives)' {
            New-Sei -Path $script:seiPath -Map @{
                'n1' = @{ facts = @(@{ claim = 'the APOLLO team; also apollonian ideals'; doc_id = 'd1' }) }
            }
            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -SummariesPath @() -OutputPath $script:outPath | Out-Null

            $file = Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json
            $m = @($file.containers.'sei:n1'.mentions)
            # 'APOLLO' matches ent-002 (case-insensitive); 'apollonian' must NOT (word boundary).
            $m.Count | Should -Be 1
            $m[0].entity_ref | Should -Be 'ent-002'
            $m[0].quote | Should -Be 'APOLLO'
        }
    }

    Context 'Idempotency + supersession' {

        It 'Second run on unchanged input is a byte-stable no-op' {
            New-Sei -Path $script:seiPath -Map @{
                'n1' = @{ facts = @(@{ claim = 'The Apollo Project reshaped ambition.'; doc_id = 'd1' }) }
            }
            $r1 = Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -SummariesPath @() -OutputPath $script:outPath
            $r1.Written | Should -BeTrue
            $hash1 = (Get-FileHash -LiteralPath $script:outPath -Algorithm SHA256).Hash

            $r2 = Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -SummariesPath @() -OutputPath $script:outPath
            $r2.Unchanged | Should -BeTrue
            $r2.Written | Should -BeFalse
            (Get-FileHash -LiteralPath $script:outPath -Algorithm SHA256).Hash | Should -Be $hash1
        }

        It '-Force rewrites even when unchanged' {
            New-Sei -Path $script:seiPath -Map @{ 'n1' = @{ facts = @(@{ claim = 'Apollo Project.'; doc_id = 'd1' }) } }
            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -SummariesPath @() -OutputPath $script:outPath | Out-Null
            $r = Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -SummariesPath @() -OutputPath $script:outPath -Force
            $r.Written | Should -BeTrue
        }
    }

    Context 'Human-authored mentions win (§5)' {

        It 'Preserves a human mention on unchanged text and suppresses an overlapping alias hit' {
            New-Sei -Path $script:seiPath -Map @{
                'n1' = @{ facts = @(@{ claim = 'The Apollo Project reshaped ambition.'; doc_id = 'd1' }) }
            }
            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -SummariesPath @() -OutputPath $script:outPath | Out-Null

            # Inject a human mention at the SAME offset/span as the alias hit, different ref.
            $file = Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json
            $c = $file.containers.'sei:n1'
            $c.mentions = @([ordered]@{ entity_ref = 'ent-999'; quote = 'Apollo Project'; offset = 4; discovered_by = 'human' })
            ($file | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $script:outPath -Encoding utf8NoBOM

            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -SummariesPath @() -OutputPath $script:outPath -Force | Out-Null

            $after = Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json
            $m = @($after.containers.'sei:n1'.mentions)
            $m.Count | Should -Be 1
            $m[0].discovered_by | Should -Be 'human'
            $m[0].entity_ref | Should -Be 'ent-999'
        }
    }

    Context 'Container sources' {

        It 'NEVER emits a node:* container key — node grounding is owned by the CL reconciler (t/3160 G7 disjoint scope)' {
            # sei + summary inputs both present; the output must contain ONLY sei:* / summary:*
            # keys, never node:*. node:* moved to reconcile_grounding.py under the G7 disjoint-
            # scope contract (t/3160#2-#3) — this cmdlet must not double-write it.
            New-Sei -Path $script:seiPath -Map @{
                'acc-desires-001' = @{ facts = @(@{ claim = 'The Apollo Project reshaped ambition.'; doc_id = 'd1' }) }
            }
            $summPath = Join-Path $script:root 'doc-disjoint.json'
            New-Summary -Path $summPath -Doc @{ doc_id = 'docD'; factual_claims = @(@{ claim = 'Apollo Project.' }) }

            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -SummariesPath @($summPath) -OutputPath $script:outPath | Out-Null

            $file = Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json
            $keys = @($file.containers.PSObject.Properties.Name)
            # The load-bearing disjoint-scope assertion: no node:* key, ever.
            @($keys | Where-Object { $_ -like 'node:*' }) | Should -BeNullOrEmpty
            # Sanity: the cmdlet still produces its own {sei:*, summary:*} scope.
            $keys | Should -Contain 'sei:acc-desires-001'
            @($keys | Where-Object { $_ -like 'summary:*' }) | Should -Not -BeNullOrEmpty
        }

        It 'PRESERVES a reconciler-owned node:* container verbatim across a rebuild (no clobber — t/3160 G7 no-orphan)' {
            # Pre-seed entity_mentions.json with a node:* container the CL reconciler owns. The
            # cmdlet writes the whole file, so without preservation this rebuild would DELETE node:*.
            $preexisting = [ordered]@{
                _schema_version = '1.0.0'; _doc = 'test'; indexed_status = @('approved')
                last_modified   = '2026-07-28T00:00:00Z'
                containers      = [ordered]@{
                    'node:acc-beliefs-001' = [ordered]@{
                        text_sha256  = 'deadbeef'
                        extracted_at = '2026-07-28T00:00:00Z'
                        mentions     = @([ordered]@{ entity_ref = 'ent-001'; quote = 'Apollo Project'; offset = 0; discovered_by = 'alias' })
                    }
                }
            }
            ($preexisting | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $script:outPath -Encoding utf8NoBOM

            New-Sei -Path $script:seiPath -Map @{
                'acc-desires-001' = @{ facts = @(@{ claim = 'The Apollo Project reshaped ambition.'; doc_id = 'd1' }) }
            }
            $r = Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -SummariesPath @() -OutputPath $script:outPath
            $r.PreservedForeignCount | Should -Be 1

            $file = Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json
            # node:* preserved VERBATIM (owned by the reconciler; this cmdlet must not touch it)
            $nodeC = $file.containers.'node:acc-beliefs-001'
            $nodeC | Should -Not -BeNullOrEmpty
            $nodeC.text_sha256 | Should -Be 'deadbeef'
            @($nodeC.mentions)[0].entity_ref | Should -Be 'ent-001'
            # own sei:* container added alongside it
            $file.containers.'sei:acc-desires-001' | Should -Not -BeNullOrEmpty

            # Second run on unchanged inputs is a byte-stable no-op — node:* still preserved.
            $hash1 = (Get-FileHash -LiteralPath $script:outPath -Algorithm SHA256).Hash
            $r2 = Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -SummariesPath @() -OutputPath $script:outPath
            $r2.Unchanged | Should -BeTrue
            (Get-FileHash -LiteralPath $script:outPath -Algorithm SHA256).Hash | Should -Be $hash1
        }

        It 'Absent SEI file is non-fatal (empty index, no throw)' {
            $r = Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath (Join-Path $script:root 'nope.json') -SummariesPath @() -OutputPath $script:outPath
            $r.ContainerCount | Should -Be 0
        }
    }

    Context 'Summary containers (t/3122, §4/R2.2 T2)' {

        It 'Indexes key_points as summary:<doc_id>#<pov>-kp-<n> with <n> reset PER POV (CL ruling p/23#220-221)' {
            $summPath = Join-Path $script:root 'doc1.json'
            # safetyist has TWO key_points so its index runs 0,1; skeptic then RESETS to 0.
            # Under the old running-counter scheme skeptic's point would have been kp-3 — this
            # asserts the per-POV reset, i.e. an insert/remove in one POV can't renumber another.
            New-Summary -Path $summPath -Doc @{
                doc_id        = 'doc1'
                pov_summaries = [ordered]@{
                    accelerationist = @{ key_points = @(@{ point = 'No entity here.' }) }
                    safetyist       = @{ key_points = @(
                            @{ point = 'The Apollo Project reshaped ambition.' },
                            @{ point = 'Apollo again, a second safetyist point.' }
                        ) }
                    skeptic         = @{ key_points = @(@{ point = 'Also mentions Apollo alone.' }) }
                }
            }

            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath (Join-Path $script:root 'no-sei.json') -SummariesPath @($summPath) -OutputPath $script:outPath | Out-Null

            $file = Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json
            # accelerationist #acc-kp-0 has no entity → omitted (absence == "no links yet")
            $file.containers.PSObject.Properties['summary:doc1#acc-kp-0'] | Should -BeNullOrEmpty
            # safetyist indexes reset to 0 within its own array: saf-kp-0 (Apollo Project) + saf-kp-1 (Apollo)
            $sk0 = $file.containers.'summary:doc1#saf-kp-0'
            $sk0 | Should -Not -BeNullOrEmpty
            @($sk0.mentions).entity_ref | Should -Contain 'ent-001'
            $sk1 = $file.containers.'summary:doc1#saf-kp-1'
            $sk1 | Should -Not -BeNullOrEmpty
            @($sk1.mentions).entity_ref | Should -Contain 'ent-002'
            # skeptic RESETS to 0 (skp-kp-0), proving it is not a document-wide running counter
            $sp0 = $file.containers.'summary:doc1#skp-kp-0'
            $sp0 | Should -Not -BeNullOrEmpty
            @($sp0.mentions).entity_ref | Should -Contain 'ent-002'
            # the retired running-counter ids must NOT exist
            $file.containers.PSObject.Properties['summary:doc1#kp-1'] | Should -BeNullOrEmpty
            $file.containers.PSObject.Properties['summary:doc1#kp-2'] | Should -BeNullOrEmpty
        }

        It 'Indexes factual_claims as summary:<doc_id>#fc-<n> by array position' {
            $summPath = Join-Path $script:root 'doc2.json'
            New-Summary -Path $summPath -Doc @{
                doc_id         = 'doc2'
                factual_claims = @(
                    @{ claim = 'Unrelated claim.' },
                    @{ claim = 'The Apollo Project launched in 1961.' }
                )
            }

            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath (Join-Path $script:root 'no-sei.json') -SummariesPath @($summPath) -OutputPath $script:outPath | Out-Null

            $file = Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json
            $file.containers.PSObject.Properties['summary:doc2#fc-0'] | Should -BeNullOrEmpty
            $fc1 = $file.containers.'summary:doc2#fc-1'
            $fc1 | Should -Not -BeNullOrEmpty
            $m = @($fc1.mentions)
            $m.Count | Should -Be 1
            $m[0].entity_ref | Should -Be 'ent-001'
            $m[0].quote | Should -Be 'Apollo Project'
            $m[0].discovered_by | Should -Be 'alias'
        }

        It 'Reused mention record shape: entity_ref/quote/offset/discovered_by only' {
            $summPath = Join-Path $script:root 'doc3.json'
            New-Summary -Path $summPath -Doc @{
                doc_id         = 'doc3'
                factual_claims = @(@{ claim = 'Apollo Project.' })
            }
            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath (Join-Path $script:root 'no-sei.json') -SummariesPath @($summPath) -OutputPath $script:outPath | Out-Null

            $file = Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json
            $m = $file.containers.'summary:doc3#fc-0'.mentions[0]
            ($m.PSObject.Properties.Name | Sort-Object) | Should -Be @('discovered_by', 'entity_ref', 'offset', 'quote')
        }

        It 'Second run on unchanged summary input is a byte-stable no-op (idempotent)' {
            $summPath = Join-Path $script:root 'doc4.json'
            New-Summary -Path $summPath -Doc @{
                doc_id         = 'doc4'
                factual_claims = @(@{ claim = 'Apollo Project.' })
            }
            $r1 = Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath (Join-Path $script:root 'no-sei.json') -SummariesPath @($summPath) -OutputPath $script:outPath
            $r1.Written | Should -BeTrue
            $hash1 = (Get-FileHash -LiteralPath $script:outPath -Algorithm SHA256).Hash

            $r2 = Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath (Join-Path $script:root 'no-sei.json') -SummariesPath @($summPath) -OutputPath $script:outPath
            $r2.Unchanged | Should -BeTrue
            $r2.Written | Should -BeFalse
            (Get-FileHash -LiteralPath $script:outPath -Algorithm SHA256).Hash | Should -Be $hash1
        }

        It 'A summary file missing doc_id is skipped (non-fatal)' {
            $summPath = Join-Path $script:root 'nodocid.json'
            New-Summary -Path $summPath -Doc @{ factual_claims = @(@{ claim = 'Apollo Project.' }) }
            $r = Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath (Join-Path $script:root 'no-sei.json') -SummariesPath @($summPath) -OutputPath $script:outPath
            $r.ContainerCount | Should -Be 0
        }

        It '-SummariesPath @() skips summary containers entirely' {
            $summPath = Join-Path $script:root 'doc6.json'
            New-Summary -Path $summPath -Doc @{ doc_id = 'doc6'; factual_claims = @(@{ claim = 'Apollo Project.' }) }
            # Explicit -SummariesPath overrides default discovery; passing a non-empty array but then
            # verifying an empty array truly yields zero summary containers.
            $r = Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath (Join-Path $script:root 'no-sei.json') -SummariesPath @() -OutputPath $script:outPath
            $r.ContainerCount | Should -Be 0
        }
    }

    Context 'Reconstruction byte layout (C/E parity)' {
        # These offsets prove the recipe's byte layout: absent fields omit entirely (no empty
        # segment / hanging delimiter), fixed field order, join-not-terminate (no trailing
        # delimiter). C/E must reproduce this exactly or text_sha256 mismatches and offsets shift.
        # (The node: recipe's byte layout is covered directly by the golden-fixture parity
        # context below — it is no longer reachable through this cmdlet after the t/3160 G7
        # node:* boundary move.)

        It 'sei: omits an empty claim with a single \n join, no trailing delimiter' {
            New-Sei -Path $script:seiPath -Map @{
                'n1' = @{ facts = @(
                        @{ claim = 'First fact.'; doc_id = 'd1' },
                        @{ claim = ''; doc_id = 'd2' },
                        @{ claim = 'Apollo Project here.'; doc_id = 'd3' }
                    ) }
            }
            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -SummariesPath @() -OutputPath $script:outPath | Out-Null

            $m = @((Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json).containers.'sei:n1'.mentions)
            $m.Count | Should -Be 1
            # "First fact."(11) + "\n"(1) = 12. The empty middle claim must not add a blank segment.
            $m[0].offset | Should -Be 12
        }
    }

    Context 'ShouldProcess' {

        It '-WhatIf does not write the file' {
            New-Sei -Path $script:seiPath -Map @{ 'n1' = @{ facts = @(@{ claim = 'Apollo Project.'; doc_id = 'd1' }) } }
            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -SummariesPath @() -OutputPath $script:outPath -WhatIf | Out-Null
            Test-Path -LiteralPath $script:outPath | Should -BeFalse
        }
    }

    Context 'Status filter (t/1982)' {
        BeforeEach {
            # One approved + one proposed entity, each with a distinct alias present in the text.
            # Also a record with NO status field (must be treated as un-indexable).
            $mixed = [ordered]@{
                _schema_version = '1.0.0'; _doc = 'test'; entity_count = 3; last_modified = '2026-07-29'
                entities        = @(
                    [ordered]@{ id = 'ent-100'; name = 'Manhattan Project'; aliases = $null; entity_type = 'event'; status = 'approved' }
                    [ordered]@{ id = 'ent-200'; name = 'Stargate'; aliases = $null; entity_type = 'event'; status = 'proposed' }
                    [ordered]@{ id = 'ent-300'; name = 'Skunkworks'; aliases = $null; entity_type = 'event' }  # no status
                )
            }
            ($mixed | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $script:entPath -Encoding utf8NoBOM
            New-Sei -Path $script:seiPath -Map @{
                'n1' = @{ facts = @(@{ claim = 'The Manhattan Project, Stargate, and Skunkworks all mattered.'; doc_id = 'd1' }) }
            }
        }

        It 'Default indexes ONLY approved entities (proposed + status-less skipped)' {
            $r = Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -SummariesPath @() -OutputPath $script:outPath
            $r.IndexedStatus | Should -Be @('approved')

            $file = Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json
            $file.indexed_status | Should -Be @('approved')
            $m = @($file.containers.'sei:n1'.mentions)
            $m.Count | Should -Be 1
            $m[0].entity_ref | Should -Be 'ent-100'
        }

        It '-Status proposed indexes ONLY the proposed entity' {
            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -SummariesPath @() -OutputPath $script:outPath -Status proposed | Out-Null
            $file = Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json
            $file.indexed_status | Should -Be @('proposed')
            $m = @($file.containers.'sei:n1'.mentions)
            $m.Count | Should -Be 1
            $m[0].entity_ref | Should -Be 'ent-200'
        }

        It '-Status approved,proposed (the explicit preview) indexes both, and records both in the envelope' {
            $r = Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -SummariesPath @() -OutputPath $script:outPath -Status approved, proposed
            ($r.IndexedStatus | Sort-Object) | Should -Be @('approved', 'proposed')

            $file = Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json
            # indexed_status is sorted-unique in the envelope.
            @($file.indexed_status) | Should -Be @('approved', 'proposed')
            $refs = @($file.containers.'sei:n1'.mentions.entity_ref | Sort-Object)
            $refs | Should -Be @('ent-100', 'ent-200')
            # The status-less ent-300 is still excluded even under the widened preview.
            $refs | Should -Not -Contain 'ent-300'
        }
    }

    # Cross-runtime recipe drift guard (t/1904). Reconstructs each shared golden fixture through
    # the SAME production helper the indexer uses (Get-MentionContainerText) and asserts the
    # NFC code points + sha256 match lib/entities/mentionTextFixtures.json — the identical file
    # E's vitest asserts against. Any drift between B and E (or from the spec) fails here.
    Context 'Golden-fixture recipe parity (t/1904 drift guard)' {
        $fixturePath = Join-Path $PSScriptRoot '..' 'lib' 'entities' 'mentionTextFixtures.json'
        $goldens = (Get-Content -Raw -LiteralPath $fixturePath -Encoding utf8 | ConvertFrom-Json).fixtures
        # Hashtable ForEach so <id> names each case — a drift failure must name its fixture.
        $cases = @($goldens | ForEach-Object { @{ id = $_.id; fixture = $_ } })

        It 'reconstructs to the golden NFC + sha256: <id>' -ForEach $cases {
            InModuleScope AITriad -Parameters @{ Fx = $_.fixture } {
                param($Fx)
                $fields = if ($Fx.kind -eq 'sei') {
                    @($Fx.input.claims)
                }
                else {
                    @('label', 'description', 'plain_description' | ForEach-Object {
                            if ($Fx.input.PSObject.Properties[$_]) { $Fx.input.$_ } else { $null }
                        })
                }
                $text = Get-MentionContainerText -Kind $Fx.kind -Fields $fields
                # Code-point parity (BMP-only corpus → UTF-16 unit == code point); join-compared
                # for a debuggable failure message. This is the encoding-independent check.
                $cps = @($text.ToCharArray() | ForEach-Object { [int]$_ })
                ($cps -join ',') | Should -Be (@($Fx.expected_nfc_codepoints) -join ',')
                # sha256(UTF-8) — the byte-encoding check.
                (Get-TextSha256 -Text $text) | Should -Be $Fx.expected_sha256
            }
        }
    }
}
