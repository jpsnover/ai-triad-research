# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Guard Testability (t/2971) for the G8b sweep-stall alert (t/3279). The alert's real behavior only
# surfaces in deployed Azure Monitor KQL, so both arms are proven here directly against the model
# predicate. Four cases per TL GV t/3279#2: FIRE = fail + no sweep in N + elapsed; SILENT = swept /
# no-failure / window-not-elapsed.

BeforeAll {
    . "$PSScriptRoot/../operations/devops/Get-SweepStallVerdict.ps1"
}

Describe 'Get-SweepStallVerdict' {

    Context 'FIRE arm — failed inline reconcile sat un-swept past the grace window' {
        It 'fires when a failure is older than N with no sweep in its window' {
            $v = Get-SweepStallVerdict -FailureAgeHours 3 -SweptWithinWindow $false -ThresholdHours 2
            $v.Fire | Should -BeTrue
            $v.Reason | Should -Be 'stalled-backlog'
        }
        It 'fires exactly AT the threshold boundary (>= elapsed)' {
            $v = Get-SweepStallVerdict -FailureAgeHours 2 -SweptWithinWindow $false -ThresholdHours 2
            $v.Fire | Should -BeTrue
        }
    }

    Context 'SILENT arm — not a stall' {
        It '(a) is silent when a sweep drained the backlog within N: reason swept' {
            $v = Get-SweepStallVerdict -FailureAgeHours 5 -SweptWithinWindow $true -ThresholdHours 2
            $v.Fire | Should -BeFalse
            $v.Reason | Should -Be 'swept'
        }
        It '(b) is silent when there was NO inline failure (benign cold): reason no-failure' {
            $v = Get-SweepStallVerdict -FailureAgeHours -1 -SweptWithinWindow $false -ThresholdHours 2
            $v.Fire | Should -BeFalse
            $v.Reason | Should -Be 'no-failure'
        }
        It '(c) is silent when the failure is too recent — window not elapsed (grace period)' {
            $v = Get-SweepStallVerdict -FailureAgeHours 1 -SweptWithinWindow $false -ThresholdHours 2
            $v.Fire | Should -BeFalse
            $v.Reason | Should -Be 'window-not-elapsed'
        }
    }

    Context 'Precedence — swept dominates staleness; no-failure dominates all' {
        It 'reports swept (not stalled) even when the failure is very old but was swept' {
            $v = Get-SweepStallVerdict -FailureAgeHours 24 -SweptWithinWindow $true -ThresholdHours 2
            $v.Fire | Should -BeFalse
            $v.Reason | Should -Be 'swept'
        }
        It 'no-failure short-circuits before the swept/elapsed checks' {
            $v = Get-SweepStallVerdict -FailureAgeHours -1 -SweptWithinWindow $true -ThresholdHours 2
            $v.Reason | Should -Be 'no-failure'
        }
    }
}
