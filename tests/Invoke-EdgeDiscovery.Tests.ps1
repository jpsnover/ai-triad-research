# Tag: taxonomy (t/1186)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Invoke-EdgeDiscovery edge validation — gaps 7.1-7.4.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Edge validation (gaps 7.1-7.4)' -Tag 'taxonomy' {

    It 'Rejects edges with invalid type, self-loop, unknown target, and duplicates' {
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "edge-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

            $TaxJson = @{
                nodes = @(
                    @{ id = 'acc-beliefs-001'; label = 'Node A'; description = 'Test A'; category = 'Beliefs' }
                    @{ id = 'saf-beliefs-001'; label = 'Node B'; description = 'Test B'; category = 'Beliefs' }
                )
            } | ConvertTo-Json -Depth 5
            Set-Content -Path (Join-Path $TempDir 'accelerationist.json') -Value $TaxJson
            Set-Content -Path (Join-Path $TempDir 'safetyist.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'skeptic.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'situations.json') -Value '{"nodes":[]}'

            Mock Get-TaxonomyDir { $TempDir }
            Mock Resolve-AIApiKey { 'fake-key' }

            $script:CapturedEdgesJson = $null
            Mock Write-Utf8NoBom {
                if ($Path -like '*edges.json') { $script:CapturedEdgesJson = $Value }
            }

            Mock Invoke-NodeEdgeDiscovery {
                [PSCustomObject]@{
                    NodeId       = $Node.id
                    RawEdges     = @(
                        # 1. Valid edge — should be accepted
                        [PSCustomObject]@{ target = 'saf-beliefs-001'; type = 'SUPPORTS'; confidence = 0.8; rationale = 'Valid' }
                        # 2. Invalid edge type (gap 7.2) — should be rejected
                        [PSCustomObject]@{ target = 'saf-beliefs-001'; type = 'SLIGHTLY_RELATED'; confidence = 0.9; rationale = 'Bad type' }
                        # 3. Self-loop (gap 7.3) — should be rejected
                        [PSCustomObject]@{ target = 'acc-beliefs-001'; type = 'SUPPORTS'; confidence = 0.8; rationale = 'Self' }
                        # 4. Unknown target (gap 7.1) — should be rejected
                        [PSCustomObject]@{ target = 'nonexistent-999'; type = 'SUPPORTS'; confidence = 0.8; rationale = 'Bad target' }
                        # 5. Duplicate of #1 (gap 7.4) — should be rejected
                        [PSCustomObject]@{ target = 'saf-beliefs-001'; type = 'SUPPORTS'; confidence = 0.8; rationale = 'Duplicate' }
                    )
                    NewEdgeTypes = @()
                    Error        = $null
                    ElapsedSec   = 0.5
                }
            }

            $null = Invoke-EdgeDiscovery -NodeId 'acc-beliefs-001' -Force -MaxConcurrent 1 -RepoRoot $TempDir 3>$null 6>$null

            $script:CapturedEdgesJson | Should -Not -BeNullOrEmpty
            $written = $script:CapturedEdgesJson | ConvertFrom-Json

            # Only the first valid edge should survive
            $written.edges.Count | Should -Be 1
            $written.edges[0].type | Should -Be 'SUPPORTS'
            $written.edges[0].source | Should -Be 'acc-beliefs-001'
            $written.edges[0].target | Should -Be 'saf-beliefs-001'

            Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'Accepts all 8 canonical edge types' {
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "edge-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

            $TaxJson = @{
                nodes = @(
                    @{ id = 'acc-beliefs-001'; label = 'A'; description = 'A'; category = 'Beliefs' }
                    @{ id = 'saf-beliefs-001'; label = 'B'; description = 'B'; category = 'Beliefs' }
                )
            } | ConvertTo-Json -Depth 5
            Set-Content -Path (Join-Path $TempDir 'accelerationist.json') -Value $TaxJson
            Set-Content -Path (Join-Path $TempDir 'safetyist.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'skeptic.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'situations.json') -Value '{"nodes":[]}'

            Mock Get-TaxonomyDir { $TempDir }
            Mock Resolve-AIApiKey { 'fake-key' }

            $script:CapturedEdgesJson = $null
            Mock Write-Utf8NoBom {
                if ($Path -like '*edges.json') { $script:CapturedEdgesJson = $Value }
            }

            Mock Invoke-NodeEdgeDiscovery {
                # t/1093: canonical 8-type vocabulary. CITES/SUPPORTED_BY/PROPOSES removed;
                # CONVERGES_WITH added.
                $edges = @()
                foreach ($t in @('SUPPORTS', 'CONTRADICTS', 'WEAKENS', 'TENSION_WITH',
                                 'RESPONDS_TO', 'ASSUMES', 'INTERPRETS', 'CONVERGES_WITH')) {
                    $edges += [PSCustomObject]@{ target = 'saf-beliefs-001'; type = $t; confidence = 0.8; rationale = "Test $t" }
                }
                [PSCustomObject]@{
                    NodeId = $Node.id; RawEdges = $edges; NewEdgeTypes = @()
                    Error = $null; ElapsedSec = 0.5
                }
            }

            $null = Invoke-EdgeDiscovery -NodeId 'acc-beliefs-001' -Force -MaxConcurrent 1 -RepoRoot $TempDir 3>$null 6>$null

            $written = $script:CapturedEdgesJson | ConvertFrom-Json
            $written.edges.Count | Should -Be 8

            Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Describe 'Rationale silent-blank observability (t/2674)' -Tag 'taxonomy' {

    BeforeEach {
        InModuleScope AITriad {
            $script:RatTempDir = Join-Path ([System.IO.Path]::GetTempPath()) "edge-rat-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $script:RatTempDir -Force | Out-Null
            $TaxJson = @{
                nodes = @(
                    @{ id = 'acc-beliefs-001'; label = 'A'; description = 'A'; category = 'Beliefs' }
                    @{ id = 'saf-beliefs-001'; label = 'B'; description = 'B'; category = 'Beliefs' }
                )
            } | ConvertTo-Json -Depth 5
            Set-Content -Path (Join-Path $script:RatTempDir 'accelerationist.json') -Value $TaxJson
            Set-Content -Path (Join-Path $script:RatTempDir 'safetyist.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $script:RatTempDir 'skeptic.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $script:RatTempDir 'situations.json') -Value '{"nodes":[]}'
            Mock Get-TaxonomyDir { $script:RatTempDir }
            Mock Resolve-AIApiKey { 'fake-key' }
            Mock Write-Utf8NoBom { }
        }
    }

    AfterEach {
        InModuleScope AITriad {
            Remove-Item -Path $script:RatTempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'FIRE ARM: warns when the LLM omits rationale (silent-blank surfaced, not swallowed)' {
        InModuleScope AITriad {
            # Two valid, distinct-type edges with NO rationale property — mirrors an
            # LLM that omits the schema-required field (the real silent-blank cause).
            Mock Invoke-NodeEdgeDiscovery {
                [PSCustomObject]@{
                    NodeId = $Node.id
                    RawEdges = @(
                        [PSCustomObject]@{ target = 'saf-beliefs-001'; type = 'SUPPORTS'; confidence = 0.8 }
                        [PSCustomObject]@{ target = 'saf-beliefs-001'; type = 'WEAKENS';  confidence = 0.8 }
                    )
                    NewEdgeTypes = @(); Error = $null; ElapsedSec = 0.5
                }
            }

            $warn = $null
            $null = Invoke-EdgeDiscovery -NodeId 'acc-beliefs-001' -Force -MaxConcurrent 1 `
                -RepoRoot $script:RatTempDir -WarningVariable warn -WarningAction SilentlyContinue 6>$null
            $warnText = ($warn -join "`n")

            $warnText | Should -Match 'rationale' -Because 'an omitted rationale must be surfaced, not silently blank'
            $warnText | Should -Match 't/2674'
            $warnText | Should -Match '2 proposed edge' -Because 'both rationale-less edges must be counted'
        }
    }

    It 'CLEAN ARM: no rationale warning when every edge carries one (gate does not false-fire)' {
        InModuleScope AITriad {
            Mock Invoke-NodeEdgeDiscovery {
                [PSCustomObject]@{
                    NodeId = $Node.id
                    RawEdges = @(
                        [PSCustomObject]@{ target = 'saf-beliefs-001'; type = 'SUPPORTS'; confidence = 0.8; rationale = 'Because it supports' }
                        [PSCustomObject]@{ target = 'saf-beliefs-001'; type = 'WEAKENS';  confidence = 0.8; rationale = 'Because it weakens' }
                    )
                    NewEdgeTypes = @(); Error = $null; ElapsedSec = 0.5
                }
            }

            $warn = $null
            $null = Invoke-EdgeDiscovery -NodeId 'acc-beliefs-001' -Force -MaxConcurrent 1 `
                -RepoRoot $script:RatTempDir -WarningVariable warn -WarningAction SilentlyContinue 6>$null
            $warnText = ($warn -join "`n")

            $warnText | Should -Not -Match 't/2674' -Because 'a fully-populated run must not emit the silent-blank warning'
        }
    }
}

Describe 'rationale_source provenance stamping (t/2944)' -Tag 'taxonomy' {

    It 'stamps rationale_source=discovery on a discovered edge that carries a rationale, and leaves it ABSENT when the rationale is absent' {
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "edge-src-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
            $TaxJson = @{
                nodes = @(
                    @{ id = 'acc-beliefs-001'; label = 'A'; description = 'A'; category = 'Beliefs' }
                    @{ id = 'saf-beliefs-001'; label = 'B'; description = 'B'; category = 'Beliefs' }
                )
            } | ConvertTo-Json -Depth 5
            Set-Content -Path (Join-Path $TempDir 'accelerationist.json') -Value $TaxJson
            Set-Content -Path (Join-Path $TempDir 'safetyist.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'skeptic.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'situations.json') -Value '{"nodes":[]}'

            Mock Get-TaxonomyDir { $TempDir }
            Mock Resolve-AIApiKey { 'fake-key' }
            $script:CapturedEdgesJson = $null
            Mock Write-Utf8NoBom { if ($Path -like '*edges.json') { $script:CapturedEdgesJson = $Value } }

            Mock Invoke-NodeEdgeDiscovery {
                [PSCustomObject]@{
                    NodeId = $Node.id
                    RawEdges = @(
                        [PSCustomObject]@{ target = 'saf-beliefs-001'; type = 'SUPPORTS'; confidence = 0.8; rationale = 'because it supports' }  # carries rationale
                        [PSCustomObject]@{ target = 'saf-beliefs-001'; type = 'WEAKENS';  confidence = 0.8 }                                      # NO rationale
                    )
                    NewEdgeTypes = @(); Error = $null; ElapsedSec = 0.5
                }
            }

            $null = Invoke-EdgeDiscovery -NodeId 'acc-beliefs-001' -Force -MaxConcurrent 1 -RepoRoot $TempDir -WarningAction SilentlyContinue 3>$null 6>$null
            $written = $script:CapturedEdgesJson | ConvertFrom-Json

            $withRat = @($written.edges | Where-Object { $_.type -eq 'SUPPORTS' })[0]
            $noRat   = @($written.edges | Where-Object { $_.type -eq 'WEAKENS'  })[0]

            # write-together invariant: a non-empty rationale gets 'discovery'...
            $withRat.rationale        | Should -Be 'because it supports'
            $withRat.rationale_source | Should -Be 'discovery'
            # ...and a rationale-less edge is NOT given a source (absent, not coerced to null — absent != null)
            $noRat.PSObject.Properties['rationale_source'] | Should -BeNullOrEmpty

            Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'does NOT overwrite an existing rationale_source=restore on carry-forward (t/2946 restore protection, CL p/23#193)' {
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "edge-src-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
            $TaxJson = @{
                nodes = @( @{ id = 'acc-beliefs-001'; label = 'A'; description = 'A'; category = 'Beliefs' } )
            } | ConvertTo-Json -Depth 5
            Set-Content -Path (Join-Path $TempDir 'accelerationist.json') -Value $TaxJson
            @{ nodes = @(
                @{ id = 'saf-beliefs-001'; label = 'B'; description = 'B'; category = 'Beliefs' }
                @{ id = 'saf-beliefs-002'; label = 'C'; description = 'C'; category = 'Beliefs' }
            ) } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $TempDir 'safetyist.json')
            Set-Content -Path (Join-Path $TempDir 'skeptic.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'situations.json') -Value '{"nodes":[]}'

            # Pre-existing edges.json with a RESTORE-tagged edge (mirrors the 33,399 restored by t/2946).
            @{
                _schema_version = '1.0.0'; _doc = 't'; last_modified = '2026-01-01'
                edge_types = @(@{ type = 'SUPPORTS'; bidirectional = $false; definition = 'x' })
                edges = @(
                    @{ source = 'acc-beliefs-001'; target = 'saf-beliefs-002'; type = 'SUPPORTS'; confidence = 0.9; status = 'approved'; rationale = 'original discovery-time text'; rationale_source = 'restore' }
                )
            } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $TempDir 'edges.json')

            Mock Get-TaxonomyDir { $TempDir }
            Mock Resolve-AIApiKey { 'fake-key' }
            $script:CapturedEdgesJson = $null
            Mock Write-Utf8NoBom { if ($Path -like '*edges.json') { $script:CapturedEdgesJson = $Value } }

            # Discovery proposes a NEW edge on a different target (won't dedup against the restored one).
            Mock Invoke-NodeEdgeDiscovery {
                [PSCustomObject]@{
                    NodeId = $Node.id
                    RawEdges = @( [PSCustomObject]@{ target = 'saf-beliefs-001'; type = 'SUPPORTS'; confidence = 0.8; rationale = 'freshly discovered' } )
                    NewEdgeTypes = @(); Error = $null; ElapsedSec = 0.5
                }
            }

            $null = Invoke-EdgeDiscovery -NodeId 'acc-beliefs-001' -Force -MaxConcurrent 1 -RepoRoot $TempDir -WarningAction SilentlyContinue 3>$null 6>$null
            $written = $script:CapturedEdgesJson | ConvertFrom-Json

            $restored = @($written.edges | Where-Object { $_.target -eq 'saf-beliefs-002' })[0]
            $fresh    = @($written.edges | Where-Object { $_.target -eq 'saf-beliefs-001' })[0]

            # The restored edge is carried forward WHOLE — tag and text untouched.
            $restored.rationale_source | Should -Be 'restore'
            $restored.rationale        | Should -Be 'original discovery-time text'
            # The newly-discovered edge is the only one stamped 'discovery'.
            $fresh.rationale_source    | Should -Be 'discovery'

            Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
