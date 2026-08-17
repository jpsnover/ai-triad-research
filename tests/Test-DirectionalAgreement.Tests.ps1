# Tag: taxonomy (t/2743 / t/2745 / t/2751 directional-agreement gate)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Coverage for Test-DirectionalAgreement — the thin PowerShell wrapper over the
    shared engine scripts/nli_classify.py (t/2751).
.DESCRIPTION
    The wrapper marshals pairs to the engine subprocess and returns its verdicts;
    all NLI/framing/threshold logic lives in the engine (tested by
    scripts/test_nli_classify.py) and on the real deberta model (t/2751#1). Here
    the python subprocess is shadowed by a function that reads the engine's stdin
    contract ([{id,claim_prop,node_prop,...}]) and returns the engine's output
    contract ([{id,direction,confidence,method}]), keyed to a marker in node_prop:
      *OPP*  -> opposes    *AGR* -> agrees    (anything else) -> unrelated
    An empty subprocess output exercises the fail-safe (-> unresolved / none).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-DirectionalAgreement (t/2751 wrapper)' -Tag 'taxonomy' {

    It 'Returns the engine verdict per pair (opposes / agrees / unrelated), order preserved' {
        InModuleScope AITriad {
            function python {
                process {
                    $items = @($input | Out-String | ConvertFrom-Json)
                    $out = foreach ($it in $items) {
                        $dir = if ($it.node_prop -match 'OPP') { 'opposes' }
                               elseif ($it.node_prop -match 'AGR') { 'agrees' }
                               else { 'unrelated' }
                        [pscustomobject]@{ id = $it.id; direction = $dir; confidence = 1.5; method = 'nli' }
                    }
                    ConvertTo-Json -InputObject @($out) -Depth 5
                }
            }

            $r = Test-DirectionalAgreement -Pair @(
                @{ Id = 'a'; ClaimProp = 'p'; NodeProp = 'OPP node' }
                @{ Id = 'b'; ClaimProp = 'p'; NodeProp = 'AGR node' }
                @{ Id = 'c'; ClaimProp = 'p'; NodeProp = 'plain node' }
            )
            @($r).Count | Should -Be 3
            $r[0].Id | Should -Be 'a'; $r[0].Direction | Should -Be 'opposes'
            $r[1].Id | Should -Be 'b'; $r[1].Direction | Should -Be 'agrees'
            $r[2].Id | Should -Be 'c'; $r[2].Direction | Should -Be 'unrelated'
            $r[0].Method | Should -Be 'nli'
        }
    }

    It 'Passes the raw {claim_prop,node_prop,pov} contract to the engine (no PS-side framing)' {
        InModuleScope AITriad {
            $script:captured = $null
            function python {
                process {
                    $script:captured = @($input | Out-String | ConvertFrom-Json)
                    $out = foreach ($it in $script:captured) {
                        [pscustomobject]@{ id = $it.id; direction = 'unrelated'; confidence = 0.0; method = 'nli' }
                    }
                    ConvertTo-Json -InputObject @($out) -Depth 5
                }
            }

            $null = Test-DirectionalAgreement -Pair @(
                @{ Id = 'x'; ClaimProp = 'claim text'; NodeProp = 'node text'; NodePov = 'accelerationist' }
            )
            # Wrapper forwards RAW fields; framing is the engine's job, not here.
            $script:captured[0].claim_prop | Should -Be 'claim text'
            $script:captured[0].node_prop  | Should -Be 'node text'
            $script:captured[0].node_pov   | Should -Be 'accelerationist'
            $script:captured[0].claim_prop | Should -Not -Match 'position is'
        }
    }

    It 'FAIL-SAFE: empty engine output resolves every pair to unresolved/none (never opposes)' {
        InModuleScope AITriad {
            function python { process { $null = $input } }
            $r = Test-DirectionalAgreement -Pair @(@{ Id = 'x'; ClaimProp = 'p'; NodeProp = 'q' })
            @($r).Count     | Should -Be 1
            $r[0].Direction | Should -Be 'unresolved'
            $r[0].Method    | Should -Be 'none'
            $r[0].Direction | Should -Not -Be 'opposes'
        }
    }

    It 'Empty pair set returns empty without invoking the engine' {
        InModuleScope AITriad {
            function python { process { throw 'engine must not be called for empty input' } }
            (Test-DirectionalAgreement -Pair @()) | Should -BeNullOrEmpty
        }
    }

    It 'Re-aligns verdicts by id even if the engine reorders rows' {
        InModuleScope AITriad {
            function python {
                process {
                    $items = @($input | Out-String | ConvertFrom-Json)
                    $out = foreach ($it in $items) {
                        $dir = if ($it.node_prop -match 'OPP') { 'opposes' } else { 'unrelated' }
                        [pscustomobject]@{ id = $it.id; direction = $dir; confidence = 1.0; method = 'nli' }
                    }
                    ConvertTo-Json -InputObject @($out[($out.Count-1)..0]) -Depth 5   # reversed
                }
            }
            $r = Test-DirectionalAgreement -Pair @(
                @{ Id = 'first';  ClaimProp = 'a'; NodeProp = 'plain' }
                @{ Id = 'second'; ClaimProp = 'b'; NodeProp = 'OPP' }
            )
            $r[0].Id | Should -Be 'first';  $r[0].Direction | Should -Be 'unrelated'
            $r[1].Id | Should -Be 'second'; $r[1].Direction | Should -Be 'opposes'
        }
    }
}
