# Tag: health (t/2639)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    SHA-scoped CI check in Test-GitHubHealth (t/2639).
.DESCRIPTION
    When -DeployedSha is provided, the ci.yml check must query by exact commit
    SHA (head_sha=) rather than branch=main, so a gh-run-rerun (which preserves
    original created_at) cannot be displaced by a newer branch run that makes the
    per_page=1 branch query return the wrong run. health-monitor.yml is unaffected.
    Fail-closed: zero completed runs for the SHA must FAIL, never silently pass.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-GitHubHealth -DeployedSha SHA-scoped CI check (t/2639)' -Tag 'health' {

    It 'uses head_sha= for ci.yml when DeployedSha is provided and passes on success' {
        InModuleScope AITriad {
            $script:CiUri = $null
            $script:HmUri = $null
            Mock Invoke-RestMethod -MockWith {
                if ($Uri -like '*githubstatus.com*') {
                    return [PSCustomObject]@{ status = [PSCustomObject]@{ indicator = 'none'; description = 'All Systems Operational' } }
                }
                if ($Uri -like '*/actions/workflows/ci.yml*') {
                    $script:CiUri = $Uri
                    return [PSCustomObject]@{ total_count = 1; workflow_runs = @([PSCustomObject]@{ conclusion = 'success'; updated_at = '2026-08-14T10:00:00Z'; run_number = 200 }) }
                }
                if ($Uri -like '*/actions/workflows/health-monitor.yml*') {
                    $script:HmUri = $Uri
                    return [PSCustomObject]@{ total_count = 1; workflow_runs = @([PSCustomObject]@{ conclusion = 'success'; updated_at = '2026-08-14T09:00:00Z'; run_number = 50 }) }
                }
                if ($Uri -like '*/rate_limit*') {
                    return [PSCustomObject]@{ resources = [PSCustomObject]@{ core = [PSCustomObject]@{ remaining = 5000; limit = 5000; reset = 9999999999 } } }
                }
                return [PSCustomObject]@{ visibility = 'public'; default_branch = 'main' }
            }

            $result = Test-GitHubHealth -DeployedSha 'abc1234' 6>$null

            $script:CiUri | Should -Match 'head_sha=abc1234' -Because 'the ci.yml query must use the exact SHA (t/2639 fix)'
            $script:CiUri | Should -Not -Match 'branch=' -Because 'SHA mode must not also filter by branch'
            $script:HmUri | Should -Match 'branch=main' -Because 'health-monitor.yml is unaffected by DeployedSha'

            $ciCheck = $result.Checks | Where-Object { $_.Check -like 'Workflow: ci.yml*' }
            $ciCheck.Pass | Should -BeTrue -Because 'a successful run for the SHA must pass'
            $ciCheck.Check | Should -Match 'abc1234' -Because 'the check label reflects the SHA not the branch'
        }
    }

    It 'fails closed when zero completed runs exist for the SHA (gate integrity)' {
        InModuleScope AITriad {
            Mock Invoke-RestMethod -MockWith {
                if ($Uri -like '*githubstatus.com*') {
                    return [PSCustomObject]@{ status = [PSCustomObject]@{ indicator = 'none'; description = 'All Systems Operational' } }
                }
                if ($Uri -like '*/actions/workflows/ci.yml*') {
                    return [PSCustomObject]@{ total_count = 0; workflow_runs = @() }
                }
                if ($Uri -like '*/rate_limit*') {
                    return [PSCustomObject]@{ resources = [PSCustomObject]@{ core = [PSCustomObject]@{ remaining = 5000; limit = 5000; reset = 9999999999 } } }
                }
                return [PSCustomObject]@{ visibility = 'public'; default_branch = 'main'; total_count = 1;
                    workflow_runs = @([PSCustomObject]@{ conclusion = 'success'; updated_at = '2026-08-14T09:00:00Z'; run_number = 50 }) }
            }

            $result = Test-GitHubHealth -DeployedSha 'deadbeef' 6>$null

            $ciCheck = $result.Checks | Where-Object { $_.Check -like 'Workflow: ci.yml*' }
            $ciCheck.Pass   | Should -BeFalse -Because 'no CI run for the SHA must fail closed, not silently pass (t/2639 requirement)'
            $ciCheck.Detail | Should -Match 'failing closed' -Because 'the detail must name the fail-closed reason for operator visibility'
            $result.Healthy | Should -BeFalse -Because 'a fail-closed ci.yml check must sink overall health'
        }
    }

    It 'legacy path (no DeployedSha) still uses branch=main for ci.yml' {
        InModuleScope AITriad {
            $script:LegacyCiUri = $null
            Mock Invoke-RestMethod -MockWith {
                if ($Uri -like '*githubstatus.com*') {
                    return [PSCustomObject]@{ status = [PSCustomObject]@{ indicator = 'none'; description = 'All Systems Operational' } }
                }
                if ($Uri -like '*/actions/workflows/ci.yml*') {
                    $script:LegacyCiUri = $Uri
                    return [PSCustomObject]@{ total_count = 1; workflow_runs = @([PSCustomObject]@{ conclusion = 'success'; updated_at = '2026-08-14T10:00:00Z'; run_number = 201 }) }
                }
                if ($Uri -like '*/rate_limit*') {
                    return [PSCustomObject]@{ resources = [PSCustomObject]@{ core = [PSCustomObject]@{ remaining = 5000; limit = 5000; reset = 9999999999 } } }
                }
                return [PSCustomObject]@{ visibility = 'public'; default_branch = 'main'; total_count = 1;
                    workflow_runs = @([PSCustomObject]@{ conclusion = 'success'; updated_at = '2026-08-14T09:00:00Z'; run_number = 50 }) }
            }

            $null = Test-GitHubHealth 6>$null

            $script:LegacyCiUri | Should -Match 'branch=main' -Because 'omitting DeployedSha must preserve the existing branch=main behavior'
            $script:LegacyCiUri | Should -Not -Match 'head_sha' -Because 'legacy path must not use SHA querying'
        }
    }
}
