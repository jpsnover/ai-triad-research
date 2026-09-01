# Tag: unit (t/3170)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Both-arms Gate Verification tests for the entity relation-DAG write-side gate (t/3170):
    target well-formedness + existence, acyclicity, and depth<=3 over the COMBINED
    instance_of/subclass_of/part_of graph. Each check is proven reject/pass.
    Pinned (t/3170#2): depth = EDGES (<=3 edges); combined DAG; validate-only.
#>

BeforeAll {
    $script:ModulePath = (Resolve-Path (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1')).Path
    Import-Module $script:ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-EntityRelationGraph — core invariants (t/3170)' -Tag 'unit' {

    It 'Clean graph → no violations (well-formed, existing, acyclic, shallow)' {
        InModuleScope AITriad {
            $edges = @(
                @{ Source = 'ent-1'; Type = 'instance_of'; Target = 'term:model' }
                @{ Source = 'ent-1'; Type = 'part_of';     Target = 'ent-2' }
            )
            $v = Test-EntityRelationGraph -Edge $edges -KnownEntityId @('ent-1', 'ent-2') -KnownTermRef @('term:model')
            @($v).Count | Should -Be 0
        }
    }

    It 'Check 1 — malformed target is rejected; well-formed passes (both arms)' {
        InModuleScope AITriad {
            $bad = Test-EntityRelationGraph -Edge @(@{ Source = 'ent-1'; Type = 'instance_of'; Target = 'not-a-ref' }) -KnownEntityId @('ent-1')
            @($bad | Where-Object Kind -eq 'malformed-target').Count | Should -Be 1

            $good = Test-EntityRelationGraph -Edge @(@{ Source = 'ent-1'; Type = 'instance_of'; Target = 'term:x' }) -KnownEntityId @('ent-1') -KnownTermRef @('term:x')
            @($good).Count | Should -Be 0
        }
    }

    It 'Check 2 — non-existent target is rejected; existing passes (both arms)' {
        InModuleScope AITriad {
            $bad = Test-EntityRelationGraph -Edge @(@{ Source = 'ent-1'; Type = 'part_of'; Target = 'ent-999' }) -KnownEntityId @('ent-1')
            @($bad | Where-Object Kind -eq 'missing-target').Count | Should -Be 1

            $good = Test-EntityRelationGraph -Edge @(@{ Source = 'ent-1'; Type = 'part_of'; Target = 'ent-2' }) -KnownEntityId @('ent-1', 'ent-2')
            @($good).Count | Should -Be 0
        }
    }

    It 'Check 3 — a cycle is rejected; a DAG passes (both arms), combined across relation types' {
        InModuleScope AITriad {
            # cycle crossing instance_of + subclass_of + part_of edge types (combined-DAG semantics).
            $cyclic = Test-EntityRelationGraph -Edge @(
                @{ Source = 'ent-1'; Type = 'instance_of'; Target = 'ent-2' }
                @{ Source = 'ent-2'; Type = 'subclass_of'; Target = 'ent-3' }
                @{ Source = 'ent-3'; Type = 'part_of';     Target = 'ent-1' }
            ) -KnownEntityId @('ent-1', 'ent-2', 'ent-3')
            @($cyclic | Where-Object Kind -eq 'cycle').Count | Should -BeGreaterThan 0

            $acyclic = Test-EntityRelationGraph -Edge @(
                @{ Source = 'ent-1'; Type = 'instance_of'; Target = 'ent-2' }
                @{ Source = 'ent-2'; Type = 'subclass_of'; Target = 'ent-3' }
            ) -KnownEntityId @('ent-1', 'ent-2', 'ent-3')
            @($acyclic).Count | Should -Be 0
        }
    }

    It 'Check 4 — depth boundary: 3 edges passes, 4 edges is rejected (depth = EDGES)' {
        InModuleScope AITriad {
            # 3-edge chain ent-1→ent-2→ent-3→ent-4 (depth 3) — passes.
            $depth3 = Test-EntityRelationGraph -Edge @(
                @{ Source = 'ent-1'; Type = 'subclass_of'; Target = 'ent-2' }
                @{ Source = 'ent-2'; Type = 'subclass_of'; Target = 'ent-3' }
                @{ Source = 'ent-3'; Type = 'subclass_of'; Target = 'ent-4' }
            ) -KnownEntityId @('ent-1', 'ent-2', 'ent-3', 'ent-4')
            @($depth3 | Where-Object Kind -eq 'over-depth').Count | Should -Be 0

            # 4-edge chain (depth 4) — rejected.
            $depth4 = Test-EntityRelationGraph -Edge @(
                @{ Source = 'ent-1'; Type = 'subclass_of'; Target = 'ent-2' }
                @{ Source = 'ent-2'; Type = 'subclass_of'; Target = 'ent-3' }
                @{ Source = 'ent-3'; Type = 'subclass_of'; Target = 'ent-4' }
                @{ Source = 'ent-4'; Type = 'subclass_of'; Target = 'ent-5' }
            ) -KnownEntityId @('ent-1', 'ent-2', 'ent-3', 'ent-4', 'ent-5')
            @($depth4 | Where-Object Kind -eq 'over-depth').Count | Should -BeGreaterThan 0
        }
    }
}

Describe 'Assert-EntityRelationsValid — write-side attribution (t/3170)' -Tag 'unit' {

    It 'Clean candidate → silent (no throw)' {
        InModuleScope AITriad {
            { Assert-EntityRelationsValid -EntityId 'ent-9' `
                    -Relation @(@{ type = 'instance_of'; target = 'ent-1' }) `
                    -ExistingEntity @([pscustomobject]@{ id = 'ent-1' }) } | Should -Not -Throw
        }
    }

    It 'Candidate that introduces a cycle → throws ActionableError' {
        InModuleScope AITriad {
            # store: ent-1 --instance_of--> ent-9 ; candidate ent-9 --part_of--> ent-1 closes the cycle.
            $store = @([pscustomobject]@{ id = 'ent-1'; relations = @([pscustomobject]@{ type = 'instance_of'; target = 'ent-9' }) })
            { Assert-EntityRelationsValid -EntityId 'ent-9' `
                    -Relation @(@{ type = 'part_of'; target = 'ent-1' }) `
                    -ExistingEntity $store } | Should -Throw '*cycle*'
        }
    }

    It 'A PRE-EXISTING store violation does NOT reject an unrelated clean candidate (attribution)' {
        InModuleScope AITriad {
            # store already over-depth (4-edge chain); candidate adds one unrelated valid edge.
            $store = @(
                [pscustomobject]@{ id = 'ent-1'; relations = @([pscustomobject]@{ type = 'subclass_of'; target = 'ent-2' }) }
                [pscustomobject]@{ id = 'ent-2'; relations = @([pscustomobject]@{ type = 'subclass_of'; target = 'ent-3' }) }
                [pscustomobject]@{ id = 'ent-3'; relations = @([pscustomobject]@{ type = 'subclass_of'; target = 'ent-4' }) }
                [pscustomobject]@{ id = 'ent-4'; relations = @([pscustomobject]@{ type = 'subclass_of'; target = 'ent-5' }) }
                [pscustomobject]@{ id = 'ent-5' }
                [pscustomobject]@{ id = 'ent-9' }
            )
            { Assert-EntityRelationsValid -EntityId 'ent-9' `
                    -Relation @(@{ type = 'part_of'; target = 'ent-5' }) `
                    -ExistingEntity $store } | Should -Not -Throw
        }
    }
}

Describe 'Import-Entity — relation gate integration (t/3170)' -Tag 'unit' {

    BeforeEach {
        $script:root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:root -Force | Out-Null
        $script:entPath = Join-Path $script:root 'entities.json'
        $store = [ordered]@{
            _schema_version = '1.0.0'; _doc = 'test'; entity_count = 1; last_modified = '2026-09-01'
            entities        = @([ordered]@{ id = 'ent-001'; name = 'Anchor'; aliases = @(); entity_type = 'event'; dolce_category = 'perdurant'; status = 'approved' })
        }
        ($store | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $script:entPath -Encoding utf8NoBOM
    }

    It 'Rejects an import whose relation target does not exist' {
        $proposal = @{ name = 'Widget'; entity_type = 'artifact'; dolce_category = 'non-agentive-functional-artifact'
            relations = @(@{ type = 'part_of'; target = 'ent-404' })
        }
        { Import-Entity -Proposal $proposal -Path $script:entPath } | Should -Throw '*t/3170*'
    }

    It 'Accepts an import with a valid relation (existing ent-* target); relations are validate-only (dropped)' {
        $proposal = @{ name = 'Widget'; entity_type = 'artifact'; dolce_category = 'non-agentive-functional-artifact'
            relations = @(@{ type = 'part_of'; target = 'ent-001' })
        }
        { Import-Entity -Proposal $proposal -Path $script:entPath } | Should -Not -Throw

        # validate-only: the imported record carries NO persisted relations yet (t/3170 Q1).
        $after = Get-Content -Raw -LiteralPath $script:entPath -Encoding utf8 | ConvertFrom-Json
        $widget = @($after.entities | Where-Object { $_.name -eq 'Widget' })
        $widget.Count | Should -Be 1
        $widget[0].PSObject.Properties['relations'] | Should -BeNullOrEmpty
    }
}

Describe 'Get-EntityReport -Report relation-dag — audit sweep (t/3170 Q3)' -Tag 'unit' {

    It 'Surfaces a PRE-EXISTING store cycle as a finding (not a silent pass)' {
        $root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        $entPath = Join-Path $root 'entities.json'
        # store carrying an already-persisted 2-cycle in relations[].
        $store = [ordered]@{
            _schema_version = '1.0.0'; _doc = 'test'; entity_count = 2; last_modified = '2026-09-01'
            entities        = @(
                [ordered]@{ id = 'ent-1'; name = 'A'; aliases = @(); entity_type = 'event'; dolce_category = 'perdurant'; status = 'approved'
                    relations = @([ordered]@{ type = 'part_of'; target = 'ent-2' }) }
                [ordered]@{ id = 'ent-2'; name = 'B'; aliases = @(); entity_type = 'event'; dolce_category = 'perdurant'; status = 'approved'
                    relations = @([ordered]@{ type = 'part_of'; target = 'ent-1' }) }
            )
        }
        ($store | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $entPath -Encoding utf8NoBOM

        $r = Get-EntityReport -Report relation-dag -EntitiesPath $entPath
        $r.RelationDag.EdgeCount | Should -Be 2
        @($r.RelationDag.Violations | Where-Object Kind -eq 'cycle').Count | Should -BeGreaterThan 0
    }

    It 'Clean store → zero relation-dag violations' {
        $root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        $entPath = Join-Path $root 'entities.json'
        $store = [ordered]@{
            _schema_version = '1.0.0'; _doc = 'test'; entity_count = 2; last_modified = '2026-09-01'
            entities        = @(
                [ordered]@{ id = 'ent-1'; name = 'A'; aliases = @(); entity_type = 'event'; dolce_category = 'perdurant'; status = 'approved'
                    relations = @([ordered]@{ type = 'part_of'; target = 'ent-2' }) }
                [ordered]@{ id = 'ent-2'; name = 'B'; aliases = @(); entity_type = 'event'; dolce_category = 'perdurant'; status = 'approved' }
            )
        }
        ($store | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $entPath -Encoding utf8NoBOM

        $r = Get-EntityReport -Report relation-dag -EntitiesPath $entPath
        @($r.RelationDag.Violations).Count | Should -Be 0
    }
}
