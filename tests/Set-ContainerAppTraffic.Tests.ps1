# Tag: taxonomy (t/1500)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Covers Set-ContainerAppTraffic (t/1500 Phase 3).
.DESCRIPTION
    Mocks Invoke-Az and Start-Sleep so tests run fast without a live Azure login.
    Verifies success on first try, retry behaviour, retry exhaustion, and validation.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Set-ContainerAppTraffic (t/1500)' -Tag 'taxonomy' {

    BeforeEach {
        InModuleScope AITriad {
            Mock Get-Command -ParameterFilter { $Name -eq 'az' } -MockWith {
                [PSCustomObject]@{ Source = 'az' }
            }
            # Suppress actual sleeps so the suite stays fast.
            Mock Start-Sleep -MockWith {}
        }
    }

    It 'Happy path: succeeds on first attempt (AttemptCount=1, Success=$true)' {
        InModuleScope AITriad {
            Mock Invoke-Az -MockWith { $null }

            $r = Set-ContainerAppTraffic -RevisionName 'taxonomy-editor--rev-new' -Weight 100

            $r.Success      | Should -Be $true
            $r.AttemptCount | Should -Be 1
            $r.RevisionName | Should -Be 'taxonomy-editor--rev-new'
            $r.Weight       | Should -Be 100
        }
    }

    It 'Retries: fails N-1 times then succeeds (AttemptCount=N)' {
        InModuleScope AITriad {
            # Use $script: so the counter is readable inside the Mock scriptblock
            # and also after the cmdlet returns — InModuleScope closures share the
            # module's script scope.
            $script:TrafficCallCount = 0
            Mock Invoke-Az -MockWith {
                $script:TrafficCallCount++
                if ($script:TrafficCallCount -lt 3) { throw 'transient az error' }
                $null
            }

            $r = Set-ContainerAppTraffic `
                -RevisionName 'taxonomy-editor--rev-new' `
                -Weight 100 `
                -MaxAttempts 5 `
                -RetryIntervalSec 1

            $r.Success      | Should -Be $true
            $r.AttemptCount | Should -Be 3
            Assert-MockCalled Start-Sleep -Times 2 -Scope It
        }
    }

    It 'Exhausts retries: throws ActionableError after MaxAttempts' {
        InModuleScope AITriad {
            Mock Invoke-Az -MockWith { throw 'persistent az error' }

            { Set-ContainerAppTraffic `
                -RevisionName 'taxonomy-editor--rev-new' `
                -Weight 100 `
                -MaxAttempts 3 `
                -RetryIntervalSec 1 } |
                Should -Throw

            Assert-MockCalled Invoke-Az   -Times 3 -Scope It
            Assert-MockCalled Start-Sleep -Times 2 -Scope It
        }
    }

    It 'ValidateRange rejects -Weight 101' {
        InModuleScope AITriad {
            { Set-ContainerAppTraffic -RevisionName 'taxonomy-editor--rev-new' -Weight 101 } |
                Should -Throw
        }
    }

    It 'ValidateRange rejects -Weight -1' {
        InModuleScope AITriad {
            { Set-ContainerAppTraffic -RevisionName 'taxonomy-editor--rev-new' -Weight -1 } |
                Should -Throw
        }
    }

    It 'ActionableError when az not on PATH' {
        InModuleScope AITriad {
            Mock Get-Command -ParameterFilter { $Name -eq 'az' } -MockWith { $null }

            { Set-ContainerAppTraffic -RevisionName 'taxonomy-editor--rev-new' -Weight 100 } |
                Should -Throw
        }
    }
}
