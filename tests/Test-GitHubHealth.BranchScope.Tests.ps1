# Tag: health (t/1975)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Branch-scoping of Test-GitHubHealth's CI-workflow-status check (t/1975).
.DESCRIPTION
    The "Latest Workflow Runs" check queried ci.yml runs with NO branch filter, so
    a red PR/branch run (normal during PR work) false-FAILed the GitHub health
    category in a prod smoke (e/44#32). The fix scopes the workflow-runs query to
    -Branch (default main), relying on the GitHub API's `branch` (head_branch)
    filter to exclude PR runs. These tests mock Invoke-RestMethod (simulating that
    server-side filter) to assert (a) the query carries branch=main, (b) a red
    non-main run does not flip the check, and (c) the escape guard handles a
    '/'-containing branch. Keyless, always runs.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-GitHubHealth branch scoping (t/1975)' -Tag 'health' {

    It 'scopes the workflow-runs query to main and does not false-fail on a red non-main run' {
        InModuleScope AITriad {
            $script:WfUris = @()
            Mock Invoke-RestMethod -MockWith {
                if ($Uri -like '*githubstatus.com*') {
                    return [PSCustomObject]@{ status = [PSCustomObject]@{ indicator = 'none'; description = 'All Systems Operational' } }
                }
                if ($Uri -like '*/actions/workflows/*') {
                    $script:WfUris += $Uri
                    # Simulate the GitHub API head_branch filter: only main runs come
                    # back when branch=main; an UNSCOPED query would surface a red PR run.
                    if ($Uri -like '*branch=main*') {
                        return [PSCustomObject]@{ total_count = 1; workflow_runs = @([PSCustomObject]@{ conclusion = 'success'; updated_at = '2026-07-29T12:00:00Z'; run_number = 100 }) }
                    }
                    return [PSCustomObject]@{ total_count = 1; workflow_runs = @([PSCustomObject]@{ conclusion = 'failure'; updated_at = '2026-07-29T11:00:00Z'; run_number = 99 }) }
                }
                if ($Uri -like '*/rate_limit*') {
                    return [PSCustomObject]@{ resources = [PSCustomObject]@{ core = [PSCustomObject]@{ remaining = 5000; limit = 5000; reset = 9999999999 } } }
                }
                return [PSCustomObject]@{ visibility = 'public'; default_branch = 'main' }  # repo endpoint
            }

            $result = Test-GitHubHealth 6>$null

            @($script:WfUris).Count | Should -Be 3 -Because 'all three key workflows are queried'
            foreach ($u in $script:WfUris) { $u | Should -Match 'branch=main' -Because 'the query must be scoped to the deployed line' }

            $wfChecks = @($result.Checks | Where-Object { $_.Check -like 'Workflow:*' })
            @($wfChecks).Count | Should -Be 3
            @($wfChecks | Where-Object { -not $_.Pass }).Count | Should -Be 0 -Because 'branch=main returns only the green main run; the red non-main run is filtered out (the t/1975 fix)'
            $wfChecks[0].Check | Should -Match '@main' -Because 'the scoping is visible in the check label'
        }
    }

    It 'escapes a branch name containing "/" in the query (release/v2 -> release%2Fv2)' {
        InModuleScope AITriad {
            $script:WfUris2 = @()
            Mock Invoke-RestMethod -MockWith {
                if ($Uri -like '*githubstatus.com*') { return [PSCustomObject]@{ status = [PSCustomObject]@{ indicator = 'none'; description = 'ok' } } }
                if ($Uri -like '*/actions/workflows/*') {
                    $script:WfUris2 += $Uri
                    return [PSCustomObject]@{ total_count = 0; workflow_runs = @() }
                }
                if ($Uri -like '*/rate_limit*') { return [PSCustomObject]@{ resources = [PSCustomObject]@{ core = [PSCustomObject]@{ remaining = 5000; limit = 5000; reset = 9999999999 } } } }
                return [PSCustomObject]@{ visibility = 'public'; default_branch = 'main' }
            }

            $null = Test-GitHubHealth -Branch 'release/v2' 6>$null

            foreach ($u in $script:WfUris2) {
                $u | Should -Match 'branch=release%2Fv2' -Because 'EscapeDataString must encode the / so the query param is well-formed'
                $u | Should -Not -Match 'branch=release/v2'
            }
        }
    }
}
