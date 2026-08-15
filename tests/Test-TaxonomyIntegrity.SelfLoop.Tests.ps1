# Tag: taxonomy (t/2682)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Test-TaxonomyIntegrity self-loop detection + repair (t/2682).
.DESCRIPTION
    49 self-loop edges (source == target, all `approved`) were found in the stored
    graph — malformed, since Invoke-EdgeDiscovery / Import-OrganizationEdge reject
    self-loops at creation. This test asserts the integrity checker now (a) FLAGS a
    self-loop as an Error issue so it cannot silently recur, and (b) REMOVES it under
    -Repair while preserving the edges.json byte contract.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-TaxonomyIntegrity self-loop edges (t/2682)' -Tag 'taxonomy' {

    BeforeEach {
        $script:TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "tti-selfloop-$(Get-Random)"
        New-Item -ItemType Directory -Path $script:TempDir -Force | Out-Null

        # POV file with two valid nodes.
        @{
            nodes = @(
                @{ id = 'acc-beliefs-001'; pov = 'accelerationist'; label = 'A'; category = 'Beliefs'; parent_id = $null }
                @{ id = 'acc-beliefs-002'; pov = 'accelerationist'; label = 'B'; category = 'Beliefs'; parent_id = $null }
            )
        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $script:TempDir 'accelerationist.json')

        # Minimal registry so strict-mode $Registry is assigned.
        @{ policies = @() } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $script:TempDir 'policy_actions.json')

        # edges.json: one valid edge + one self-loop (source == target, valid node —
        # so it is NOT also a dangling-edge; it exercises the self-loop path alone).
        @{
            _schema_version = '1.0.0'
            last_modified   = '2026-01-01'
            edge_types      = @('SUPPORTS')
            edges = @(
                [ordered]@{ source = 'acc-beliefs-001'; target = 'acc-beliefs-002'; type = 'SUPPORTS'; status = 'approved'; confidence = 0.9 }
                [ordered]@{ source = 'acc-beliefs-002'; target = 'acc-beliefs-002'; type = 'SUPPORTS'; status = 'approved'; confidence = 0.8 }
            )
        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $script:TempDir 'edges.json')
    }

    AfterEach {
        Remove-Item -Path $script:TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'flags a self-loop edge as a SelfLoopEdge Error issue' {
        InModuleScope AITriad -Parameters @{ TempDir = $script:TempDir } {
            param($TempDir)
            Mock Get-TaxonomyDir { $TempDir }

            $Result = Test-TaxonomyIntegrity -PassThru
            $SelfLoop = @($Result.Details | Where-Object { $_.Check -eq 'SelfLoopEdge' })

            $SelfLoop.Count | Should -Be 1 -Because 'the self-loop must surface as its own issue'
            $SelfLoop[0].Severity | Should -Be 'Error'
            $SelfLoop[0].Count    | Should -Be 1 -Because 'exactly one self-loop was seeded'
        }
    }

    It 'reports no self-loop issue when none are present' {
        InModuleScope AITriad -Parameters @{ TempDir = $script:TempDir } {
            param($TempDir)
            # Overwrite edges.json with only the valid edge.
            @{
                _schema_version = '1.0.0'
                last_modified   = '2026-01-01'
                edge_types      = @('SUPPORTS')
                edges = @(
                    [ordered]@{ source = 'acc-beliefs-001'; target = 'acc-beliefs-002'; type = 'SUPPORTS'; status = 'approved'; confidence = 0.9 }
                )
            } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $TempDir 'edges.json')

            Mock Get-TaxonomyDir { $TempDir }

            $Result = Test-TaxonomyIntegrity -PassThru
            @($Result.Details | Where-Object { $_.Check -eq 'SelfLoopEdge' }).Count |
                Should -Be 0 -Because 'a clean graph produces no self-loop issue'
        }
    }

    It 'removes the self-loop under -Repair and preserves the byte contract' {
        InModuleScope AITriad -Parameters @{ TempDir = $script:TempDir } {
            param($TempDir)
            Mock Get-TaxonomyDir { $TempDir }

            Test-TaxonomyIntegrity -Repair | Out-Null

            $EdgesFile = Join-Path $TempDir 'edges.json'
            $Bytes = [System.IO.File]::ReadAllBytes($EdgesFile)

            # Byte contract: single trailing LF, LF-only, no BOM.
            $Bytes[$Bytes.Length - 1] | Should -Be 10 -Because 'repaired edges.json must end with a trailing LF'
            $Bytes[$Bytes.Length - 2] | Should -Not -Be 10 -Because 'exactly one trailing newline'
            @($Bytes | Where-Object { $_ -eq 13 }).Count | Should -Be 0 -Because 'no CR bytes allowed'
            ($Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF) | Should -BeFalse -Because 'UTF-8 no-BOM'

            $Doc = [System.IO.File]::ReadAllText($EdgesFile) | ConvertFrom-Json
            $Edges = @($Doc.edges)
            $Edges.Count | Should -Be 1 -Because 'only the valid edge survives repair'
            @($Edges | Where-Object { $_.source -eq $_.target }).Count |
                Should -Be 0 -Because 'the self-loop must be stripped'
            $Edges[0].source | Should -Be 'acc-beliefs-001'
            $Edges[0].target | Should -Be 'acc-beliefs-002'
        }
    }
}
