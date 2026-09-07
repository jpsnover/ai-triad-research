#Requires -Modules Pester
<#
.SYNOPSIS
    Direct both-arms proof for the env-reconcile fail-closed superset guard (t/3345, TL t/3345#14).

    The abort arm is not forceable through Sync-StagingEnv.ps1 with a real bicep — the -NamesOnly
    regex is a strict prefix of the literal regex, so NamesOnly is always a superset of the literal
    set (t/2971 Guard Testability gap flagged at t/3345#13). Extracting Test-ManagedNamesSuperset as
    a pure function lets both arms be proven directly with CONSTRUCTED sets, no bicep/Azure needed.
#>

Describe 'Test-ManagedNamesSuperset' {
    BeforeAll {
        $scriptRoot = Split-Path $PSScriptRoot -Parent
        . (Join-Path $scriptRoot 'operations/devops/Test-ManagedNamesSuperset.ps1')
    }

    It 'OK arm: proper superset (ManagedNames ⊋ LiteralKeys) → Ok, no Missing' {
        $v = Test-ManagedNamesSuperset -LiteralKeys @('A', 'B') -ManagedNames @('A', 'B', 'C', 'D')
        $v.Ok | Should -BeTrue
        @($v.Missing).Count | Should -Be 0
    }

    It 'OK arm: equal sets → Ok' {
        (Test-ManagedNamesSuperset -LiteralKeys @('A', 'B') -ManagedNames @('B', 'A')).Ok | Should -BeTrue
    }

    It 'OK arm: empty LiteralKeys with non-empty ManagedNames → Ok (nothing to protect)' {
        (Test-ManagedNamesSuperset -LiteralKeys @() -ManagedNames @('A')).Ok | Should -BeTrue
    }

    It 'ABORT arm: one literal key missing → not Ok, Missing names it' {
        $v = Test-ManagedNamesSuperset -LiteralKeys @('A', 'B', 'C') -ManagedNames @('A', 'C')
        $v.Ok | Should -BeFalse
        $v.Missing | Should -Be @('B')
    }

    It 'ABORT arm: multiple missing → Missing lists all offenders' {
        $v = Test-ManagedNamesSuperset -LiteralKeys @('A', 'B', 'C', 'D') -ManagedNames @('A')
        $v.Ok | Should -BeFalse
        ($v.Missing | Sort-Object) | Should -Be @('B', 'C', 'D')
    }

    It 'ABORT arm: empty ManagedNames (broken parse) → not Ok, Missing = all literal keys' {
        $v = Test-ManagedNamesSuperset -LiteralKeys @('A', 'B') -ManagedNames @()
        $v.Ok | Should -BeFalse
        ($v.Missing | Sort-Object) | Should -Be @('A', 'B')
    }

    It 'ABORT arm: null ManagedNames → not Ok (never treat a broken parse as safe)' {
        (Test-ManagedNamesSuperset -LiteralKeys @('A') -ManagedNames $null).Ok | Should -BeFalse
    }

    It 'The count-check trap: a dropped literal key OFFSET by a spurious extra name — count-equal but NOT a superset' {
        # LiteralKeys and ManagedNames are the SAME size (3), so the old count check
        # ($ManagedNames.Count -lt $BicepEnv.Count) would PASS — but 'B' is missing and 'X' is spurious.
        # Membership correctly aborts. This is the exact failure the count check let through.
        $v = Test-ManagedNamesSuperset -LiteralKeys @('A', 'B', 'C') -ManagedNames @('A', 'C', 'X')
        $v.Ok | Should -BeFalse
        $v.Missing | Should -Be @('B')
    }
}
