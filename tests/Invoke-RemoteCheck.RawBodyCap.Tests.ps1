# Tag: taxonomy (t/1500#7 — SPA-shell RawBody truncation false-negative)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression guard for the RawBody slice size in Private/Invoke-RemoteCheck
    (t/1500 production acceptance test).
.DESCRIPTION
    DevOps traced a false-positive SPA shell failure to RawBody being capped
    at 400 chars — this app's <head> is 464+ chars before Vite injects the
    root div + script tag, so the shell markers ALWAYS fell past the slice.
    The cap was bumped 400 → 4096 to give ~10× headroom.

    This suite locks the new invariant: any HTML body ≤ 4096 chars must
    round-trip in RawBody as-is, and the SPA-shell markers must remain
    visible in the slice for a realistic 464-char-head + Vite injection.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Invoke-RemoteCheck RawBody cap (t/1500#7 regression)' -Tag 'taxonomy' {

    It 'Preserves both div#root and script tag markers when both fall past the old 400 cap' {
        InModuleScope AITriad {
            # Reproduce the exact class of body that broke production:
            # a 500-char <head> followed by the SPA shell markers. Under the
            # old 400 cap, both markers fell off the slice; under the new
            # 4096 cap, both survive.
            $head = '<!doctype html><html><head>' + ('x' * 500) + '</head><body>'
            $spa  = '<div id="root"></div><script type="module" src="/assets/index-abc123.js"></script></body></html>'
            $realistic = $head + $spa

            Mock Invoke-WebRequest -MockWith {
                [PSCustomObject]@{
                    StatusCode = 200
                    Content    = $realistic
                    Headers    = @{ 'Content-Type' = @('text/html; charset=utf-8') }
                }
            }
            $r = Invoke-RemoteCheck -BaseUrl 'https://x' -Path '/'
            $r.Success   | Should -BeTrue
            $r.RawBody.Length | Should -BeGreaterThan 500 -Because 'the 400 cap that broke production is gone'
            $r.RawBody   | Should -Match '<div\s+id="root"'   -Because 'SPA shell root-div marker must survive the slice'
            $r.RawBody   | Should -Match 'src="[^"]+\.js"'    -Because 'SPA shell script-tag marker must survive the slice'
        }
    }

    It 'Round-trips a body shorter than the cap verbatim' {
        InModuleScope AITriad {
            $short = '<html><body>ok</body></html>'
            Mock Invoke-WebRequest -MockWith {
                [PSCustomObject]@{
                    StatusCode = 200
                    Content    = $short
                    Headers    = @{ 'Content-Type' = @('text/html') }
                }
            }
            $r = Invoke-RemoteCheck -BaseUrl 'https://x' -Path '/'
            $r.RawBody | Should -Be $short
        }
    }

    It 'Truncates to the 4096 cap when the body is larger' {
        InModuleScope AITriad {
            $huge = ('a' * 10000)
            Mock Invoke-WebRequest -MockWith {
                [PSCustomObject]@{
                    StatusCode = 200
                    Content    = $huge
                    Headers    = @{ 'Content-Type' = @('text/html') }
                }
            }
            $r = Invoke-RemoteCheck -BaseUrl 'https://x' -Path '/'
            $r.RawBody.Length | Should -Be 4096 -Because 'cap enforced'
        }
    }
}
