# Tag: taxonomy
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Test-TaxonomyIntegrity -Repair audit trail.
.DESCRIPTION
    -Repair cascades: a node deleted elsewhere takes its child refs, situation
    linked_nodes and every edge (with rationale) with it. The acc-intentions-003
    incident lost 194 edges that way with no record of what ran. These tests pin:
      - every prune lands in a durable, restorable audit file (full edge objects);
      - a WARN names the missing IDs and the audit path;
      - an audit-write failure aborts BEFORE any taxonomy file is modified;
      - a repair that prunes nothing writes no audit file.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-TaxonomyIntegrity -Repair audit' -Tag 'taxonomy' {

    BeforeEach {
        $script:TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "tti-audit-$(Get-Random)"
        New-Item -ItemType Directory -Path $script:TempDir -Force | Out-Null

        # acc-beliefs-001's child 'acc-beliefs-gone' was deleted; edges and a situation still point at it.
        @{
            nodes = @(
                @{ id = 'acc-beliefs-001'; label = 'A'; category = 'Beliefs'; parent_id = $null; children = @('acc-beliefs-002', 'acc-beliefs-gone') }
                @{ id = 'acc-beliefs-002'; label = 'B'; category = 'Beliefs'; parent_id = 'acc-beliefs-001'; children = @() }
            )
        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $script:TempDir 'accelerationist.json')
        @{
            nodes = @(
                @{ id = 'sit-001'; label = 'S'; linked_nodes = @('acc-beliefs-001', 'acc-beliefs-gone') }
            )
        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $script:TempDir 'situations.json')
        @{ policies = @() } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $script:TempDir 'policy_actions.json')
        @{
            _schema_version = '1.0.0'
            last_modified   = '2026-01-01'
            edge_types      = @('SUPPORTS')
            edges = @(
                [ordered]@{ source = 'acc-beliefs-001'; target = 'acc-beliefs-002'; type = 'SUPPORTS'; confidence = 0.9; rationale = 'kept' }
                [ordered]@{ source = 'acc-beliefs-gone'; target = 'acc-beliefs-001'; type = 'SUPPORTS'; confidence = 0.7; rationale = 'restore me' }
                [ordered]@{ source = 'acc-beliefs-002'; target = 'acc-beliefs-002'; type = 'SUPPORTS'; confidence = 0.5; rationale = 'loop' }
            )
        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $script:TempDir 'edges.json')
    }

    AfterEach {
        Remove-Item -Path $script:TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'writes a restorable audit of every prune and warns with the missing IDs' {
        InModuleScope AITriad -Parameters @{ TempDir = $script:TempDir } {
            param($TempDir)
            Mock Get-TaxonomyDir { $TempDir }
            $AuditDir = Join-Path $TempDir 'audit'

            Test-TaxonomyIntegrity -Repair -AuditDir $AuditDir -WarningVariable Warn -WarningAction SilentlyContinue | Out-Null

            $Files = @(Get-ChildItem -Path $AuditDir -Filter 'integrity-repair-*.json')
            $Files.Count | Should -Be 1
            $Doc = Get-Content -Raw $Files[0].FullName | ConvertFrom-Json

            @($Doc.missing_ids) | Should -Be @('acc-beliefs-gone')
            $Doc.counts.children        | Should -Be 1
            $Doc.counts.linked_nodes    | Should -Be 1
            $Doc.counts.dangling_edges  | Should -Be 1
            $Doc.counts.self_loop_edges | Should -Be 1
            $Doc.pruned.children[0].node_id | Should -Be 'acc-beliefs-001'
            $Doc.pruned.linked_nodes[0].node_id | Should -Be 'sit-001'

            # Full edge object, rationale included — restorable verbatim.
            $Edge = $Doc.pruned.dangling_edges[0]
            $Edge.source    | Should -Be 'acc-beliefs-gone'
            $Edge.rationale | Should -Be 'restore me'
            $Edge.confidence | Should -Be 0.7
            $Doc.pruned.self_loop_edges[0].rationale | Should -Be 'loop'

            $Msg = ($Warn | ForEach-Object { $_.Message }) -join "`n"
            $Msg | Should -Match 'acc-beliefs-gone'
            $Msg | Should -Match ([regex]::Escape($Files[0].FullName))

            # Repair itself still happened.
            @((Get-Content -Raw (Join-Path $TempDir 'edges.json') | ConvertFrom-Json).edges).Count | Should -Be 1
        }
    }

    It 'aborts before modifying any taxonomy file when the audit cannot be written' {
        InModuleScope AITriad -Parameters @{ TempDir = $script:TempDir } {
            param($TempDir)
            Mock Get-TaxonomyDir { $TempDir }
            # A FILE where the audit directory should be → directory creation fails.
            $Blocker = Join-Path $TempDir 'blocker'
            Set-Content -Path $Blocker -Value 'x'
            $Watched = 'edges.json', 'accelerationist.json', 'situations.json'
            $Before = @{}
            foreach ($F in $Watched) { $Before[$F] = Get-FileHash (Join-Path $TempDir $F) }

            { Test-TaxonomyIntegrity -Repair -AuditDir (Join-Path $Blocker 'sub') -WarningAction SilentlyContinue } |
                Should -Throw -ExpectedMessage '*No taxonomy file was modified*'

            foreach ($F in $Watched) {
                (Get-FileHash (Join-Path $TempDir $F)).Hash | Should -Be $Before[$F].Hash -Because "$F must be untouched"
            }
        }
    }

    It 'writes no audit file when -Repair prunes nothing' {
        InModuleScope AITriad -Parameters @{ TempDir = $script:TempDir } {
            param($TempDir)
            Mock Get-TaxonomyDir { $TempDir }
            # Clean graph; the remaining issue (missing embeddings) is not repairable.
            @{
                nodes = @(@{ id = 'acc-beliefs-001'; label = 'A'; category = 'Beliefs'; parent_id = $null; children = @() })
            } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $TempDir 'accelerationist.json')
            @{ nodes = @(@{ id = 'sit-001'; label = 'S'; linked_nodes = @() }) } |
                ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $TempDir 'situations.json')
            @{ _schema_version = '1.0.0'; edge_types = @('SUPPORTS'); edges = @() } |
                ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $TempDir 'edges.json')
            $AuditDir = Join-Path $TempDir 'audit'

            Test-TaxonomyIntegrity -Repair -AuditDir $AuditDir -WarningVariable Warn -WarningAction SilentlyContinue | Out-Null

            Test-Path $AuditDir | Should -BeFalse
            @($Warn | Where-Object { $_.Message -match 'pruned' }).Count | Should -Be 0
        }
    }
}
