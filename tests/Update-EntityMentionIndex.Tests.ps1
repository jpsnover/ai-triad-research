# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# t/1894 Phase 2-B — batch entity mention indexer. Uses the no-mock fixture pattern:
# every call passes explicit -EntitiesPath / -SourceEvidenceIndexPath / -PovPath /
# -OutputPath under $TestDrive, so no Private path-helper mocking is required.

Describe 'Update-EntityMentionIndex (t/1894 Phase 2-B)' -Tag 'unit' {
    BeforeAll {
        Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

        function New-Sei {
            param([hashtable]$Map, [string]$Path)
            ($Map | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
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
                [ordered]@{ id = 'ent-001'; name = 'Apollo Project'; aliases = @('Apollo Program'); entity_type = 'event' }
                [ordered]@{ id = 'ent-002'; name = 'Apollo'; aliases = $null; entity_type = 'event' }
            )
        }
        ($entities | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $script:entPath -Encoding utf8NoBOM
    }

    Context 'Alias-first matching' {

        It 'Writes a schema-valid file with a correct alias mention (quote/offset/entity_ref/discovered_by)' {
            New-Sei -Path $script:seiPath -Map @{
                'acc-desires-001' = @{ facts = @(@{ claim = 'The Apollo Project reshaped ambition.'; doc_id = 'd1' }) }
            }

            $r = Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -PovPath @() -OutputPath $script:outPath
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
            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -PovPath @() -OutputPath $script:outPath | Out-Null

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
            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -PovPath @() -OutputPath $script:outPath | Out-Null

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
                    [ordered]@{ id = 'ent-010'; name = 'GPT-4o'; aliases = $null; entity_type = 'artifact' }
                    [ordered]@{ id = 'ent-011'; name = 'o4-mini'; aliases = $null; entity_type = 'artifact' }
                )
            }
            ($ents | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $script:entPath -Encoding utf8NoBOM
            New-Sei -Path $script:seiPath -Map @{
                'n1' = @{ facts = @(@{ claim = 'GPT-4o beats o4-mini but GPT-4omini is fake.'; doc_id = 'd1' }) }
            }
            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -PovPath @() -OutputPath $script:outPath | Out-Null

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
            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -PovPath @() -OutputPath $script:outPath | Out-Null

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
            $r1 = Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -PovPath @() -OutputPath $script:outPath
            $r1.Written | Should -BeTrue
            $hash1 = (Get-FileHash -LiteralPath $script:outPath -Algorithm SHA256).Hash

            $r2 = Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -PovPath @() -OutputPath $script:outPath
            $r2.Unchanged | Should -BeTrue
            $r2.Written | Should -BeFalse
            (Get-FileHash -LiteralPath $script:outPath -Algorithm SHA256).Hash | Should -Be $hash1
        }

        It '-Force rewrites even when unchanged' {
            New-Sei -Path $script:seiPath -Map @{ 'n1' = @{ facts = @(@{ claim = 'Apollo Project.'; doc_id = 'd1' }) } }
            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -PovPath @() -OutputPath $script:outPath | Out-Null
            $r = Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -PovPath @() -OutputPath $script:outPath -Force
            $r.Written | Should -BeTrue
        }
    }

    Context 'Human-authored mentions win (§5)' {

        It 'Preserves a human mention on unchanged text and suppresses an overlapping alias hit' {
            New-Sei -Path $script:seiPath -Map @{
                'n1' = @{ facts = @(@{ claim = 'The Apollo Project reshaped ambition.'; doc_id = 'd1' }) }
            }
            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -PovPath @() -OutputPath $script:outPath | Out-Null

            # Inject a human mention at the SAME offset/span as the alias hit, different ref.
            $file = Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json
            $c = $file.containers.'sei:n1'
            $c.mentions = @([ordered]@{ entity_ref = 'ent-999'; quote = 'Apollo Project'; offset = 4; discovered_by = 'human' })
            ($file | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $script:outPath -Encoding utf8NoBOM

            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -PovPath @() -OutputPath $script:outPath -Force | Out-Null

            $after = Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json
            $m = @($after.containers.'sei:n1'.mentions)
            $m.Count | Should -Be 1
            $m[0].discovered_by | Should -Be 'human'
            $m[0].entity_ref | Should -Be 'ent-999'
        }
    }

    Context 'Container sources' {

        It 'Indexes POV node label/description as node:<id> containers' {
            $povPath = Join-Path $script:root 'accelerationist.json'
            $pov = [ordered]@{
                _schema_version = '1.0.0'; pov = 'accelerationist'; last_modified = '2026-07-28'
                nodes           = @(
                    [ordered]@{ id = 'acc-beliefs-001'; category = 'Beliefs'; label = 'Apollo Project analogy'; description = 'Framed after the Apollo Program push.' }
                )
            }
            ($pov | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $povPath -Encoding utf8NoBOM

            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath (Join-Path $script:root 'missing-sei.json') -PovPath @($povPath) -OutputPath $script:outPath | Out-Null

            $file = Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json
            $c = $file.containers.'node:acc-beliefs-001'
            $c | Should -Not -BeNullOrEmpty
            @($c.mentions).Count | Should -BeGreaterOrEqual 1
            @($c.mentions).entity_ref | Should -Contain 'ent-001'
        }

        It 'Absent SEI and POV files are non-fatal (empty index, no throw)' {
            $r = Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath (Join-Path $script:root 'nope.json') -PovPath @() -OutputPath $script:outPath
            $r.ContainerCount | Should -Be 0
        }
    }

    Context 'Reconstruction byte layout (C/E parity)' {
        # These offsets prove the recipe's byte layout: absent fields omit entirely (no empty
        # segment / hanging delimiter), fixed field order, join-not-terminate (no trailing
        # delimiter). C/E must reproduce this exactly or text_sha256 mismatches and offsets shift.

        It 'node: omits an absent field with no empty segment (label + plain_description, description absent)' {
            $povPath = Join-Path $script:root 'accelerationist.json'
            # description is ABSENT; text must be "Alpha\n\nBeta Apollo Project gamma" (NOT "Alpha\n\n\n\nBeta...").
            $pov = [ordered]@{
                _schema_version = '1.0.0'; pov = 'accelerationist'; last_modified = '2026-07-28'
                nodes           = @([ordered]@{ id = 'acc-b-1'; category = 'Beliefs'; label = 'Alpha'; plain_description = 'Beta Apollo Project gamma' })
            }
            ($pov | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $povPath -Encoding utf8NoBOM
            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath (Join-Path $script:root 'no-sei.json') -PovPath @($povPath) -OutputPath $script:outPath | Out-Null

            $m = @((Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json).containers.'node:acc-b-1'.mentions)
            $m.Count | Should -Be 1
            # "Alpha"(5) + "\n\n"(2) + "Beta "(5) = 12. An empty description segment would push this to 14.
            $m[0].offset | Should -Be 12
            $m[0].quote | Should -Be 'Apollo Project'
        }

        It 'sei: omits an empty claim with a single \n join, no trailing delimiter' {
            New-Sei -Path $script:seiPath -Map @{
                'n1' = @{ facts = @(
                        @{ claim = 'First fact.'; doc_id = 'd1' },
                        @{ claim = ''; doc_id = 'd2' },
                        @{ claim = 'Apollo Project here.'; doc_id = 'd3' }
                    ) }
            }
            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -PovPath @() -OutputPath $script:outPath | Out-Null

            $m = @((Get-Content -Raw -LiteralPath $script:outPath -Encoding utf8 | ConvertFrom-Json).containers.'sei:n1'.mentions)
            $m.Count | Should -Be 1
            # "First fact."(11) + "\n"(1) = 12. The empty middle claim must not add a blank segment.
            $m[0].offset | Should -Be 12
        }
    }

    Context 'ShouldProcess' {

        It '-WhatIf does not write the file' {
            New-Sei -Path $script:seiPath -Map @{ 'n1' = @{ facts = @(@{ claim = 'Apollo Project.'; doc_id = 'd1' }) } }
            Update-EntityMentionIndex -EntitiesPath $script:entPath -SourceEvidenceIndexPath $script:seiPath -PovPath @() -OutputPath $script:outPath -WhatIf | Out-Null
            Test-Path -LiteralPath $script:outPath | Should -BeFalse
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
