# Tag: conflict (t/3948)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression test for t/3948: Invoke-POVSummary's conflict-detection block
    double-wrapped linked_taxonomy_nodes in an extra array layer.
.DESCRIPTION
    `$linkedNodes = ,@($claim.linked_taxonomy_nodes)` used the unary-comma
    "protect from pipeline unrolling" trick on a plain ASSIGNMENT, where it
    instead wraps the array in another array. That made `.Count` always
    >= 1 (so the "new conflict" vs "append" branch logic was never hit
    correctly) and serialized conflict files as linked_taxonomy_nodes:
    [["id"]] instead of ["id"]. Introduced in 7e4ea544 (the PS 5.1 rewrite).

    This test must FAIL if the old `,@(...)` line is restored in place of
    the ConvertTo-LinkedNodesArray call.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue
}

Describe 'ConvertTo-LinkedNodesArray' -Tag 'conflict' {

    It 'returns a single-element flat array for one linked node id (not a nested array)' {
        $r = InModuleScope AITriad { ConvertTo-LinkedNodesArray -Value 'acc-ethics-004' }
        @($r).Count | Should -Be 1
        $r[0] | Should -Be 'acc-ethics-004'
    }

    It 'returns a flat array for multiple linked node ids' {
        $r = InModuleScope AITriad { ConvertTo-LinkedNodesArray -Value @('acc-ethics-004', 'saf-risk-012') }
        @($r).Count | Should -Be 2
        $r | Should -Contain 'acc-ethics-004'
        $r | Should -Contain 'saf-risk-012'
    }

    It 'returns an empty array (Count 0) when the source value is $null' {
        $r = InModuleScope AITriad { ConvertTo-LinkedNodesArray -Value $null }
        @($r).Count | Should -Be 0 -Because 'a claim with no linked_taxonomy_nodes must not be treated as having any'
    }

    It 'round-trips through ConvertTo-Json as a flat JSON array, not a nested one (t/3948 repro)' {
        $r = InModuleScope AITriad { ConvertTo-LinkedNodesArray -Value @('acc-ethics-004') }
        # -InputObject (not a pipe): piping `$r | ConvertTo-Json` unrolls a
        # single-element array the same way a bare `return` does, which would
        # mask the exact failure mode this test exists to catch.
        $json = ConvertTo-Json -InputObject $r -Depth 5 -Compress
        $json | Should -Be '["acc-ethics-004"]' -Because 'the old ,@(...) bug produced [["acc-ethics-004"]]'
    }
}
