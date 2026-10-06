# Tag: ingestion (t/3910)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Characterization tests for Get-AITSource's FULL-SCAN (folder) path, written before the
    t/3910 complexity refactor (145 -> helpers). tests/Get-AITSource-Index.Tests.ps1 already
    covers the index fast-path, staleness detection, and index-path filters; this file covers
    the folder-scan path's filters, fallback stat computation, ModelInfo hydration, and the
    warning/skip paths, so the refactor cannot silently change any of them.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Get-AITSource -- full-scan path (t/3910 characterization)' -Tag 'ingestion' {

    BeforeEach {
        $script:SrcDir = Join-Path ([System.IO.Path]::GetTempPath()) "ait-fullscan-$([guid]::NewGuid().ToString('N').Substring(0,8))"
        $script:SumDir = Join-Path ([System.IO.Path]::GetTempPath()) "ait-fullscan-sum-$([guid]::NewGuid().ToString('N').Substring(0,8))"
        New-Item -Path $script:SrcDir -ItemType Directory -Force | Out-Null
        New-Item -Path $script:SumDir -ItemType Directory -Force | Out-Null
    }

    AfterEach {
        Remove-Item $script:SrcDir -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item $script:SumDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    BeforeAll {
        function New-FixtureDoc {
            param($Dir, $Meta)
            New-Item -Path $Dir -ItemType Directory -Force | Out-Null
            $Meta | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $Dir 'metadata.json') -Encoding utf8NoBOM
        }
    }

    It 'no sources directory at all -- Write-Warning, returns nothing' {
        $missing = Join-Path $script:SrcDir 'does-not-exist'
        InModuleScope AITriad -Parameters @{ Dir = $missing } {
            param($Dir)
            Mock Get-SourcesDir { $Dir }
            $warn = $null
            $result = Get-AITSource -WarningVariable warn -WarningAction SilentlyContinue
            $result | Should -BeNullOrEmpty
            "$warn" | Should -Match 'Sources directory not found'
        }
    }

    It 'sources directory exists but has no folders -- PRE-EXISTING BUG (t/3910 characterization, not fixed here): throws instead of warning' {
        # Get-ChildItem returns $null (not an empty array) for a truly empty directory, and
        # $null.Count throws under this function's Set-StrictMode -- the intended "no source
        # folders found" Write-Warning path is unreachable today. Pinned as-is (pure refactor
        # rule); filed separately rather than fixed here.
        InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir } {
            param($Dir)
            Mock Get-SourcesDir { $Dir }
            { Get-AITSource -WarningAction SilentlyContinue } | Should -Throw -ExceptionType ([System.Management.Automation.PropertyNotFoundException])
        }
    }

    It 'sources directory has EXACTLY ONE folder -- SAME PRE-EXISTING BUG (t/3910 characterization, not fixed here): throws' {
        # Get-ChildItem -Directory returns a BARE DirectoryInfo (not an array) for exactly one
        # match; under Set-StrictMode, .Count on that bare object also throws. So the folder-
        # count check crashes for n=0 (above) AND n=1 folders -- only n>=2 reaches .Count safely.
        New-FixtureDoc (Join-Path $script:SrcDir 'doc-only') @{ id = 'doc-only'; title = 'Only'; date_published = '2026-01-01'; date_ingested = '2026-01-02'; source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'pending' }
        InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
            param($Dir, $Sum)
            Mock Get-SourcesDir { $Dir }
            Mock Get-SummariesDir { $Sum }
            { Get-AITSource -WarningAction SilentlyContinue } | Should -Throw -ExceptionType ([System.Management.Automation.PropertyNotFoundException])
        }
    }

    It 'a malformed metadata.json is skipped with a Write-Warning, other docs still returned' {
        New-FixtureDoc (Join-Path $script:SrcDir 'doc-good') @{ id = 'doc-good'; title = 'Good'; date_published = '2026-01-01'; date_ingested = '2026-01-02'; source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'pending' }
        $badDir = Join-Path $script:SrcDir 'doc-bad'
        New-Item -Path $badDir -ItemType Directory -Force | Out-Null
        Set-Content -Path (Join-Path $badDir 'metadata.json') -Value '{ not valid json' -Encoding utf8NoBOM

        InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
            param($Dir, $Sum)
            Mock Get-SourcesDir { $Dir }
            Mock Get-SummariesDir { $Sum }
            $warn = $null
            $result = Get-AITSource -WarningVariable warn -WarningAction SilentlyContinue
            @($result).Count | Should -Be 1
            $result[0].Id | Should -Be 'doc-good'
            "$warn" | Should -Match 'Failed to parse'
        }
    }

    It 'a folder with no metadata.json is silently skipped (no warning, no error)' {
        New-FixtureDoc (Join-Path $script:SrcDir 'doc-good') @{ id = 'doc-good'; title = 'Good'; date_published = '2026-01-01'; date_ingested = '2026-01-02'; source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'pending' }
        New-Item -Path (Join-Path $script:SrcDir 'doc-no-meta') -ItemType Directory -Force | Out-Null

        InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
            param($Dir, $Sum)
            Mock Get-SourcesDir { $Dir }
            Mock Get-SummariesDir { $Sum }
            $result = Get-AITSource -WarningAction SilentlyContinue
            @($result).Count | Should -Be 1
        }
    }

    It 'no doc matches the filters -- Write-Warning, returns nothing' {
        New-FixtureDoc (Join-Path $script:SrcDir 'doc-a') @{ id = 'doc-a'; title = 'A'; date_published = '2026-01-01'; date_ingested = '2026-01-02'; source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'pending' }
        New-FixtureDoc (Join-Path $script:SrcDir 'doc-a-filler') @{ id = 'doc-a-filler'; title = 'Filler'; date_published = '2025-01-01'; date_ingested = '2025-01-02'; source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'pending' }

        InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
            param($Dir, $Sum)
            Mock Get-SourcesDir { $Dir }
            Mock Get-SummariesDir { $Sum }
            $warn = $null
            $result = Get-AITSource -Status 'current' -WarningVariable warn -WarningAction SilentlyContinue
            $result | Should -BeNullOrEmpty
            "$warn" | Should -Match 'No sources matched'
        }
    }

    Context 'filters, folder-scan path' {
        BeforeEach {
            New-FixtureDoc (Join-Path $script:SrcDir 'doc-alpha') @{
                id = 'doc-alpha'; title = 'Alpha Safety Review'; date_published = '2026-01-15'; date_ingested = '2026-05-20'
                source_type = 'pdf'; pov_tags = @('safetyist'); topic_tags = @('alignment'); summary_status = 'current'
            }
            New-FixtureDoc (Join-Path $script:SrcDir 'doc-beta') @{
                id = 'doc-beta'; title = 'Beta Growth Thesis'; date_published = '2026-03-10'; date_ingested = '2026-05-20'
                source_type = 'web_article'; pov_tags = @('accelerationist'); topic_tags = @('governance'); summary_status = 'pending'
            }
        }

        It 'DocId wildcard' {
            InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
                param($Dir, $Sum)
                Mock Get-SourcesDir { $Dir }; Mock Get-SummariesDir { $Sum }
                $r = Get-AITSource 'doc-al*' -WarningAction SilentlyContinue
                @($r).Count | Should -Be 1
                $r[0].Id | Should -Be 'doc-alpha'
            }
        }

        It 'Title accepts MULTIPLE patterns, matches if ANY pattern matches' {
            InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
                param($Dir, $Sum)
                Mock Get-SourcesDir { $Dir }; Mock Get-SummariesDir { $Sum }
                $r = Get-AITSource -Title '*safety*', '*growth*' -WarningAction SilentlyContinue
                @($r).Count | Should -Be 2
            }
        }

        It 'Pov filter' {
            InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
                param($Dir, $Sum)
                Mock Get-SourcesDir { $Dir }; Mock Get-SummariesDir { $Sum }
                $r = Get-AITSource -Pov 'accelerationist' -WarningAction SilentlyContinue
                @($r).Count | Should -Be 1
                $r[0].Id | Should -Be 'doc-beta'
            }
        }

        It 'Topic filter' {
            InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
                param($Dir, $Sum)
                Mock Get-SourcesDir { $Dir }; Mock Get-SummariesDir { $Sum }
                $r = Get-AITSource -Topic 'alignment' -WarningAction SilentlyContinue
                @($r).Count | Should -Be 1
                $r[0].Id | Should -Be 'doc-alpha'
            }
        }

        It 'Status filter' {
            InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
                param($Dir, $Sum)
                Mock Get-SourcesDir { $Dir }; Mock Get-SummariesDir { $Sum }
                $r = Get-AITSource -Status 'pending' -WarningAction SilentlyContinue
                @($r).Count | Should -Be 1
                $r[0].Id | Should -Be 'doc-beta'
            }
        }

        It 'SourceType filter' {
            InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
                param($Dir, $Sum)
                Mock Get-SourcesDir { $Dir }; Mock Get-SummariesDir { $Sum }
                $r = Get-AITSource -SourceType 'web_article' -WarningAction SilentlyContinue
                @($r).Count | Should -Be 1
                $r[0].Id | Should -Be 'doc-beta'
            }
        }

        It 'Today filter' {
            InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
                param($Dir, $Sum)
                Mock Get-SourcesDir { $Dir }; Mock Get-SummariesDir { $Sum }
                $r = Get-AITSource -Today -WarningAction SilentlyContinue
                $r | Should -BeNullOrEmpty -Because 'fixtures are dated 2026-05-20, not today'
            }
        }
    }

    Context 'stats fallback computation (metadata has no cached total_claims)' {
        It 'computes TotalClaims/ClaimsByPov/TotalFacts/UnmappedConcepts from the summary file' {
            New-FixtureDoc (Join-Path $script:SrcDir 'doc-x') @{
                id = 'doc-x'; title = 'X'; date_published = '2026-01-01'; date_ingested = '2026-01-02'
                source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'current'
            }
            New-FixtureDoc (Join-Path $script:SrcDir 'doc-x-filler') @{ id = 'doc-x-filler'; title = 'Filler'; date_published = '2025-01-01'; date_ingested = '2025-01-02'; source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'pending' }
            @{
                factual_claims = @(
                    @{ linked_taxonomy_nodes = @('acc-beliefs-001', 'saf-beliefs-002') },
                    @{ linked_taxonomy_nodes = @('skp-beliefs-003') },
                    @{ linked_taxonomy_nodes = @() }
                )
                pov_summaries = @{
                    accelerationist = @{ key_points = @('p1', 'p2') }
                    safetyist       = @{ key_points = @('p1') }
                    skeptic         = @{ key_points = @() }
                }
                unmapped_concepts = @('concept-a', 'concept-b')
            } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $script:SumDir 'doc-x.json') -Encoding utf8NoBOM

            InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
                param($Dir, $Sum)
                Mock Get-SourcesDir { $Dir }; Mock Get-SummariesDir { $Sum }
                $r = @(Get-AITSource -WarningAction SilentlyContinue) | Where-Object Id -eq 'doc-x'
                $r.TotalClaims | Should -Be 3
                $r.ClaimsByPov.Accelerationist | Should -Be 1
                $r.ClaimsByPov.Safetyist | Should -Be 1
                $r.ClaimsByPov.Skeptic | Should -Be 1
                $r.TotalFacts | Should -Be 3
                $r.UnmappedConcepts | Should -Be 2
            }
        }

        It 'prefers CACHED metadata stats over recomputing from the summary file' {
            New-FixtureDoc (Join-Path $script:SrcDir 'doc-y') @{
                id = 'doc-y'; title = 'Y'; date_published = '2026-01-01'; date_ingested = '2026-01-02'
                source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'current'
                total_claims = 99; total_facts = 42; unmapped_concepts = 7
                claims_by_pov = @{ accelerationist = 10; safetyist = 20; skeptic = 30; situations = 40 }
            }
            New-FixtureDoc (Join-Path $script:SrcDir 'doc-y-filler') @{ id = 'doc-y-filler'; title = 'Filler'; date_published = '2025-01-01'; date_ingested = '2025-01-02'; source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'pending' }
            @{ factual_claims = @(@{ linked_taxonomy_nodes = @('acc-beliefs-001') }) } |
                ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $script:SumDir 'doc-y.json') -Encoding utf8NoBOM

            InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
                param($Dir, $Sum)
                Mock Get-SourcesDir { $Dir }; Mock Get-SummariesDir { $Sum }
                $r = @(Get-AITSource -WarningAction SilentlyContinue) | Where-Object Id -eq 'doc-y'
                $r.TotalClaims | Should -Be 99
                $r.ClaimsByPov.Situations | Should -Be 40
            }
        }

        It 'legacy claims_by_pov key is used when node_references_by_pov is absent' {
            New-FixtureDoc (Join-Path $script:SrcDir 'doc-z') @{
                id = 'doc-z'; title = 'Z'; date_published = '2026-01-01'; date_ingested = '2026-01-02'
                source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'current'
                total_claims = 5; claims_by_pov = @{ accelerationist = 1; safetyist = 2; skeptic = 3; situations = 4 }
            }
            New-FixtureDoc (Join-Path $script:SrcDir 'doc-z-filler') @{ id = 'doc-z-filler'; title = 'Filler'; date_published = '2025-01-01'; date_ingested = '2025-01-02'; source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'pending' }
            InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
                param($Dir, $Sum)
                Mock Get-SourcesDir { $Dir }; Mock Get-SummariesDir { $Sum }
                $r = @(Get-AITSource -WarningAction SilentlyContinue) | Where-Object Id -eq 'doc-z'
                $r.ClaimsByPov.Skeptic | Should -Be 3
            }
        }

        It 'metadata has no cached stats AND the summary lacks factual_claims -- PRE-EXISTING BUG (t/3910 characterization, not fixed here): throws' {
            # $Summary.factual_claims is a direct dot-access with no PSObject.Properties guard.
            # Under this function's Set-StrictMode, accessing a genuinely-absent property on a
            # ConvertFrom-Json PSCustomObject throws instead of returning $null -- exactly the
            # documented "guard property access" hazard (docs/powershell-strict-mode.md). Any
            # summary with no total_claims cached in metadata AND no factual_claims key (e.g. a
            # model_info-only or ai_model-only summary) hits this.
            New-FixtureDoc (Join-Path $script:SrcDir 'doc-nofc') @{
                id = 'doc-nofc'; title = 'NoFC'; date_published = '2026-01-01'; date_ingested = '2026-01-02'
                source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'current'
            }
            New-FixtureDoc (Join-Path $script:SrcDir 'doc-nofc-filler') @{ id = 'doc-nofc-filler'; title = 'Filler'; date_published = '2025-01-01'; date_ingested = '2025-01-02'; source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'pending' }
            @{ some_other_field = 'x' } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $script:SumDir 'doc-nofc.json') -Encoding utf8NoBOM

            InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
                param($Dir, $Sum)
                Mock Get-SourcesDir { $Dir }; Mock Get-SummariesDir { $Sum }
                { Get-AITSource -WarningAction SilentlyContinue } | Should -Throw -ExceptionType ([System.Management.Automation.PropertyNotFoundException])
            }
        }
    }

    Context 'ModelInfo hydration' {
        It 'hydrates from the new model_info format' {
            # total_claims = 0 (cached) keeps this test isolated from the separate pre-existing
            # fallback-stats bug below -- ModelInfo hydration is unrelated to that code path.
            New-FixtureDoc (Join-Path $script:SrcDir 'doc-mi') @{
                id = 'doc-mi'; title = 'MI'; date_published = '2026-01-01'; date_ingested = '2026-01-02'
                source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'current'
                total_claims = 0
            }
            New-FixtureDoc (Join-Path $script:SrcDir 'doc-mi-filler') @{ id = 'doc-mi-filler'; title = 'Filler'; date_published = '2025-01-01'; date_ingested = '2025-01-02'; source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'pending' }
            @{
                model_info = @{
                    model = 'gemini-3.5-flash-lite'; temperature = 0.2; max_tokens = 4096
                    extraction_mode = 'fire'; taxonomy_filter = 'none'; taxonomy_nodes = 10
                    fire_confidence_threshold = 0.7; chunked = $true; chunk_count = 3
                    fire_stats = @{ retries = 1 }
                }
            } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $script:SumDir 'doc-mi.json') -Encoding utf8NoBOM

            InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
                param($Dir, $Sum)
                Mock Get-SourcesDir { $Dir }; Mock Get-SummariesDir { $Sum }
                $r = @(Get-AITSource -WarningAction SilentlyContinue) | Where-Object Id -eq 'doc-mi'
                $r.ModelInfo.Model | Should -Be 'gemini-3.5-flash-lite'
                $r.ModelInfo.Chunked | Should -BeTrue
                $r.ModelInfo.ChunkCount | Should -Be 3
                $r.ModelInfo.FireStats.retries | Should -Be 1
            }
        }

        It 'hydrates from the LEGACY ai_model format when model_info is absent' {
            New-FixtureDoc (Join-Path $script:SrcDir 'doc-legacy') @{
                id = 'doc-legacy'; title = 'Legacy'; date_published = '2026-01-01'; date_ingested = '2026-01-02'
                source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'current'
                total_claims = 0
            }
            New-FixtureDoc (Join-Path $script:SrcDir 'doc-legacy-filler') @{ id = 'doc-legacy-filler'; title = 'Filler'; date_published = '2025-01-01'; date_ingested = '2025-01-02'; source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'pending' }
            @{ ai_model = 'claude-sonnet-5'; temperature = 0.5 } |
                ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $script:SumDir 'doc-legacy.json') -Encoding utf8NoBOM

            InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
                param($Dir, $Sum)
                Mock Get-SourcesDir { $Dir }; Mock Get-SummariesDir { $Sum }
                $r = @(Get-AITSource -WarningAction SilentlyContinue) | Where-Object Id -eq 'doc-legacy'
                $r.ModelInfo.Model | Should -Be 'claude-sonnet-5'
                $r.ModelInfo.Temperature | Should -Be 0.5
            }
        }

        It 'ModelInfo is $null when no summary file exists' {
            New-FixtureDoc (Join-Path $script:SrcDir 'doc-nosum') @{
                id = 'doc-nosum'; title = 'NoSum'; date_published = '2026-01-01'; date_ingested = '2026-01-02'
                source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'current'
            }
            New-FixtureDoc (Join-Path $script:SrcDir 'doc-nosum-filler') @{ id = 'doc-nosum-filler'; title = 'Filler'; date_published = '2025-01-01'; date_ingested = '2025-01-02'; source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'pending' }
            InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
                param($Dir, $Sum)
                Mock Get-SourcesDir { $Dir }; Mock Get-SummariesDir { $Sum }
                $r = @(Get-AITSource -WarningAction SilentlyContinue) | Where-Object Id -eq 'doc-nosum'
                $r.ModelInfo | Should -BeNullOrEmpty
            }
        }

        It 'a malformed summary file is tolerated -- Write-Verbose, ModelInfo/stats stay default' {
            New-FixtureDoc (Join-Path $script:SrcDir 'doc-badsum') @{
                id = 'doc-badsum'; title = 'BadSum'; date_published = '2026-01-01'; date_ingested = '2026-01-02'
                source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'current'
            }
            New-FixtureDoc (Join-Path $script:SrcDir 'doc-badsum-filler') @{ id = 'doc-badsum-filler'; title = 'Filler'; date_published = '2025-01-01'; date_ingested = '2025-01-02'; source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'pending' }
            Set-Content -Path (Join-Path $script:SumDir 'doc-badsum.json') -Value '{ not valid json' -Encoding utf8NoBOM

            InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
                param($Dir, $Sum)
                Mock Get-SourcesDir { $Dir }; Mock Get-SummariesDir { $Sum }
                { Get-AITSource -WarningAction SilentlyContinue } | Should -Not -Throw
                $r = @(Get-AITSource -WarningAction SilentlyContinue) | Where-Object Id -eq 'doc-badsum'
                $r.ModelInfo | Should -BeNullOrEmpty
                $r.TotalClaims | Should -Be 0
            }
        }
    }

    Context 'MDPath / snapshot detection' {
        It 'MDPath is set when snapshot.md exists, $null otherwise' {
            $withSnap = Join-Path $script:SrcDir 'doc-snap'
            New-FixtureDoc $withSnap @{ id = 'doc-snap'; title = 'Snap'; date_published = '2026-01-01'; date_ingested = '2026-01-02'; source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'current' }
            Set-Content -Path (Join-Path $withSnap 'snapshot.md') -Value '# snap'

            New-FixtureDoc (Join-Path $script:SrcDir 'doc-nosnap') @{ id = 'doc-nosnap'; title = 'NoSnap'; date_published = '2026-01-01'; date_ingested = '2026-01-02'; source_type = 'pdf'; pov_tags = @(); topic_tags = @(); summary_status = 'current' }

            InModuleScope AITriad -Parameters @{ Dir = $script:SrcDir; Sum = $script:SumDir } {
                param($Dir, $Sum)
                Mock Get-SourcesDir { $Dir }; Mock Get-SummariesDir { $Sum }
                $r = Get-AITSource -WarningAction SilentlyContinue
                ($r | Where-Object Id -eq 'doc-snap').MDPath | Should -Match 'snapshot\.md$'
                ($r | Where-Object Id -eq 'doc-nosnap').MDPath | Should -BeNullOrEmpty
            }
        }
    }
}
