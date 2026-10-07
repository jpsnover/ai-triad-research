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

Describe 'Get-FlakeRerunVerdict — t/4080 NotRun must never count as healed' {
    BeforeAll {
        . (Join-Path $PSScriptRoot '..' 'operations' 'devops' 'FlakeVerdict.ps1')
        function script:F([string]$p, [string]$file = 'a.Tests.ps1') { [pscustomobject]@{ File = $file; ExpandedPath = $p } }
        function script:T([string]$p, [string]$r, [string]$file = 'a.Tests.ps1') { [pscustomobject]@{ File = $file; ExpandedPath = $p; Result = $r } }
    }

    It 'LAUNDERING ARM (the t/4080 bug): failed test rerun as NotRun -> NOT healed' {
        $v = Get-FlakeRerunVerdict -FailedTests @((F 'S.data-driven beta')) -RerunTests @(
            (T 'S.plain' 'NotRun'), (T 'S.data-driven alpha' 'NotRun'), (T 'S.data-driven beta' 'NotRun'))
        $v.Healed | Should -BeFalse
        @($v.StillFailing).Count | Should -Be 1
    }
    It 'failed test absent from the rerun -> NOT healed, listed as NotRerun' {
        $v = Get-FlakeRerunVerdict -FailedTests @((F 'S.gone')) -RerunTests @((T 'S.other' 'Passed'))
        $v.Healed | Should -BeFalse
        @($v.NotRerun).Count | Should -Be 1
    }
    It 'zero rerun tests -> NOT healed' {
        (Get-FlakeRerunVerdict -FailedTests @((F 'S.a'), (F 'S.b')) -RerunTests @()).Healed | Should -BeFalse
    }
    It 'null rerun result -> NOT healed' {
        (Get-FlakeRerunVerdict -FailedTests @((F 'S.a')) -RerunTests $null).Healed | Should -BeFalse
    }
    It 'genuine flake: every failed test re-ran and PASSED -> healed' {
        $v = Get-FlakeRerunVerdict -FailedTests @((F 'S.a'), (F 'S.b')) -RerunTests @((T 'S.a' 'Passed'), (T 'S.b' 'Passed'), (T 'S.c' 'Passed'))
        $v.Healed | Should -BeTrue
    }
    It 'one of two failed tests still failing -> NOT healed' {
        $v = Get-FlakeRerunVerdict -FailedTests @((F 'S.a'), (F 'S.b')) -RerunTests @((T 'S.a' 'Passed'), (T 'S.b' 'Failed'))
        $v.Healed | Should -BeFalse
        @($v.StillFailing).Count | Should -Be 1
    }
    It 'skipped on rerun is not a pass -> NOT healed' {
        (Get-FlakeRerunVerdict -FailedTests @((F 'S.a')) -RerunTests @((T 'S.a' 'Skipped'))).Healed | Should -BeFalse
    }
    It 'no failed tests -> not "healed" (nothing to heal)' {
        (Get-FlakeRerunVerdict -FailedTests @() -RerunTests @((T 'S.a' 'Passed'))).Healed | Should -BeFalse
    }
    # SO e/279#6: ExpandedPath collisions must not let a Passed copy erase a Failed one.
    It 'DUPLICATE NAME (Passed then Failed, same file) -> NOT healed' {
        (Get-FlakeRerunVerdict -FailedTests @((F 'S.dup')) -RerunTests @((T 'S.dup' 'Passed'), (T 'S.dup' 'Failed'))).Healed | Should -BeFalse
    }
    It 'DUPLICATE NAME (Failed then Passed, same file) -> NOT healed' {
        (Get-FlakeRerunVerdict -FailedTests @((F 'S.dup')) -RerunTests @((T 'S.dup' 'Failed'), (T 'S.dup' 'Passed'))).Healed | Should -BeFalse
    }
    It 'same ExpandedPath in a DIFFERENT file passing does not heal the failed one' {
        $v = Get-FlakeRerunVerdict -FailedTests @((F 'S.x' 'one.Tests.ps1')) -RerunTests @((T 'S.x' 'Passed' 'two.Tests.ps1'))
        $v.Healed | Should -BeFalse
        @($v.NotRerun).Count | Should -Be 1
    }
    It 'two run-1 failures under one key need two passing rerun entries' {
        $v = Get-FlakeRerunVerdict -FailedTests @((F 'S.dup'), (F 'S.dup')) -RerunTests @((T 'S.dup' 'Passed'))
        $v.Healed | Should -BeFalse
        (Get-FlakeRerunVerdict -FailedTests @((F 'S.dup'), (F 'S.dup')) -RerunTests @((T 'S.dup' 'Passed'), (T 'S.dup' 'Passed'))).Healed | Should -BeTrue
    }
}
