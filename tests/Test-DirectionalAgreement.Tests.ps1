# Tag: taxonomy (t/2743 / t/2745 directional-agreement gate)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Both-arms + fail-safe coverage for Test-DirectionalAgreement — the shared
    directional-agreement gate (stance-polarity-inversion-spec.md §9).
.DESCRIPTION
    The gate wraps `embed_taxonomy.py nli-classify`. Here the python subprocess
    is shadowed by a function that reads the stdin pairs and returns canned NLI
    logits keyed to a marker in text_b, so the three verdict paths and the
    fail-safe path are exercised deterministically without loading the model:
      *ENTAIL*    -> entailment  (agrees)
      *CONTRA*    -> contradiction (opposes)
      *NEUTRAL*   -> neutral      (unrelated)
      *LOWMARGIN* -> entailment with a tiny top-1/top-2 margin (MinMargin arm)
    Empty python output exercises the fail-safe (-> unresolved, method none).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-DirectionalAgreement (t/2745 shared gate)' -Tag 'taxonomy' {

    It 'Maps entailment→agrees, contradiction→opposes, neutral→unrelated in one batch' {
        InModuleScope AITriad {
            function python {
                process {
                    $items = $input | Out-String | ConvertFrom-Json
                    $out = foreach ($it in @($items)) {
                        $lab = 'neutral'; $e = 0.0; $n = 5.0; $c = 0.0
                        if ($it.text_b -match 'ENTAIL')      { $lab = 'entailment';    $e = 6.0; $n = 1.0; $c = 0.0 }
                        elseif ($it.text_b -match 'CONTRA')  { $lab = 'contradiction'; $e = 0.0; $n = 1.0; $c = 6.0 }
                        [pscustomobject]@{
                            idx = $it.idx; text_a = $it.text_a; text_b = $it.text_b
                            nli_label = $lab; nli_entailment = $e; nli_neutral = $n; nli_contradiction = $c
                        }
                    }
                    ConvertTo-Json -InputObject @($out) -Depth 5
                }
            }

            $pairs = @(
                @{ Id = 'a'; ClaimProp = 'AI needs new laws';        NodeProp = 'ENTAIL: AI needs new laws' }
                @{ Id = 'b'; ClaimProp = 'ordinary law suffices';    NodeProp = 'CONTRA: AI needs new laws' }
                @{ Id = 'c'; ClaimProp = 'unrelated topic';          NodeProp = 'NEUTRAL: something else' }
            )
            $r = Test-DirectionalAgreement -Pair $pairs

            @($r).Count | Should -Be 3
            ($r | Where-Object Id -eq 'a').Direction | Should -Be 'agrees'
            ($r | Where-Object Id -eq 'b').Direction | Should -Be 'opposes'
            ($r | Where-Object Id -eq 'c').Direction | Should -Be 'unrelated'
            ($r | Where-Object Id -eq 'a').Method    | Should -Be 'nli'
        }
    }

    It 'FAIL-SAFE: empty NLI output resolves every pair to unresolved/none — never agrees' {
        InModuleScope AITriad {
            # python emits nothing → helper must fail closed.
            function python { process { $null = $input } }

            $r = Test-DirectionalAgreement -Pair @(
                @{ Id = 'x'; ClaimProp = 'p'; NodeProp = 'q' }
            )
            @($r).Count            | Should -Be 1
            $r[0].Direction        | Should -Be 'unresolved'
            $r[0].Method           | Should -Be 'none'
            $r[0].Direction        | Should -Not -Be 'agrees'
        }
    }

    It 'MinMargin downgrades a low-margin entailment to unresolved (extra confidence floor)' {
        InModuleScope AITriad {
            function python {
                process {
                    $items = $input | Out-String | ConvertFrom-Json
                    $out = foreach ($it in @($items)) {
                        # entailment label but tiny top-1/top-2 margin (3.2 vs 3.0 = 0.2)
                        [pscustomobject]@{
                            idx = $it.idx; text_a = $it.text_a; text_b = $it.text_b
                            nli_label = 'entailment'; nli_entailment = 3.2; nli_neutral = 3.0; nli_contradiction = 0.0
                        }
                    }
                    ConvertTo-Json -InputObject @($out) -Depth 5
                }
            }

            $pair = @(@{ Id = 'lm'; ClaimProp = 'p'; NodeProp = 'LOWMARGIN q' })

            # Default MinMargin 0.0 — trusts the engine's label.
            (Test-DirectionalAgreement -Pair $pair)[0].Direction | Should -Be 'agrees'
            # Raise the floor above the 0.2 margin — downgrade to unresolved.
            (Test-DirectionalAgreement -Pair $pair -MinMargin 0.5)[0].Direction | Should -Be 'unresolved'
        }
    }

    It 'Empty pair set returns empty without invoking python' {
        InModuleScope AITriad {
            function python { process { throw 'python must not be called for empty input' } }
            $r = Test-DirectionalAgreement -Pair @()
            @($r).Count | Should -Be 0
        }
    }

    It 'Preserves input order and re-aligns by idx even if the engine reorders rows' {
        InModuleScope AITriad {
            function python {
                process {
                    $items = @($input | Out-String | ConvertFrom-Json)
                    $out = foreach ($it in $items) {
                        $lab = if ($it.text_b -match 'ENTAIL') { 'entailment' } else { 'contradiction' }
                        $e = if ($lab -eq 'entailment') { 6.0 } else { 0.0 }
                        $c = if ($lab -eq 'entailment') { 0.0 } else { 6.0 }
                        [pscustomobject]@{
                            idx = $it.idx; nli_label = $lab
                            nli_entailment = $e; nli_neutral = 1.0; nli_contradiction = $c
                        }
                    }
                    # Return REVERSED to prove idx-based re-alignment.
                    ConvertTo-Json -InputObject @($out[($out.Count-1)..0]) -Depth 5
                }
            }

            $r = Test-DirectionalAgreement -Pair @(
                @{ Id = 'first';  ClaimProp = 'p1'; NodeProp = 'ENTAIL a' }
                @{ Id = 'second'; ClaimProp = 'p2'; NodeProp = 'CONTRA b' }
            )
            $r[0].Id | Should -Be 'first'
            $r[0].Direction | Should -Be 'agrees'
            $r[1].Id | Should -Be 'second'
            $r[1].Direction | Should -Be 'opposes'
        }
    }
}
