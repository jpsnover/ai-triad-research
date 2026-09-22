# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression guard for the t/3546 flake-verdict message CONTENT. The exit-code GV
    arms (deterministic-fail RED / flake GREEN / discovery-error RED) would all stay
    green if a future edit stripped the contention caveat or the per-test duration —
    so the message's honesty is asserted here, in the already-required test-powershell
    gate (TL requirement, t/3546#4).
#>

Describe 'Format-FlakeVerdictMessage — t/3546 verdict honesty' {

    BeforeAll {
        . "$PSScriptRoot/../operations/devops/FlakeVerdict.ps1"
    }

    Context 'per-test line' {
        It 'names the failed test and its duration' {
            $out = Format-FlakeVerdictMessage -FailedTest @(@{ Name = 'Suite.the failing test'; DurationMs = 42 })
            ($out -join "`n") | Should -Match 'Suite\.the failing test'
            ($out -join "`n") | Should -Match '42ms'
        }

        It 'falls back to "unknown duration" when DurationMs is absent (no strict-mode crash)' {
            $out = Format-FlakeVerdictMessage -FailedTest @(@{ Name = 'Suite.no-duration' })
            ($out -join "`n") | Should -Match 'unknown duration'
        }

        It 'emits one line per failed test plus the caveat line' {
            $out = Format-FlakeVerdictMessage -FailedTest @(
                @{ Name = 'A'; DurationMs = 10 },
                @{ Name = 'B'; DurationMs = 20 }
            )
            @($out).Count | Should -Be 3   # 2 test lines + 1 caveat line
        }

        It 'accepts [pscustomobject] entries as well as hashtables' {
            $out = Format-FlakeVerdictMessage -FailedTest @([pscustomobject]@{ Name = 'C'; DurationMs = 7 })
            ($out -join "`n") | Should -Match 'C'
            ($out -join "`n") | Should -Match '7ms'
        }
    }

    Context 'caveat line — the load-bearing honesty (must not be silently stripped)' {
        BeforeAll {
            $script:Msg = (Format-FlakeVerdictMessage -FailedTest @(@{ Name = 'X'; DurationMs = 5 })) -join "`n"
        }

        It 'states the in-job / same-job claim limit' {
            $script:Msg | Should -Match 'same job'
        }
        It 'names TIME_WAIT as a contention class it cannot clear' {
            $script:Msg | Should -Match 'TIME_WAIT'
        }
        It 'names a parallel-shard bind' {
            $script:Msg | Should -Match 'parallel-shard'
        }
        It 'names a held/fixed port' {
            $script:Msg | Should -Match 'port'
        }
        It 'directs the reader to verify with a FRESH run' {
            $script:Msg | Should -Match 'FRESH run'
        }
        It 'references the ticket for the rationale' {
            $script:Msg | Should -Match 't/3546'
        }
        It 'does NOT use the old absolute "FAILED (both runs)" wording' {
            $script:Msg | Should -Not -Match 'FAILED \(both runs\)'
        }
    }

    Context 'empty input' {
        It 'still emits the caveat line when there are no per-test entries' {
            $out = Format-FlakeVerdictMessage -FailedTest @()
            @($out).Count | Should -Be 1
            ($out -join "`n") | Should -Match 't/3546'
        }
    }
}
