# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Guard Testability (t/2971) for the deploy-drift gate (t/3278): both arms of the pure
# predicate proven directly — the alert FIRES when prod is stale past the threshold and
# stays SILENT for each not-drift condition — without needing a live stale deployment.
# 4 cases per TL GV (t/3278#4): fire; current; within-threshold; unreachable.

BeforeAll {
    . "$PSScriptRoot/../operations/devops/Get-DeployDriftVerdict.ps1"
}

Describe 'Get-DeployDriftVerdict' {

    Context 'FIRE arm — shippable work stranded past the threshold' {
        It 'fires when un-deployed work is older than N hours' {
            $v = Get-DeployDriftVerdict -RunningBuildSha 'abc123' -UndeployedAgeHours 30 -ThresholdHours 24
            $v.Fire | Should -BeTrue
            $v.Reason | Should -BeLike 'stale:*'
        }

        It 'fires exactly AT the threshold boundary (>= is inclusive)' {
            $v = Get-DeployDriftVerdict -RunningBuildSha 'abc123' -UndeployedAgeHours 24 -ThresholdHours 24
            $v.Fire | Should -BeTrue
        }
    }

    Context 'SILENT arm — not drift' {
        It 'is silent when prod == main HEAD (nothing un-deployed): reason current' {
            $v = Get-DeployDriftVerdict -RunningBuildSha 'abc123' -UndeployedAgeHours 0 -ThresholdHours 24
            $v.Fire | Should -BeFalse
            $v.Reason | Should -Be 'current'
        }

        It 'is silent for a normal deploy window under the threshold: reason within-threshold' {
            $v = Get-DeployDriftVerdict -RunningBuildSha 'abc123' -UndeployedAgeHours 5 -ThresholdHours 24
            $v.Fire | Should -BeFalse
            $v.Reason | Should -Be 'within-threshold'
        }

        It 'treats an unreachable/empty buildSha as NOT drift (TL cond. 2): reason unreachable' {
            $v = Get-DeployDriftVerdict -RunningBuildSha '' -UndeployedAgeHours 999 -ThresholdHours 24
            $v.Fire | Should -BeFalse
            $v.Reason | Should -Be 'unreachable'
        }

        It "treats the 'unknown' BUILD_SHA sentinel as NOT drift even with huge age" {
            $v = Get-DeployDriftVerdict -RunningBuildSha 'unknown' -UndeployedAgeHours 999 -ThresholdHours 24
            $v.Fire | Should -BeFalse
            $v.Reason | Should -Be 'unreachable'
        }

        It 'treats $null buildSha as NOT drift (probe returned no field)' {
            $v = Get-DeployDriftVerdict -RunningBuildSha $null -UndeployedAgeHours 999 -ThresholdHours 24
            $v.Fire | Should -BeFalse
            $v.Reason | Should -Be 'unreachable'
        }
    }

    Context 'Precedence — unreachable dominates staleness' {
        It 'reports unreachable (not stale) when buildSha is empty AND age exceeds threshold' {
            # A broken probe must never masquerade as a stale-image fire (t/3110 sink lesson).
            $v = Get-DeployDriftVerdict -RunningBuildSha '   ' -UndeployedAgeHours 100 -ThresholdHours 24
            $v.Fire | Should -BeFalse
            $v.Reason | Should -Be 'unreachable'
        }
    }
}
