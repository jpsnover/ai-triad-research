# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
    t/4060 (p/648#98): a just-modified file read AgeHours=-3.49 in EDT. Cause: the mtime side
    (GetLastWriteTimeUtc) was already UTC, but check-data-checkout-drift.ps1's -Now default was
    local Get-Date -- comparing local "now" against a UTC mtime produces a timezone-offset-sized
    error. This test deliberately does NOT pass -Now, so it exercises the real default and would
    have failed before the fix on any machine running a non-UTC timezone (this repo's agents run
    on Windows in EDT/EST). Real bare origin + clone, real script -- no reimplementation.
#>

Describe 'check-data-checkout-drift — UTC age (t/4060)' -Tag 'devops' {

    BeforeAll {
        $script:Script = "$PSScriptRoot/../operations/devops/check-data-checkout-drift.ps1"

        function script:New-Topology {
            $root = Join-Path ([System.IO.Path]::GetTempPath()) ("drift-utc-" + [guid]::NewGuid().ToString('N').Substring(0,8))
            New-Item -ItemType Directory -Path $root -Force | Out-Null
            $origin = Join-Path $root 'origin.git'; $checkout = Join-Path $root 'checkout'
            git init -q --bare --initial-branch=main $origin 2>$null
            git clone -q $origin $checkout 2>$null
            git -C $checkout config user.email t@t; git -C $checkout config user.name t; git -C $checkout config commit.gpgsign false
            'seed' | Out-File -FilePath (Join-Path $checkout 'seed.txt') -Encoding utf8
            git -C $checkout add seed.txt 2>$null; git -C $checkout commit -qm seed 2>$null
            git -C $checkout push -q origin main 2>$null
            return [PSCustomObject]@{ Root = $root; Checkout = $checkout }
        }
    }

    It 'a just-modified untracked file reads AgeHours >= 0, regardless of the runner''s local timezone' {
        $t = script:New-Topology
        try {
            'fresh' | Out-File -FilePath (Join-Path $t.Checkout 'fresh.txt') -Encoding utf8

            # No -Now override -- this exercises the script's real default, which is the exact
            # thing that regressed (local Get-Date compared against a UTC mtime).
            $r = & $script:Script -Checkouts @{ 'under-test' = $t.Checkout } -AgeThresholdHours 24
            $c = $r.Checkouts | Where-Object { $_.Name -eq 'under-test' }

            $c.QueryError | Should -BeNullOrEmpty
            $c.AgeHours | Should -BeGreaterOrEqual 0 -Because 'a file modified moments ago can never be negatively old; a negative value means Now and mtime are on different clocks (local vs UTC)'
            $c.AgeHours | Should -BeLessThan 1 -Because 'the file was just written, so even allowing for test overhead this must stay well under an hour'
        } finally {
            Remove-Item -LiteralPath $t.Root -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
