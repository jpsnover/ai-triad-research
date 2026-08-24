# Tag: situations (t/2747)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Resolve-NliLabelOrDefault fail-closed regression (t/2747).
.DESCRIPTION
    Find-SituationCandidates previously defaulted an unlabeled / NLI-failed similar
    pair to 'entailment' (fail-OPEN: asserting shared-concept agreement it never
    verified). This helper is the fail-closed seam — an absent/empty NliLabel must
    resolve to 'neutral', never 'entailment'. Mirrors the TS exclusionGuard fix
    (PR #1171).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Resolve-NliLabelOrDefault (t/2747 fail-closed)' -Tag 'situations' {

    It 'returns the real label when NliLabel is present' {
        InModuleScope AITriad {
            foreach ($label in 'entailment', 'neutral', 'contradiction') {
                $pair = [PSCustomObject]@{ IdA = 'a'; IdB = 'b'; NliLabel = $label }
                Resolve-NliLabelOrDefault -Pair $pair | Should -Be $label
            }
        }
    }

    It 'fails closed to neutral (NOT entailment) when NliLabel property is absent' {
        InModuleScope AITriad {
            $pair = [PSCustomObject]@{ IdA = 'a'; IdB = 'b'; Similarity = 0.65 }
            $result = Resolve-NliLabelOrDefault -Pair $pair
            $result | Should -Be 'neutral'
            $result | Should -Not -Be 'entailment' -Because 'an unverified pair must never be assumed agreement (t/2747)'
        }
    }

    It 'fails closed to neutral when NliLabel is present but null or empty' {
        InModuleScope AITriad {
            foreach ($empty in $null, '') {
                $pair = [PSCustomObject]@{ IdA = 'a'; IdB = 'b'; NliLabel = $empty }
                Resolve-NliLabelOrDefault -Pair $pair | Should -Be 'neutral'
            }
        }
    }
}
