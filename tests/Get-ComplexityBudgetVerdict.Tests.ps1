# Tag: health (t/3829)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Get-ComplexityBudgetVerdict — pure Pareto-dominance verdict (t/3829).
.DESCRIPTION
    Dot-sources the verdict file DIRECTLY rather than importing the AITriad
    module / using InModuleScope -- the whole point of the dot-sourceable
    verdict-file pattern (t/3829#6/#7) is that this test exercises the exact
    same artifact the generator and enforcer call, without binding to module
    internals.
#>

BeforeAll {
    . (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Private' 'Get-ComplexityBudgetVerdict.ps1')
}

Describe 'Get-ComplexityBudgetVerdict (t/3829)' -Tag 'health' {

    It 'passes when max and countOver are both unchanged' {
        $existing = @{ max = 20; countOver = 3 }
        $observed = @{ max = 20; countOver = 3 }
        Get-ComplexityBudgetVerdict -Observed $observed -Existing $existing -Threshold 15 | Should -Be $true
    }

    It 'passes when max and countOver both improve' {
        $existing = @{ max = 20; countOver = 3 }
        $observed = @{ max = 20; countOver = 1 }
        Get-ComplexityBudgetVerdict -Observed $observed -Existing $existing -Threshold 15 | Should -Be $true
    }

    It 'fails when max is unchanged but countOver rises (Pareto violation)' {
        $existing = @{ max = 20; countOver = 3 }
        $observed = @{ max = 20; countOver = 4 }
        Get-ComplexityBudgetVerdict -Observed $observed -Existing $existing -Threshold 15 | Should -Be $false
    }

    It 'fails when max rises, regardless of countOver' {
        $existing = @{ max = 20; countOver = 3 }
        $observed = @{ max = 21; countOver = 0 }
        Get-ComplexityBudgetVerdict -Observed $observed -Existing $existing -Threshold 15 | Should -Be $false
    }

    It 'passes decomposition: max strictly falls, countOver rises within the ceiling' {
        # Worked example from t/3829#2/t/3821#2: a 302-complexity function split into
        # many small ones. Ceiling = max(existing.countOver + 5, ceil(existing.max / threshold))
        #                         = max(1 + 5, ceil(302 / 15)) = max(6, 21) = 21.
        $existing = @{ max = 302; countOver = 1 }
        $observed = @{ max = 14; countOver = 20 }
        Get-ComplexityBudgetVerdict -Observed $observed -Existing $existing -Threshold 15 | Should -Be $true
    }

    It 'fails decomposition when countOver exceeds the ceiling' {
        $existing = @{ max = 302; countOver = 1 }
        $observed = @{ max = 14; countOver = 22 }
        Get-ComplexityBudgetVerdict -Observed $observed -Existing $existing -Threshold 15 | Should -Be $false
    }

    It 'anchors the decomposition ceiling to existing.max, not existing.countOver' {
        # If the ceiling were anchored to existing.countOver alone it would shrink as
        # countOver starts low (1), permanently capping future decomposition. Anchoring
        # to existing.max/threshold keeps the ceiling proportional to how much complexity
        # there was to redistribute in the first place.
        $existing = @{ max = 302; countOver = 1 }
        $ceilingFromMax = [Math]::Ceiling(302 / 15)
        $ceilingFromCountOverPlus5 = 1 + 5
        $ceilingFromMax | Should -BeGreaterThan $ceilingFromCountOverPlus5

        $observed = @{ max = 14; countOver = [int]$ceilingFromMax }
        Get-ComplexityBudgetVerdict -Observed $observed -Existing $existing -Threshold 15 | Should -Be $true
    }

    It 'rejects a zero threshold (division-by-zero/Infinity hazard)' {
        $existing = @{ max = 20; countOver = 3 }
        $observed = @{ max = 20; countOver = 3 }
        { Get-ComplexityBudgetVerdict -Observed $observed -Existing $existing -Threshold 0 } | Should -Throw
    }

    It 'rejects a negative threshold' {
        $existing = @{ max = 20; countOver = 3 }
        $observed = @{ max = 20; countOver = 3 }
        { Get-ComplexityBudgetVerdict -Observed $observed -Existing $existing -Threshold -1 } | Should -Throw
    }
}
