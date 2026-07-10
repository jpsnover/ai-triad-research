# Tag: health (t/1499)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Covers Get-GitHubWorkflowRun -Repo/-Workflow/-CommitSha and -RunId modes (t/1499).
.DESCRIPTION
    Mocks Invoke-GitHubApi to verify both lookup modes and confirm per-
    job conclusions are surfaced structurally (matching the two workflows
    the cmdlet consolidates: container.yml's top-level conclusion check
    and deploy-azure.yml's per-job status gate).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Get-GitHubWorkflowRun by commit SHA (t/1499)' -Tag 'health' {

    It "Returns run object with per-job conclusions for a successful CI run (deploy-azure.yml's use case)" {
        InModuleScope AITriad {
            $sha = '0123456789abcdef0123456789abcdef01234567'

            Mock Invoke-GitHubApi -ParameterFilter { $Endpoint -match '/actions/workflows/ci\.yml/runs\?head_sha=' } -MockWith {
                [PSCustomObject]@{
                    workflow_runs = @(
                        [PSCustomObject]@{
                            id         = 12345
                            status     = 'completed'
                            conclusion = 'success'
                            head_sha   = $sha
                            html_url   = 'https://github.com/x/y/actions/runs/12345'
                        }
                    )
                }
            }
            Mock Invoke-GitHubApi -ParameterFilter { $Endpoint -match '/actions/runs/12345/jobs$' } -MockWith {
                [PSCustomObject]@{
                    jobs = @(
                        [PSCustomObject]@{ name = 'test-powershell'; status = 'completed'; conclusion = 'success' }
                        [PSCustomObject]@{ name = 'test-electron';   status = 'completed'; conclusion = 'success' }
                        [PSCustomObject]@{ name = 'test-container';  status = 'completed'; conclusion = 'success' }
                    )
                }
            }

            $r = Get-GitHubWorkflowRun -Repo 'x/y' -Workflow 'ci.yml' -CommitSha $sha

            $r.RunId              | Should -Be 12345
            $r.Conclusion         | Should -Be 'success'
            $r.HeadSha            | Should -Be $sha
            @($r.Jobs).Count      | Should -Be 3
            ($r.Jobs | Where-Object Name -eq 'test-container').Conclusion | Should -Be 'success'
        }
    }

    It "Returns run object with Conclusion for a still-running workflow (container.yml's use case)" {
        InModuleScope AITriad {
            Mock Invoke-GitHubApi -ParameterFilter { $Endpoint -match '/runs\?head_sha=' } -MockWith {
                [PSCustomObject]@{
                    workflow_runs = @(
                        [PSCustomObject]@{
                            id         = 999
                            status     = 'in_progress'
                            conclusion = $null
                            head_sha   = 'abc'
                            html_url   = 'https://github.com/x/y/actions/runs/999'
                        }
                    )
                }
            }
            Mock Invoke-GitHubApi -ParameterFilter { $Endpoint -match '/runs/999/jobs$' } -MockWith {
                [PSCustomObject]@{ jobs = @() }
            }

            $r = Get-GitHubWorkflowRun -Repo 'x/y' -Workflow 'ci.yml' -CommitSha 'abc'

            $r.RunId       | Should -Be 999
            $r.Status      | Should -Be 'in_progress'
            $r.Conclusion  | Should -BeNullOrEmpty
        }
    }

    It "Returns `$null when no run exists for the SHA (container.yml's error branch)" {
        InModuleScope AITriad {
            Mock Invoke-GitHubApi -MockWith {
                [PSCustomObject]@{ workflow_runs = @() }
            }

            $r = Get-GitHubWorkflowRun -Repo 'x/y' -Workflow 'ci.yml' -CommitSha 'deadbeef'
            $r | Should -BeNullOrEmpty
        }
    }
}

Describe 'Get-GitHubWorkflowRun by RunId (t/1499)' -Tag 'health' {

    It 'Returns the specified run + its jobs when -RunId is provided' {
        InModuleScope AITriad {
            Mock Invoke-GitHubApi -ParameterFilter { $Endpoint -match '/actions/runs/42$' } -MockWith {
                [PSCustomObject]@{
                    id         = 42
                    status     = 'completed'
                    conclusion = 'failure'
                    head_sha   = 'ffee'
                    html_url   = ''
                }
            }
            Mock Invoke-GitHubApi -ParameterFilter { $Endpoint -match '/actions/runs/42/jobs$' } -MockWith {
                [PSCustomObject]@{
                    jobs = @(
                        [PSCustomObject]@{ name = 'test-container'; status = 'completed'; conclusion = 'failure' }
                    )
                }
            }

            $r = Get-GitHubWorkflowRun -Repo 'x/y' -RunId 42

            $r.RunId      | Should -Be 42
            $r.Conclusion | Should -Be 'failure'
            @($r.Jobs).Count | Should -Be 1
        }
    }
}
