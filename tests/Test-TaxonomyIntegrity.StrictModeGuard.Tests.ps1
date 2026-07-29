# Tag: taxonomy (t/1953)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression guard for the strict-mode property-access gap in
    Test-TaxonomyIntegrity (t/1953).
.DESCRIPTION
    Test-TaxonomyIntegrity runs under `Set-StrictMode -Version Latest`. Under
    that mode, reading a property that does not exist on a ConvertFrom-Json
    object throws PropertyNotFoundException rather than returning $null.

    Check 7 (dangling parent_id) read `$Node.parent_id` unguarded, so a node
    lacking a `parent_id` field made the whole integrity check die with a
    runtime error instead of being handled. This fixture drives the check with
    a node that has no `parent_id` and asserts the cmdlet completes without
    throwing, while still correctly flagging a genuinely dangling parent_id and
    leaving a valid parent_id unflagged.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Synthetic taxonomy fixture. The accelerationist file mixes three shapes:
    #   - acc-beliefs-001 : NO parent_id field at all  -> the t/1953 regression
    #   - acc-desires-002 : parent_id -> acc-beliefs-001 (valid, resolves)
    #   - acc-desires-003 : parent_id -> ghost-999      (dangling, must be flagged)
    $script:FixtureDir = Join-Path ([System.IO.Path]::GetTempPath()) "taxintegrity-t1953-$(Get-Random)"
    $null = New-Item -ItemType Directory -Path $script:FixtureDir -Force

    @{
        pov = 'accelerationist'
        nodes = @(
            @{ id = 'acc-beliefs-001'; label = 'A'; category = 'Beliefs'; description = 'Node A (no parent_id)' }
            @{ id = 'acc-desires-002'; label = 'B'; category = 'Desires'; description = 'Node B'; parent_id = 'acc-beliefs-001' }
            @{ id = 'acc-desires-003'; label = 'C'; category = 'Desires'; description = 'Node C'; parent_id = 'ghost-999' }
        )
    } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $script:FixtureDir 'accelerationist.json') -Encoding utf8NoBOM
    @{ pov = 'safetyist';  nodes = @() } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $script:FixtureDir 'safetyist.json') -Encoding utf8NoBOM
    @{ pov = 'skeptic';    nodes = @() } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $script:FixtureDir 'skeptic.json') -Encoding utf8NoBOM
    @{ pov = 'situations'; nodes = @() } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $script:FixtureDir 'situations.json') -Encoding utf8NoBOM

    # policy_actions.json must exist: the cmdlet references `$Registry` after
    # Check 4, and under strict mode an unassigned variable throws — so an empty
    # registry keeps the run on the code path we actually want to exercise.
    @{ policies = @() } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $script:FixtureDir 'policy_actions.json') -Encoding utf8NoBOM

    # edges.json with one edge that has both source and target — the same
    # strict-mode guard was added to Check 4's edge read (t/1953 sweep).
    @{
        edges = @(
            @{ source = 'acc-beliefs-001'; target = 'acc-desires-002'; type = 'SUPPORTS'; status = 'approved'; confidence = 0.9 }
        )
    } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $script:FixtureDir 'edges.json') -Encoding utf8NoBOM
}

AfterAll {
    if ($script:FixtureDir -and (Test-Path $script:FixtureDir)) {
        Remove-Item -Recurse -Force -Path $script:FixtureDir -ErrorAction SilentlyContinue
    }
}

Describe 'Test-TaxonomyIntegrity strict-mode parent_id guard (t/1953)' -Tag 'taxonomy' {

    BeforeEach {
        InModuleScope AITriad -Parameters @{ FD = $script:FixtureDir } {
            param($FD)
            Mock Get-TaxonomyDir -MockWith ({ $FD }.GetNewClosure())
        }
    }

    It 'Does not throw on a node that lacks a parent_id field (the t/1953 regression)' {
        InModuleScope AITriad {
            # Before the fix this threw PropertyNotFoundException at Check 7.
            { Test-TaxonomyIntegrity -PassThru 6>$null } | Should -Not -Throw
        }
    }

    It 'Still flags the genuinely dangling parent_id and leaves the valid one alone' {
        InModuleScope AITriad {
            $result = Test-TaxonomyIntegrity -PassThru 6>$null
            $dangling = @($result.Details | Where-Object { $_.Check -eq 'DanglingParent' })

            # Exactly one dangling parent_id (acc-desires-003 -> ghost-999).
            # The node with no parent_id and the node with a valid parent_id
            # must NOT contribute.
            $dangling.Count       | Should -Be 1
            $dangling[0].Count    | Should -Be 1
            $dangling[0].Detail   | Should -Match 'ghost-999'
            $dangling[0].Detail   | Should -Not -Match 'acc-beliefs-001'
        }
    }
}
