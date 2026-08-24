# Tag: health (t/2671)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Pure-assertion tests for Test-DataPresenceAssertion (t/2671) — the data-presence
    gate used by Invoke-TaxEditorSmokeTest -AssertDataPresence.
.DESCRIPTION
    Gate integrity, proven on synthetic bodies with NO live server:
      PASS arms  — a populated array / {nodes:[...]} resolves Pass=$true.
      FIRE arms  — empty array, empty nodes, the auth INTERSTITIAL (200 text/html),
                   and malformed/null/{nodes:null}/garbage bodies resolve Pass=$false
                   and NEVER throw.
    The interstitial arm is the load-bearing one: it proves the gate catches
    "200-but-not-JSON", not merely empty arrays.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-DataPresenceAssertion (t/2671)' -Tag 'health' {

    Context 'PASS arms — real data resolves Pass=$true' {
        It 'top-level array with rows (entities/organizations shape)' {
            InModuleScope AITriad {
                $rows = @([PSCustomObject]@{ id = 'e1' }, [PSCustomObject]@{ id = 'e2' })
                $r = Test-DataPresenceAssertion -Body $rows -ContentType 'application/json' -CountField '' -Label 'entities'
                $r.Pass  | Should -BeTrue
                $r.Count | Should -Be 2
            }
        }

        It 'object with a populated nodes field (taxonomy shape)' {
            InModuleScope AITriad {
                $body = [PSCustomObject]@{ nodes = @([PSCustomObject]@{ id = 'n1' }, [PSCustomObject]@{ id = 'n2' }, [PSCustomObject]@{ id = 'n3' }) }
                $r = Test-DataPresenceAssertion -Body $body -ContentType 'application/json; charset=utf-8' -CountField 'nodes' -Label 'taxonomy nodes'
                $r.Pass  | Should -BeTrue
                $r.Count | Should -Be 3
            }
        }
    }

    Context 'FIRE arms — the gate must FAIL (Pass=$false), never throw' {
        It 'EMPTY nodes array → Pass=$false, count 0 (the empty-data escape)' {
            InModuleScope AITriad {
                $body = [PSCustomObject]@{ nodes = @() }
                $r = Test-DataPresenceAssertion -Body $body -ContentType 'application/json' -CountField 'nodes' -Label 'taxonomy nodes'
                $r.Pass  | Should -BeFalse
                $r.Count | Should -Be 0
            }
        }

        It 'EMPTY object {} for an array route → Pass=$false, count 0' {
            InModuleScope AITriad {
                $r = Test-DataPresenceAssertion -Body ([PSCustomObject]@{}) -ContentType 'application/json' -CountField '' -Label 'entities'
                $r.Pass  | Should -BeFalse
                $r.Count | Should -Be 0
            }
        }

        It 'STAR: auth Sign-In interstitial (200 text/html) → Pass=$false (200-but-not-JSON)' {
            InModuleScope AITriad {
                # The real escape: cookie-less GET returns the interstitial as text/html.
                $r = Test-DataPresenceAssertion -Body $null -ContentType 'text/html; charset=utf-8' -CountField '' -Label 'entities'
                $r.Pass   | Should -BeFalse
                $r.Reason | Should -Match 'interstitial'
            }
        }

        It 'NULL body with JSON content-type → Pass=$false, no throw' {
            InModuleScope AITriad {
                $r = $null
                { $script:__x = Test-DataPresenceAssertion -Body $null -ContentType 'application/json' -CountField 'nodes' -Label 'taxonomy nodes' } | Should -Not -Throw
                $script:__x.Pass | Should -BeFalse
            }
        }

        It 'MALFORMED {nodes:null} → Pass=$false, no throw' {
            InModuleScope AITriad {
                $body = [PSCustomObject]@{ nodes = $null }
                { $script:__y = Test-DataPresenceAssertion -Body $body -ContentType 'application/json' -CountField 'nodes' -Label 'taxonomy nodes' } | Should -Not -Throw
                $script:__y.Pass | Should -BeFalse
            }
        }

        It 'GARBAGE non-object body (string) → Pass=$false, no throw' {
            InModuleScope AITriad {
                { $script:__z = Test-DataPresenceAssertion -Body '<html>not json</html>' -ContentType 'application/json' -CountField '' -Label 'entities' } | Should -Not -Throw
                $script:__z.Pass | Should -BeFalse
            }
        }
    }
}
