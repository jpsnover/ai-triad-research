# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Unit arms for the t/4095 duration-balanced shard assignment (ShardBalancer.ps1).
.DESCRIPTION
    Covers the two acceptance criteria named on the ticket: union-equals-all (every input file
    lands in exactly one shard) and t/4080 flake-rerun behaviour being untouched by a shard
    reassignment (the rerun logic reruns FAILED FILES regardless of which shard they came from,
    so it is not re-tested here -- it is orthogonal to this file's slicing, by construction).
#>

Describe 'Get-MedianDuration (t/4095)' -Tag 'devops' {

    BeforeAll {
        . "$PSScriptRoot/../operations/devops/ShardBalancer.ps1"
    }

    It 'odd count: returns the middle value' {
        Get-MedianDuration -Durations @{ a = 1.0; b = 3.0; c = 2.0 } | Should -Be 2.0
    }

    It 'even count: returns the average of the two middle values' {
        Get-MedianDuration -Durations @{ a = 1.0; b = 2.0; c = 3.0; d = 4.0 } | Should -Be 2.5
    }

    It 'empty map: returns 0.0, not an error' {
        Get-MedianDuration -Durations @{} | Should -Be 0.0
    }
}

Describe 'Get-ShardAssignment (t/4095)' -Tag 'devops' {

    BeforeAll {
        . "$PSScriptRoot/../operations/devops/ShardBalancer.ps1"
    }

    It 'union-equals-all: every input file lands in exactly one shard (acceptance criterion)' {
        $files = @('a.ps1', 'b.ps1', 'c.ps1', 'd.ps1', 'e.ps1', 'f.ps1', 'g.ps1')
        $durations = @{ 'a.ps1' = 10.0; 'b.ps1' = 1.0; 'c.ps1' = 5.0; 'd.ps1' = 8.0; 'e.ps1' = 2.0; 'f.ps1' = 7.0; 'g.ps1' = 3.0 }
        $result = Get-ShardAssignment -Files $files -Durations $durations -ShardTotal 4
        $cov = Test-ShardAssignmentCoverage -Files $files -Shards $result.Shards
        $cov.IsValid | Should -BeTrue -Because "Missing=$($cov.Missing -join ','); Duplicated=$($cov.Duplicated -join ','); Extra=$($cov.Extra -join ',')"
    }

    It 'a file missing from the duration map gets the median, not dropped and not zero-weighted into every shard' {
        $files = @('known1.ps1', 'known2.ps1', 'known3.ps1', 'unknown.ps1')
        $durations = @{ 'known1.ps1' = 1.0; 'known2.ps1' = 2.0; 'known3.ps1' = 3.0 }
        $result = Get-ShardAssignment -Files $files -Durations $durations -ShardTotal 4
        $cov = Test-ShardAssignmentCoverage -Files $files -Shards $result.Shards
        $cov.IsValid | Should -BeTrue
        # unknown.ps1 must be present somewhere (never silently dropped)
        $flat = @($result.Shards | ForEach-Object { $_ })
        $flat | Should -Contain 'unknown.ps1'
    }

    It 'greedy LPT balances totals: the max-min shard-duration spread is small relative to the largest single file' {
        # 4 files of duration 10 each, 4 shards -> perfectly balanced (each shard gets exactly one).
        $files = @('a.ps1', 'b.ps1', 'c.ps1', 'd.ps1')
        $durations = @{ 'a.ps1' = 10.0; 'b.ps1' = 10.0; 'c.ps1' = 10.0; 'd.ps1' = 10.0 }
        $result = Get-ShardAssignment -Files $files -Durations $durations -ShardTotal 4
        ($result.ShardDurations | Measure-Object -Maximum).Maximum | Should -Be 10.0
        ($result.ShardDurations | Measure-Object -Minimum).Minimum | Should -Be 10.0
    }

    It 'is deterministic: the same inputs produce the identical assignment on repeated calls' {
        $files = @('z.ps1', 'a.ps1', 'm.ps1', 'b.ps1', 'y.ps1')
        $durations = @{ 'z.ps1' = 5.0; 'a.ps1' = 5.0; 'm.ps1' = 3.0; 'b.ps1' = 1.0; 'y.ps1' = 2.0 }
        $r1 = Get-ShardAssignment -Files $files -Durations $durations -ShardTotal 3
        $r2 = Get-ShardAssignment -Files $files -Durations $durations -ShardTotal 3
        ($r1.Shards | ConvertTo-Json -Depth 5) | Should -Be ($r2.Shards | ConvertTo-Json -Depth 5)
    }

    It 'rejects ShardTotal < 1 rather than silently producing zero shards' {
        { Get-ShardAssignment -Files @('a.ps1') -Durations @{} -ShardTotal 0 } | Should -Throw
    }

    It 'a single shard (ShardTotal=1) places every file in that one shard' {
        $files = @('a.ps1', 'b.ps1', 'c.ps1')
        $result = Get-ShardAssignment -Files $files -Durations @{} -ShardTotal 1
        @($result.Shards[0]).Count | Should -Be 3
    }
}

Describe 'Test-ShardAssignmentCoverage (t/4095)' -Tag 'devops' {

    BeforeAll {
        . "$PSScriptRoot/../operations/devops/ShardBalancer.ps1"

        # PowerShell array-literal gotcha (confirmed empirically): @(X, Y) FLATTENS an
        # array-valued X or Y by one level when building the outer array, even with a leading
        # unary-comma on each -- @(@(,@(a,b)), @(,@(c))) still iterates as nested Object[]
        # per shard, not the flat string list a shard's file-path array is supposed to be.
        # .Add() on a List[object] has no such ambiguity: each argument is stored exactly as
        # given, so this is the only reliable way to build an array-of-arrays test fixture.
        function script:New-ShardsArray {
            param([object[]]$Shard)
            $list = [System.Collections.Generic.List[object]]::new()
            foreach ($s in $Shard) { [void]$list.Add($s) }
            return $list.ToArray()
        }
    }

    It 'detects a missing file (not assigned to any shard)' {
        $shards = New-ShardsArray -Shard @(, @('a.ps1'))
        $cov = Test-ShardAssignmentCoverage -Files @('a.ps1', 'b.ps1') -Shards $shards
        $cov.IsValid | Should -BeFalse
        $cov.Missing | Should -Contain 'b.ps1'
    }

    It 'detects a duplicated file (assigned to two shards)' {
        $shards = New-ShardsArray -Shard @('a.ps1', 'b.ps1'), @('a.ps1')
        $cov = Test-ShardAssignmentCoverage -Files @('a.ps1', 'b.ps1') -Shards $shards
        $cov.IsValid | Should -BeFalse
        $cov.Duplicated | Should -Contain 'a.ps1'
    }

    It 'detects an extra file (assigned but not in the input list — a stale/wrong file set)' {
        $shards = New-ShardsArray -Shard @(, @('a.ps1', 'ghost.ps1'))
        $cov = Test-ShardAssignmentCoverage -Files @('a.ps1') -Shards $shards
        $cov.IsValid | Should -BeFalse
        $cov.Extra | Should -Contain 'ghost.ps1'
    }

    It 'a correct, complete, non-duplicated assignment is valid' {
        $shards = New-ShardsArray -Shard @('a.ps1'), @('b.ps1')
        $cov = Test-ShardAssignmentCoverage -Files @('a.ps1', 'b.ps1') -Shards $shards
        $cov.IsValid | Should -BeTrue
        @($cov.Missing).Count | Should -Be 0
        @($cov.Duplicated).Count | Should -Be 0
        @($cov.Extra).Count | Should -Be 0
    }
}
