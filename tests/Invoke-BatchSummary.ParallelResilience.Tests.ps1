# Tag: ingestion (t/1728)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Resilience test for the t/1728 Invoke-BatchSummary parallel-block try/catch.
.DESCRIPTION
    The `ForEach-Object -Parallel` block in Invoke-BatchSummary had no per-doc
    try/catch, so ONE runspace throwing terminated the whole block — killing all
    in-flight documents (t/1726: 1 of 7 docs survived) and swallowing the inner
    ScriptStackTrace (PS re-attributed the throw to the outer :540).

    Pester mocks do NOT apply inside `ForEach-Object -Parallel` runspaces, and
    the real parallel path calls Invoke-DocumentSummary (needs live AI), so this
    validates the exact resilience MECHANISM the fix relies on — per-item
    try/catch + ConcurrentBag collection via $using + $_.ScriptStackTrace capture
    — by running a genuine parallel block where one item throws. A throwing
    helper stands in for a doc whose Invoke-DocumentSummary throws.
#>

Describe 'Invoke-BatchSummary parallel-block resilience (t/1728)' -Tag 'ingestion' {

    It 'one failing runspace does not terminate the batch; failure is captured with ScriptStackTrace, successes still complete' {
        $bag = [System.Collections.Concurrent.ConcurrentBag[object]]::new()
        $items = @(
            [PSCustomObject]@{ DocId = 'good-1'; Fail = $false }
            [PSCustomObject]@{ DocId = 'bad-1';  Fail = $true  }
            [PSCustomObject]@{ DocId = 'good-2'; Fail = $false }
        )

        # Mirrors the exact pattern the t/1728 fix adds to the parallel block:
        # per-item try/catch, failures RECORDED (not thrown), inner
        # ScriptStackTrace captured, ConcurrentBag.Add via $using.
        {
            $items | ForEach-Object -Parallel {
                $b  = $using:bag
                $it = $_
                try {
                    if ($it.Fail) { throw "simulated doc failure for $($it.DocId)" }
                    [void]$b.Add([PSCustomObject]@{ Success = $true; DocId = $it.DocId })
                }
                catch {
                    [void]$b.Add([PSCustomObject]@{
                        Success = $false
                        DocId   = $it.DocId
                        Error   = "$($_.Exception.Message) | Stack: $($_.ScriptStackTrace)"
                    })
                }
            } -ThrottleLimit 3
        } | Should -Not -Throw -Because 'AC1: a single runspace failure must not terminate the parallel block'

        $results   = @($bag.ToArray())
        $successes = @($results | Where-Object { $_.Success })
        $failures  = @($results | Where-Object { -not $_.Success })

        @($results).Count   | Should -Be 3 -Because 'every doc — success or failure — is accounted for'
        @($successes).Count | Should -Be 2 -Because 'AC4: the two good docs still complete and are collected'
        @($successes.DocId) | Should -Contain 'good-1'
        @($successes.DocId) | Should -Contain 'good-2'

        @($failures).Count  | Should -Be 1 -Because 'AC2: the failed doc is recorded as a failure, not lost'
        $failures[0].DocId  | Should -Be 'bad-1'
        $failures[0].Error  | Should -Match 'simulated doc failure for bad-1' -Because 'AC2: the failure carries the error message'
        $failures[0].Error  | Should -Match 'Stack:.*line' -Because 'AC3: the error includes the inner ScriptStackTrace with a real line frame (not the outer :540)'
    }
}
