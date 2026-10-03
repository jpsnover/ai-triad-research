# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Both-arms proof for the t/3865 (t/3819 child E) outlet key-set parity verdict,
# on SYNTHETIC fixtures — no real consumer file is touched to manufacture a
# red. The companion tests/OutletsKeySetGate.Tests.ps1 proves arm 1 (complete
# set passes) against the real repo; this file proves the comparator itself
# correctly refuses on every way a consumer can diverge, including the
# zero-population trap (t/3819 Finding 2).

BeforeAll {
    . (Join-Path $PSScriptRoot '..' 'operations' 'devops' 'OutletKeySetVerdict.ps1')
}

Describe 'Get-OutletKeySetVerdict' {

    Context 'complete match — the passing arm' {
        It 'passes when every consumer key set equals the SSOT and defaults match' {
            $v = Get-OutletKeySetVerdict -SsotKeys @('A', 'B', 'C') -SsotDefault 'A' `
                -ConsumerKeySets @{ ts = @('A', 'B', 'C'); ps = @('C', 'B', 'A') } `
                -ConsumerDefaults @{ renderer = 'A' }
            $v.Passed | Should -BeTrue
            $v.Consumers.ts.Passed | Should -BeTrue
            $v.Consumers.ps.Passed | Should -BeTrue
            $v.DefaultMismatches | Should -BeNullOrEmpty
        }

        It 'is order-independent (ps returns keys in a different order than the SSOT)' {
            $v = Get-OutletKeySetVerdict -SsotKeys @('A', 'B', 'C') -SsotDefault 'A' `
                -ConsumerKeySets @{ ps = @('C', 'A', 'B') }
            $v.Passed | Should -BeTrue
        }
    }

    Context 'deliberately-incomplete consumer — the failing arm the ticket says matters most' {
        It 'REFUSES when one consumer is missing an outlet the SSOT has' {
            $v = Get-OutletKeySetVerdict -SsotKeys @('A', 'B', 'C') -SsotDefault 'A' `
                -ConsumerKeySets @{ ts = @('A', 'B', 'C'); ps = @('A', 'B') }
            $v.Passed | Should -BeFalse
            $v.Consumers.ps.Passed | Should -BeFalse
            $v.Consumers.ps.Missing | Should -Be @('C')
            # the complete consumer must NOT be dragged down by the broken one
            $v.Consumers.ts.Passed | Should -BeTrue
        }

        It 'REFUSES when one consumer has an EXTRA outlet the SSOT does not' {
            $v = Get-OutletKeySetVerdict -SsotKeys @('A', 'B') -SsotDefault 'A' `
                -ConsumerKeySets @{ ps = @('A', 'B', 'Ghost') }
            $v.Passed | Should -BeFalse
            $v.Consumers.ps.Extra | Should -Be @('Ghost')
        }

        It 'REFUSES when a consumer default disagrees with the SSOT default' {
            $v = Get-OutletKeySetVerdict -SsotKeys @('A', 'B') -SsotDefault 'A' `
                -ConsumerKeySets @{ renderer = @('A', 'B') } `
                -ConsumerDefaults @{ renderer = 'B' }
            $v.Passed | Should -BeFalse
            $v.DefaultMismatches.Count | Should -Be 1
        }
    }

    Context 'zero-population — the gate must assert its own output shape (t/3819 Finding 2)' {
        It 'REFUSES, never passes, when a consumer reports ZERO keys while the SSOT is non-empty' {
            $v = Get-OutletKeySetVerdict -SsotKeys @('A', 'B', 'C') -SsotDefault 'A' `
                -ConsumerKeySets @{ ts = @() }
            $v.Passed | Should -BeFalse
            $v.Consumers.ts.ZeroRead | Should -BeTrue
        }

        It 'REFUSES when the SSOT key set itself is empty (caller bug, not a parity question)' {
            $v = Get-OutletKeySetVerdict -SsotKeys @() -SsotDefault '' -ConsumerKeySets @{ ts = @('A') }
            $v.Passed | Should -BeFalse
            $v.SsotCount | Should -Be 0
        }
    }

    Context 'reporting count' {
        It 'exposes SsotCount matching the intended consumer-count assertion the ticket requires' {
            $v = Get-OutletKeySetVerdict -SsotKeys @('A', 'B', 'C', 'D', 'E') -SsotDefault 'A' `
                -ConsumerKeySets @{ ts = @('A', 'B', 'C', 'D', 'E') }
            $v.SsotCount | Should -Be 5
            $v.Consumers.ts.Count | Should -Be 5
        }
    }
}
