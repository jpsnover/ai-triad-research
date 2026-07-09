# Tag: taxonomy (t/1449)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Verifies that LLM-traced paths in Invoke-GraphQuery are checked against
    the real edge set, not just that the node IDs exist (t/1449).
.DESCRIPTION
    The failure mode the ticket targets: a model can string together REAL
    node IDs into a path whose edges do not exist in the taxonomy — cited
    nodes pass the existing node-ID validator, but no hop actually connects
    them. These tests use a synthetic 3-node / 1-edge taxonomy and stub
    out `Invoke-AIApi` to return a canned response. Then we assert that
    the per-hop `verified` flag and per-path `fully_verified` flag correctly
    catch the fabricated hop while confirming a real hop.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Synthetic taxonomy fixtures — three real nodes with ONE real edge (A -> B).
    # No edge exists between B and C, so any traced path that hops B -> C should
    # be flagged as unverified.
    $script:FixtureDir = Join-Path ([System.IO.Path]::GetTempPath()) "graphquery-t1449-$(Get-Random)"
    $null = New-Item -ItemType Directory -Path $script:FixtureDir -Force

    # POV files — Invoke-GraphQuery reads accelerationist/safetyist/skeptic/situations.
    # We put a single node in each of accelerationist/safetyist and skip the others.
    @{
        pov = 'accelerationist'
        nodes = @(
            @{ id = 'acc-beliefs-001'; label = 'A'; category = 'Beliefs'; description = 'Node A' }
            @{ id = 'acc-desires-002'; label = 'B'; category = 'Desires'; description = 'Node B' }
        )
    } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $script:FixtureDir 'accelerationist.json') -Encoding utf8NoBOM
    @{
        pov = 'safetyist'
        nodes = @(
            @{ id = 'saf-beliefs-001'; label = 'C'; category = 'Beliefs'; description = 'Node C' }
        )
    } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $script:FixtureDir 'safetyist.json') -Encoding utf8NoBOM
    @{ pov = 'skeptic';    nodes = @() } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $script:FixtureDir 'skeptic.json') -Encoding utf8NoBOM
    @{ pov = 'situations'; nodes = @() } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $script:FixtureDir 'situations.json') -Encoding utf8NoBOM

    # ONE real edge: acc-beliefs-001 -> acc-desires-002 (A -> B). B -> C does not exist.
    @{
        edges = @(
            @{ source = 'acc-beliefs-001'; target = 'acc-desires-002'; type = 'SUPPORTS'; status = 'approved'; confidence = 0.9 }
        )
    } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $script:FixtureDir 'edges.json') -Encoding utf8NoBOM
}

AfterAll {
    if ($script:FixtureDir -and (Test-Path $script:FixtureDir)) {
        Remove-Item -Recurse -Force -Path $script:FixtureDir -ErrorAction SilentlyContinue
    }
}

Describe 'Invoke-GraphQuery per-hop edge validation (t/1449)' -Tag 'taxonomy' {

    BeforeEach {
        InModuleScope AITriad -Parameters @{ FD = $script:FixtureDir } {
            param($FD)
            # Point the cmdlet at the synthetic taxonomy dir.
            Mock Get-TaxonomyDir -MockWith ({ $FD }.GetNewClosure())
            # Cmdlet emits Write-Step / Write-OK — no-op them so test output is clean.
            Mock Write-Step -MockWith { }
            Mock Write-OK   -MockWith { }
            Mock Write-Info -MockWith { }
        }
    }

    It 'Flags a fabricated edge hop (B -> C) as unverified; verifies real hop (A -> B)' {
        InModuleScope AITriad {
            # Canned LLM response: 2 traced paths — the first is entirely real,
            # the second contains a fabricated B -> C hop through real node IDs.
            $canned = [PSCustomObject]@{
                Text = ([PSCustomObject]@{
                    answer     = 'Test answer'
                    confidence = 0.9
                    referenced_nodes = @()
                    paths_traced = @(
                        [PSCustomObject]@{
                            nodes = @('acc-beliefs-001', 'acc-desires-002')
                            reasoning = 'A supports B'
                        }
                        [PSCustomObject]@{
                            nodes = @('acc-beliefs-001', 'acc-desires-002', 'saf-beliefs-001')
                            reasoning = 'Fabricated: A -> B (real) then B -> C (nonexistent edge)'
                        }
                    )
                } | ConvertTo-Json -Depth 8 -Compress)
                Backend = 'stub'
                Model   = 'stub'
            }
            Mock Invoke-AIApi -MockWith { return $canned }

            $r = Invoke-GraphQuery -Question 'What supports B?' -Model 'gemini-3.1-flash-lite' -Raw 3>$null 6>$null

            $r                    | Should -Not -BeNullOrEmpty
            $r.paths_traced       | Should -Not -BeNullOrEmpty
            @($r.paths_traced).Count | Should -Be 2

            # Path 1: A -> B (real edge). One hop, all verified.
            $p1 = $r.paths_traced[0]
            @($p1.hops).Count             | Should -Be 1
            $p1.hops[0].source            | Should -Be 'acc-beliefs-001'
            $p1.hops[0].target            | Should -Be 'acc-desires-002'
            $p1.hops[0].verified          | Should -Be $true
            $p1.unverified_hop_count      | Should -Be 0
            $p1.fully_verified            | Should -Be $true

            # Path 2: A -> B (real) -> C (fabricated). Two hops, second unverified.
            $p2 = $r.paths_traced[1]
            @($p2.hops).Count             | Should -Be 2
            $p2.hops[0].verified          | Should -Be $true    # A -> B exists
            $p2.hops[1].source            | Should -Be 'acc-desires-002'
            $p2.hops[1].target            | Should -Be 'saf-beliefs-001'
            $p2.hops[1].verified          | Should -Be $false   # B -> C does NOT exist
            $p2.unverified_hop_count      | Should -Be 1
            $p2.fully_verified            | Should -Be $false
        }
    }

    It 'Reports zero unverified hops when every traced hop is a real edge' {
        InModuleScope AITriad {
            $canned = [PSCustomObject]@{
                Text = ([PSCustomObject]@{
                    answer     = 'Test'
                    confidence = 1.0
                    referenced_nodes = @()
                    paths_traced = @(
                        [PSCustomObject]@{
                            nodes = @('acc-beliefs-001', 'acc-desires-002')
                            reasoning = 'real'
                        }
                    )
                } | ConvertTo-Json -Depth 8 -Compress)
                Backend = 'stub'
                Model   = 'stub'
            }
            Mock Invoke-AIApi -MockWith { return $canned }

            $warnings = $null
            $r = Invoke-GraphQuery -Question 'q' -Model 'gemini-3.1-flash-lite' -Raw -WarningVariable warnings -WarningAction SilentlyContinue 3>$null 6>$null

            @($r.paths_traced).Count | Should -Be 1
            $r.paths_traced[0].fully_verified | Should -Be $true
            $r.paths_traced[0].unverified_hop_count | Should -Be 0
            # No unverified-hop warning should have been raised
            ($warnings -join '|') | Should -Not -Match 'traced hop\(s\) reference edges that do not exist'
        }
    }

    It 'Emits an unverified-hop warning surfaced next to the node-UnverifiedCount warning' {
        InModuleScope AITriad {
            $canned = [PSCustomObject]@{
                Text = ([PSCustomObject]@{
                    answer     = 'Test'
                    confidence = 0.5
                    referenced_nodes = @()
                    paths_traced = @(
                        [PSCustomObject]@{
                            # Fabricated single hop between two real nodes with no edge
                            nodes = @('acc-desires-002', 'saf-beliefs-001')
                            reasoning = 'no such edge'
                        }
                    )
                } | ConvertTo-Json -Depth 8 -Compress)
                Backend = 'stub'
                Model   = 'stub'
            }
            Mock Invoke-AIApi -MockWith { return $canned }

            $warnings = $null
            $null = Invoke-GraphQuery -Question 'q' -Model 'gemini-3.1-flash-lite' -Raw -WarningVariable warnings -WarningAction SilentlyContinue 3>$null 6>$null

            ($warnings -join '|') | Should -Match 'traced hop\(s\) reference edges that do not exist'
        }
    }
}
