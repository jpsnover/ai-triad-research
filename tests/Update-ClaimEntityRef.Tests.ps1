# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# t/3124 — claim-side entity grounding. No-mock fixture pattern: every call passes explicit
# -EntitiesPath / -SummariesPath under $TestDrive, so no Private path-helper mocking is needed.
# Entity resolution is PRECISE-ONLY (surface/alias -> linked EntityLinkRef), mirroring CL's
# node reconciler; there is deliberately no entity-embedding rung (§13.3).

Describe 'Update-ClaimEntityRef (t/3124)' -Tag 'unit', 'entity' {
    BeforeAll {
        Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

        function New-Entities {
            param([string]$Path)
            # ent-001 has an alias; ent-002 is a short overlapping name; 'AI' is a 2-char
            # surface that MUST be dropped by the len>2 guard.
            $entities = [ordered]@{
                _schema_version = '1.0.0'
                _doc            = 'test'
                entity_count    = 3
                last_modified   = '2026-07-28'
                entities        = @(
                    [ordered]@{ id = 'ent-001'; name = 'Apollo Project'; aliases = @('Apollo Program'); entity_type = 'event'; dolce_category = 'perdurant'; status = 'approved' }
                    [ordered]@{ id = 'ent-002'; name = 'GDPR'; aliases = $null; entity_type = 'legislation'; dolce_category = 'normative-description'; status = 'approved' }
                    [ordered]@{ id = 'ent-003'; name = 'AI'; aliases = $null; entity_type = 'artifact'; dolce_category = 'non-agentive-functional-artifact'; status = 'approved' }
                    [ordered]@{ id = 'ent-099'; name = 'Manhattan Project'; aliases = $null; entity_type = 'event'; dolce_category = 'perdurant'; status = 'proposed' }
                )
            }
            ($entities | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
        }

        function New-Summary {
            param([hashtable]$Doc, [string]$Path)
            ($Doc | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
        }
    }

    BeforeEach {
        $script:root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:root -Force | Out-Null
        $script:entPath = Join-Path $script:root 'entities.json'
        $script:sumPath = Join-Path $script:root '170306856v3-2026.json'
        New-Entities -Path $script:entPath
    }

    Context 'Surface/alias resolution onto claims' {

        It 'Writes an EntityLinkRef with the full shape on a key_point (alias hit)' {
            New-Summary -Path $script:sumPath -Doc @{
                doc_id        = 'd1'
                pov_summaries = @{
                    accelerationist = @{ key_points = @(@{ point = 'The Apollo Program reshaped ambition and GDPR followed.' }) }
                }
                factual_claims = @()
            }

            $r = Update-ClaimEntityRef -EntitiesPath $script:entPath -SummariesPath $script:sumPath
            $r.FilesWritten | Should -Be 1
            $r.RefsWritten  | Should -Be 2

            $doc = Get-Content -Raw -LiteralPath $script:sumPath -Encoding utf8 | ConvertFrom-Json
            $refs = @($doc.pov_summaries.accelerationist.key_points[0].entity_refs)
            $refs.Count | Should -Be 2
            # Ordered by first-match offset: 'Apollo Program' (offset 4) before 'GDPR'.
            $refs[0].ref             | Should -Be 'ent-001'
            $refs[0].surface         | Should -Be 'Apollo Program'
            $refs[0].method          | Should -Be 'alias'
            $refs[0].link_confidence | Should -Be 1.0
            $refs[0].match_level     | Should -Be 'exact'
            $refs[0].status          | Should -Be 'linked'
            $refs[1].ref             | Should -Be 'ent-002'
            $refs[1].method          | Should -Be 'exact'
        }

        It 'Resolves factual_claims by the .claim field' {
            New-Summary -Path $script:sumPath -Doc @{
                doc_id         = 'd1'
                pov_summaries  = @{}
                factual_claims = @(
                    @{ claim = 'The Apollo Project cost billions.' }
                    @{ claim = 'Nothing to see here.' }
                )
            }

            Update-ClaimEntityRef -EntitiesPath $script:entPath -SummariesPath $script:sumPath | Out-Null
            $doc = Get-Content -Raw -LiteralPath $script:sumPath -Encoding utf8 | ConvertFrom-Json
            @($doc.factual_claims[0].entity_refs).Count | Should -Be 1
            $doc.factual_claims[0].entity_refs[0].ref | Should -Be 'ent-001'
            $doc.factual_claims[0].entity_refs[0].method | Should -Be 'exact'
            # A claim with no entity gets NO entity_refs property (absence, not empty array).
            $doc.factual_claims[1].PSObject.Properties['entity_refs'] | Should -BeNullOrEmpty
        }

        It 'Drops surfaces of 2 chars or fewer (no "AI" false links)' {
            New-Summary -Path $script:sumPath -Doc @{
                doc_id         = 'd1'
                pov_summaries  = @{ accelerationist = @{ key_points = @(@{ point = 'AI is everywhere in AI.' }) } }
                factual_claims = @()
            }
            $r = Update-ClaimEntityRef -EntitiesPath $script:entPath -SummariesPath $script:sumPath
            $r.RefsWritten | Should -Be 0
            $doc = Get-Content -Raw -LiteralPath $script:sumPath -Encoding utf8 | ConvertFrom-Json
            $doc.pov_summaries.accelerationist.key_points[0].PSObject.Properties['entity_refs'] | Should -BeNullOrEmpty
        }

        It 'Only links approved entities by default (proposed excluded)' {
            New-Summary -Path $script:sumPath -Doc @{
                doc_id         = 'd1'
                pov_summaries  = @{ accelerationist = @{ key_points = @(@{ point = 'The Manhattan Project was secret.' }) } }
                factual_claims = @()
            }
            $r = Update-ClaimEntityRef -EntitiesPath $script:entPath -SummariesPath $script:sumPath
            $r.RefsWritten | Should -Be 0

            # With -Status proposed, ent-099 becomes eligible.
            $r2 = Update-ClaimEntityRef -EntitiesPath $script:entPath -SummariesPath $script:sumPath -Status proposed
            $r2.RefsWritten | Should -Be 1
            $doc = Get-Content -Raw -LiteralPath $script:sumPath -Encoding utf8 | ConvertFrom-Json
            $doc.pov_summaries.accelerationist.key_points[0].entity_refs[0].ref | Should -Be 'ent-099'
        }
    }

    Context 'Idempotency + change detection' {

        It 'Second run over unchanged text writes nothing' {
            New-Summary -Path $script:sumPath -Doc @{
                doc_id         = 'd1'
                pov_summaries  = @{ accelerationist = @{ key_points = @(@{ point = 'The Apollo Project endures.' }) } }
                factual_claims = @()
            }
            (Update-ClaimEntityRef -EntitiesPath $script:entPath -SummariesPath $script:sumPath).FilesWritten | Should -Be 1
            $second = Update-ClaimEntityRef -EntitiesPath $script:entPath -SummariesPath $script:sumPath
            $second.FilesWritten | Should -Be 0
            $second.PerFile[0].Changed | Should -BeFalse
        }

        It '-Force rewrites even when unchanged' {
            New-Summary -Path $script:sumPath -Doc @{
                doc_id         = 'd1'
                pov_summaries  = @{ accelerationist = @{ key_points = @(@{ point = 'The Apollo Project endures.' }) } }
                factual_claims = @()
            }
            Update-ClaimEntityRef -EntitiesPath $script:entPath -SummariesPath $script:sumPath | Out-Null
            (Update-ClaimEntityRef -EntitiesPath $script:entPath -SummariesPath $script:sumPath -Force).FilesWritten | Should -Be 1
        }

        It 'Clears stale entity_refs when the claim no longer mentions the entity' {
            # Seed a claim with a pre-existing (now-stale) ref.
            New-Summary -Path $script:sumPath -Doc @{
                doc_id         = 'd1'
                pov_summaries  = @{ accelerationist = @{ key_points = @(@{
                                    point       = 'This text mentions nobody in the register.'
                                    entity_refs = @(@{ ref = 'ent-001'; surface = 'Apollo Project'; method = 'exact'; link_confidence = 1.0; match_level = 'exact'; status = 'linked' })
                                }) } }
                factual_claims = @()
            }
            $r = Update-ClaimEntityRef -EntitiesPath $script:entPath -SummariesPath $script:sumPath
            $r.FilesWritten | Should -Be 1
            $doc = Get-Content -Raw -LiteralPath $script:sumPath -Encoding utf8 | ConvertFrom-Json
            $doc.pov_summaries.accelerationist.key_points[0].PSObject.Properties['entity_refs'] | Should -BeNullOrEmpty
        }
    }

    Context 'Batch + safety behavior' {

        It '-WhatIf does not write the file' {
            New-Summary -Path $script:sumPath -Doc @{
                doc_id         = 'd1'
                pov_summaries  = @{ accelerationist = @{ key_points = @(@{ point = 'The Apollo Project endures.' }) } }
                factual_claims = @()
            }
            $before = Get-Content -Raw -LiteralPath $script:sumPath -Encoding utf8
            Update-ClaimEntityRef -EntitiesPath $script:entPath -SummariesPath $script:sumPath -WhatIf | Out-Null
            (Get-Content -Raw -LiteralPath $script:sumPath -Encoding utf8) | Should -Be $before
        }

        It 'Skips an unparseable summary without aborting the batch' {
            $bad = Join-Path $script:root 'bad.json'
            'this is not json {' | Set-Content -LiteralPath $bad -Encoding utf8NoBOM
            New-Summary -Path $script:sumPath -Doc @{
                doc_id         = 'd1'
                pov_summaries  = @{ accelerationist = @{ key_points = @(@{ point = 'The Apollo Project endures.' }) } }
                factual_claims = @()
            }
            $r = Update-ClaimEntityRef -EntitiesPath $script:entPath -SummariesPath @($bad, $script:sumPath) -WarningAction SilentlyContinue
            $r.FilesWritten | Should -Be 1
        }
    }

    Context 'Document shape is preserved on write (t/3124 follow-up)' {

        It 'Does NOT mutate measured_at / generated_at when appending entity_refs' {
            # These fields have timezone offsets + fractional seconds that PS 7.4 ConvertFrom-Json
            # would coerce to [datetime] and re-emit in a different offset. The write must touch
            # ONLY entity_refs. New-Summary via ConvertTo-Json emits these as strings, matching how
            # Invoke-DocumentSummary writes real summaries.
            New-Summary -Path $script:sumPath -Doc @{
                doc_id        = 'd1'
                generated_at  = '2026-05-02T20:38:45.7336380-04:00'
                context_rot   = @{ measured_at = '2026-05-02T20:38:45.7336380-04:00' }
                pov_summaries = @{ accelerationist = @{ key_points = @(@{ point = 'The Apollo Project endures.' }) } }
                factual_claims = @()
            }

            $r = Update-ClaimEntityRef -EntitiesPath $script:entPath -SummariesPath $script:sumPath
            $r.RefsWritten | Should -Be 1   # proves the write actually happened

            # Re-read the RAW string values (not the coerced form) and assert byte-identity.
            $after = Get-Content -Raw -LiteralPath $script:sumPath -Encoding utf8
            $after | Should -BeLike '*"generated_at": "2026-05-02T20:38:45.7336380-04:00"*'
            $after | Should -BeLike '*"measured_at": "2026-05-02T20:38:45.7336380-04:00"*'
            # And the entity_ref was in fact added.
            $after | Should -BeLike '*"entity_refs"*ent-001*'
        }

        It 'Does NOT collapse a single-element array (vocabulary_terms) to a scalar' {
            # ConvertFrom-Json unwraps ["x"] -> "x"; a whole-file re-serialize would then persist
            # the scalar, silently changing the schema of an untargeted field. -Depth 12 keeps the
            # 1-element array intact in the fixture.
            $doc = @{
                doc_id        = 'd1'
                pov_summaries = @{ accelerationist = @{ key_points = @(
                            @{ point = 'The Apollo Project endures.'; vocabulary_terms = @('capabilities_scaling') }
                        ) } }
                factual_claims = @()
            }
            ($doc | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $script:sumPath -Encoding utf8NoBOM

            Update-ClaimEntityRef -EntitiesPath $script:entPath -SummariesPath $script:sumPath | Out-Null

            # Must still be an array in the raw text (the [ ] survive) — the real shape proof.
            # ('[' is a -BeLike metachar, so assert via .Contains, not -BeLike.)
            $raw = Get-Content -Raw -LiteralPath $script:sumPath -Encoding utf8
            $raw.Contains('"vocabulary_terms": [') | Should -BeTrue
            $parsed = $raw | ConvertFrom-Json
            $vt = $parsed.pov_summaries.accelerationist.key_points[0].vocabulary_terms
            $vt[0] | Should -Be 'capabilities_scaling'
        }
    }
}
