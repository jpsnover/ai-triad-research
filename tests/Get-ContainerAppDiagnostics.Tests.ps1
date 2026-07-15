# Tag: taxonomy (t/1500)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Covers Get-ContainerAppDiagnostics (t/1500 Phase 3).
.DESCRIPTION
    Mocks Invoke-Az and Start-Sleep so tests run fast without a live Azure login.
    Verifies happy path, poll loop, poll exhaustion, per-log non-fatal failures,
    and revision-show fatal failure.

    Note on $script: scoping: InModuleScope runs inside the AITriad module's
    script scope. Variables assigned with $script: inside InModuleScope are
    visible to Mock scriptblocks that also run inside that same scope, which
    is how we share mutable state (counters, captured args) between the Mock
    body and the assertions that follow it.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Get-ContainerAppDiagnostics (t/1500)' -Tag 'taxonomy' {

    BeforeEach {
        InModuleScope AITriad {
            Mock Get-Command -ParameterFilter { $Name -eq 'az' } -MockWith {
                [PSCustomObject]@{ Source = 'az' }
            }
            Mock Start-Sleep -MockWith {}
            Mock Write-Warning -MockWith {}
        }
    }

    It 'Happy path: revision show + both log types succeed, LogsAvailable=$true' {
        InModuleScope AITriad {
            $revJson = ([PSCustomObject]@{
                name = 'taxonomy-editor--deploy-abc1234'
                properties = [PSCustomObject]@{
                    runningState  = 'Running'
                    healthState   = 'Healthy'
                    replicas      = 1
                    statusMessage = ''
                }
            }) | ConvertTo-Json -Depth 4 -Compress

            $script:DiagCallSeq = 0
            Mock Invoke-Az -MockWith {
                $script:DiagCallSeq++
                switch ($script:DiagCallSeq) {
                    1 { $revJson }                    # revision show
                    2 { "line1`nline2`nline3" }       # console logs
                    3 { "sysline1`nsysline2" }        # system logs
                    default { $null }
                }
            }

            $r = Get-ContainerAppDiagnostics -RevisionName 'taxonomy-editor--deploy-abc1234'

            $r.RevisionName               | Should -Be 'taxonomy-editor--deploy-abc1234'
            $r.LogsAvailable              | Should -Be $true
            @($r.ConsoleLogs).Count       | Should -BeGreaterThan 0
            @($r.SystemLogs).Count        | Should -BeGreaterThan 0
            $r.RevisionState.RunningState | Should -Be 'Running'
            $r.RevisionState.HealthState  | Should -Be 'Healthy'
            $r.RevisionState.Replicas     | Should -Be 1
        }
    }

    It 'Poll loop: empty console logs twice then available — Start-Sleep called between polls' {
        InModuleScope AITriad {
            $revJson = ([PSCustomObject]@{
                name = 'taxonomy-editor--deploy-abc1234'
                properties = [PSCustomObject]@{
                    runningState = 'Running'; healthState = 'Healthy'
                    replicas = 1; statusMessage = ''
                }
            }) | ConvertTo-Json -Depth 4 -Compress

            $script:DiagLogCallCount = 0
            Mock Invoke-Az -MockWith {
                if ($Arguments -contains 'show' -and $Arguments -notcontains 'logs') {
                    return $revJson
                }
                if ($Arguments -contains 'console') {
                    $script:DiagLogCallCount++
                    if ($script:DiagLogCallCount -le 2) { return $null }
                    return 'log line after poll'
                }
                if ($Arguments -contains 'system') { return 'sysline' }
                return $null
            }

            $r = Get-ContainerAppDiagnostics -RevisionName 'taxonomy-editor--deploy-abc1234'

            $r.LogsAvailable             | Should -Be $true
            $script:DiagLogCallCount     | Should -BeGreaterThan 1
            # Start-Sleep fired once per empty-result gap (2 empties = 2 sleeps)
            Assert-MockCalled Start-Sleep -Times 2 -Scope It
        }
    }

    It 'Poll exhaustion: always empty console logs — LogsAvailable=$false, no throw' {
        InModuleScope AITriad {
            $revJson = ([PSCustomObject]@{
                name = 'taxonomy-editor--deploy-abc1234'
                properties = [PSCustomObject]@{
                    runningState = 'Running'; healthState = 'Healthy'
                    replicas = 1; statusMessage = ''
                }
            }) | ConvertTo-Json -Depth 4 -Compress

            Mock Invoke-Az -MockWith {
                if ($Arguments -contains 'logs') { return $null }
                return $revJson
            }

            # Assign inside InModuleScope so $r is in the same scope as the
            # assertions — the Should-Throw block creates a child scope where
            # $r would be invisible to the outer InModuleScope frame.
            $script:DiagResult = $null
            $threw = $false
            try {
                $script:DiagResult = Get-ContainerAppDiagnostics -RevisionName 'taxonomy-editor--deploy-abc1234'
            } catch {
                $threw = $true
            }

            $threw                              | Should -Be $false
            $script:DiagResult.LogsAvailable   | Should -Be $false
            @($script:DiagResult.ConsoleLogs).Count | Should -Be 0
        }
    }

    It 'Log fetch throws: warning emitted, empty array returned, no throw' {
        InModuleScope AITriad {
            $revJson = ([PSCustomObject]@{
                name = 'taxonomy-editor--deploy-abc1234'
                properties = [PSCustomObject]@{
                    runningState = 'Running'; healthState = 'Healthy'
                    replicas = 1; statusMessage = ''
                }
            }) | ConvertTo-Json -Depth 4 -Compress

            Mock Invoke-Az -MockWith {
                if ($Arguments -contains 'logs') { throw 'log fetch failed' }
                return $revJson
            }

            $script:DiagResult2 = $null
            $threw = $false
            try {
                $script:DiagResult2 = Get-ContainerAppDiagnostics -RevisionName 'taxonomy-editor--deploy-abc1234'
            } catch {
                $threw = $true
            }

            $threw                               | Should -Be $false
            $script:DiagResult2.LogsAvailable   | Should -Be $false
            @($script:DiagResult2.ConsoleLogs).Count | Should -Be 0
            Assert-MockCalled Write-Warning -Scope It -ParameterFilter {
                $Message -match 'non-fatal'
            }
        }
    }

    It 'Revision show failure throws ActionableError' {
        InModuleScope AITriad {
            Mock Invoke-Az -MockWith { throw 'revision not found' }

            { Get-ContainerAppDiagnostics -RevisionName 'taxonomy-editor--does-not-exist' } |
                Should -Throw
        }
    }

    It 'ActionableError when az not on PATH' {
        InModuleScope AITriad {
            Mock Get-Command -ParameterFilter { $Name -eq 'az' } -MockWith { $null }

            { Get-ContainerAppDiagnostics -RevisionName 'taxonomy-editor--deploy-abc1234' } |
                Should -Throw
        }
    }
}
