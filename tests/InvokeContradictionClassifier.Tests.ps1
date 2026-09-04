# Tag: qbaf (t/3302 fork-B)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Unit tests for the fork-B contradiction-classifier bridge (t/3302).
.DESCRIPTION
    Dot-sources invoke-contradiction-classifier.ps1 with $env:CC_CLASSIFIER_NOEXEC set (so main() is
    skipped) and exercises Convert-ContradictionPairs with STUBBED Get-Prompt / Invoke-AIByUsage — no
    AI, no network. Proves TL's load-bearing conditions (t/3302#16): per-conflict batch, per-pair
    FALLBACK on an incomplete/malformed batch, and NEVER silently dropping a pair (unresolved).
#>

BeforeAll {
    # Stub the two module commands the shim calls, in THIS scope, before dot-sourcing the shim, so its
    # functions bind to the stubs (no AITriad import / no AI). Responses come from a per-test queue.
    $script:CCQueue = [System.Collections.Generic.Queue[string]]::new()
    $script:CCLastBlock = $null

    function Get-Prompt { param($Name, $Replacements) $script:CCLastBlock = [string]$Replacements.pairs_block; return $script:CCLastBlock }
    function Invoke-AIByUsage {
        param($UsageId, $Values, $Override, $ErrorAction)
        if ($script:CCQueue.Count -eq 0) { return [PSCustomObject]@{ Text = '' } }
        return [PSCustomObject]@{ Text = $script:CCQueue.Dequeue() }
    }

    $env:CC_CLASSIFIER_NOEXEC = '1'
    . (Join-Path $PSScriptRoot '..' 'scripts' 'invoke-contradiction-classifier.ps1')
}

AfterAll { Remove-Item Env:\CC_CLASSIFIER_NOEXEC -ErrorAction SilentlyContinue }

Describe 'Convert-ContradictionPairs (fork-B bridge)' -Tag 'qbaf' {

    BeforeEach { $script:CCQueue.Clear() }

    It 'batch success: labels every pair from one batch call, method=llm-batch' {
        $script:CCQueue.Enqueue('{"results":[{"id":"p1","label":"contradict","confidence":0.9},{"id":"p2","label":"neutral","confidence":0.8}]}')
        $pairs = @([pscustomobject]@{ id = 'p1'; a = 'X is 30%'; b = 'X is 10%' },
                   [pscustomobject]@{ id = 'p2'; a = 'cats'; b = 'dogs' })
        $r = Convert-ContradictionPairs -Pairs $pairs -Mode 'per-conflict'
        @($r).Count           | Should -Be 2
        ($r | Where-Object id -eq 'p1').label  | Should -Be 'contradict'
        ($r | Where-Object id -eq 'p1').method | Should -Be 'llm-batch'
        ($r | Where-Object id -eq 'p2').label  | Should -Be 'neutral'
        $script:CCQueue.Count | Should -Be 0 -Because 'one batch call covered both pairs — no per-pair fallback'
    }

    It 'incomplete batch: falls back to per-pair for the missing id (never drops it)' {
        # Batch returns only p1; p2 is missing -> one per-pair call resolves p2.
        $script:CCQueue.Enqueue('{"results":[{"id":"p1","label":"entail","confidence":0.7}]}')
        $script:CCQueue.Enqueue('{"results":[{"id":"p2","label":"contradict","confidence":0.6}]}')
        $pairs = @([pscustomobject]@{ id = 'p1'; a = 'a1'; b = 'b1' },
                   [pscustomobject]@{ id = 'p2'; a = 'a2'; b = 'b2' })
        $r = Convert-ContradictionPairs -Pairs $pairs -Mode 'per-conflict'
        @($r).Count | Should -Be 2
        ($r | Where-Object id -eq 'p1').method | Should -Be 'llm-batch'
        ($r | Where-Object id -eq 'p2').method | Should -Be 'llm-perpair'
        ($r | Where-Object id -eq 'p2').label  | Should -Be 'contradict'
    }

    It 'total failure: emits unresolved, never drops the pair' {
        # Empty queue -> every call returns Text='' -> null map -> unresolved after batch + per-pair.
        $pairs = @([pscustomobject]@{ id = 'p1'; a = 'a1'; b = 'b1' })
        $r = @(Convert-ContradictionPairs -Pairs $pairs -Mode 'per-conflict' -WarningAction SilentlyContinue)
        $r.Count | Should -Be 1
        $r[0].label  | Should -Be 'unresolved'
        $r[0].method | Should -Be 'unresolved'
    }

    It 'invalid label from the batch is treated as missing -> per-pair fallback' {
        $script:CCQueue.Enqueue('{"results":[{"id":"p1","label":"maybe","confidence":0.9}]}')  # bad label
        $script:CCQueue.Enqueue('{"results":[{"id":"p1","label":"neutral","confidence":0.5}]}')
        $pairs = @([pscustomobject]@{ id = 'p1'; a = 'a1'; b = 'b1' })
        $r = @(Convert-ContradictionPairs -Pairs $pairs -Mode 'per-conflict')
        $r[0].label  | Should -Be 'neutral'
        $r[0].method | Should -Be 'llm-perpair'
    }

    It 'pairs block carries both assertion texts (incl. quotes/newlines) safely' {
        $script:CCQueue.Enqueue('{"results":[{"id":"p1","label":"neutral","confidence":0.5}]}')
        $pairs = @([pscustomobject]@{ id = 'p1'; a = 'she said "no"'; b = "line1`nline2" })
        $null = Convert-ContradictionPairs -Pairs $pairs -Mode 'per-conflict'
        $script:CCLastBlock | Should -Match 'she said "no"'
        $script:CCLastBlock | Should -Match 'line2'
    }

    It 'per-pair mode: one call per pair, no batch attempt' {
        $script:CCQueue.Enqueue('{"results":[{"id":"p1","label":"contradict","confidence":0.9}]}')
        $script:CCQueue.Enqueue('{"results":[{"id":"p2","label":"entail","confidence":0.9}]}')
        $pairs = @([pscustomobject]@{ id = 'p1'; a = 'a1'; b = 'b1' },
                   [pscustomobject]@{ id = 'p2'; a = 'a2'; b = 'b2' })
        $r = Convert-ContradictionPairs -Pairs $pairs -Mode 'per-pair'
        @($r).Count | Should -Be 2
        @($r | Where-Object method -eq 'llm-perpair').Count | Should -Be 2
    }
}
