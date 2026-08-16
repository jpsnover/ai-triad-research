# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Covers Invoke-BlobContainerGateCheck — t/2718 error-class discrimination.
.DESCRIPTION
    az storage container show exits non-zero for both ContainerNotFound (404)
    and RBAC failures (AuthorizationPermissionMismatch / AuthenticationFailed, 403).
    The gate must emit distinct ::error:: messages so on-call can distinguish a
    missing container from an auth regression. Critically, EVERY non-zero az exit
    must still throw and block the deploy — categorization is diagnostic-only.

    Tests shadow `az` as a PowerShell function to inject captured stderr fixtures.
    The final test proves the unknown/unmatched case still throws (TL requirement,
    e/105#9, t/2718).
#>

Describe 'Invoke-BlobContainerGateCheck — error-class discrimination (t/2718)' {

    BeforeAll {
        $script:GateScript = "$PSScriptRoot/../operations/devops/Invoke-BlobContainerGateCheck.ps1"
        $script:AllContainers = @('analytics', 'staging-analytics', 'user-content', 'staging-user-content', 'community', 'staging-community')

        function script:Invoke-Gate ([string]$StorageAccount, [string[]]$Containers = $script:AllContainers) {
            & $script:GateScript -StorageAccount $StorageAccount -Containers $Containers
        }

        # Captures Write-Host (stream 6) output even when gate throws
        function script:Capture-GateOutput ([string]$StorageAccount, [string[]]$Containers = $script:AllContainers) {
            & { try { & $script:GateScript -StorageAccount $StorageAccount -Containers $Containers } catch {} } 6>&1 | Out-String
        }
    }

    Context 'All containers present' {
        BeforeEach {
            function global:az {
                param([Parameter(ValueFromRemainingArguments)][object[]]$azArgs)
                $global:LASTEXITCODE = 0
            }
        }
        AfterEach { Remove-Item Function:global:az -ErrorAction SilentlyContinue }

        It 'succeeds without throwing' {
            { script:Invoke-Gate -StorageAccount 'myaccount' } | Should -Not -Throw
        }

        It 'prints verified count for all 6 containers' {
            $output = script:Capture-GateOutput -StorageAccount 'myaccount'
            $output | Should -Match 'All 6 blob containers verified'
        }
    }

    Context 'ContainerNotFound (404 — container absent)' {
        BeforeEach {
            function global:az {
                param([Parameter(ValueFromRemainingArguments)][object[]]$azArgs)
                Write-Error 'ERROR: (ContainerNotFound) The specified container does not exist.' -ErrorAction Continue
                $global:LASTEXITCODE = 1
            }
        }
        AfterEach { Remove-Item Function:global:az -ErrorAction SilentlyContinue }

        It 'throws and blocks the deploy' {
            { script:Invoke-Gate -StorageAccount 'sa' } | Should -Throw -ExpectedMessage '*check FAILED*'
        }

        It 'emits ::error:: message mentioning "does not exist"' {
            $output = script:Capture-GateOutput -StorageAccount 'sa'
            $output | Should -Match '::error::.*does not exist'
        }
    }

    Context 'AuthorizationPermissionMismatch (403 — RBAC missing)' {
        BeforeEach {
            function global:az {
                param([Parameter(ValueFromRemainingArguments)][object[]]$azArgs)
                Write-Error 'ERROR: (AuthorizationPermissionMismatch) This request is not authorized to perform this operation using this permission.' -ErrorAction Continue
                $global:LASTEXITCODE = 1
            }
        }
        AfterEach { Remove-Item Function:global:az -ErrorAction SilentlyContinue }

        It 'throws and blocks the deploy' {
            { script:Invoke-Gate -StorageAccount 'sa' } | Should -Throw
        }

        It 'emits ::error:: message mentioning RBAC' {
            $output = script:Capture-GateOutput -StorageAccount 'sa'
            $output | Should -Match '::error::.*RBAC'
        }
    }

    Context 'AuthenticationFailed (403 — auth failure)' {
        BeforeEach {
            function global:az {
                param([Parameter(ValueFromRemainingArguments)][object[]]$azArgs)
                Write-Error 'ERROR: (AuthenticationFailed) Server failed to authenticate the request.' -ErrorAction Continue
                $global:LASTEXITCODE = 1
            }
        }
        AfterEach { Remove-Item Function:global:az -ErrorAction SilentlyContinue }

        It 'throws and blocks the deploy' {
            { script:Invoke-Gate -StorageAccount 'sa' } | Should -Throw
        }

        It 'emits ::error:: message mentioning RBAC (AuthenticationFailed maps to rbac class)' {
            $output = script:Capture-GateOutput -StorageAccount 'sa'
            $output | Should -Match '::error::.*RBAC'
        }
    }

    Context 'Unknown/unmatched az error — must still block (t/2718 must-hold)' {
        BeforeEach {
            function global:az {
                param([Parameter(ValueFromRemainingArguments)][object[]]$azArgs)
                Write-Error 'ERROR: (InternalServerError) An unexpected internal server error occurred.' -ErrorAction Continue
                $global:LASTEXITCODE = 1
            }
        }
        AfterEach { Remove-Item Function:global:az -ErrorAction SilentlyContinue }

        It 'throws even when the az error string matches no known class' {
            { script:Invoke-Gate -StorageAccount 'sa' } | Should -Throw -ExpectedMessage '*check FAILED*'
        }

        It 'emits ::error:: with "unexpected az error" for unknown class' {
            $output = script:Capture-GateOutput -StorageAccount 'sa'
            $output | Should -Match '::error::.*unexpected az error'
        }
    }

    Context 'Count guard' {
        It 'throws sync error when container list is not exactly 6' {
            function global:az { $global:LASTEXITCODE = 0 }
            try {
                { script:Invoke-Gate -StorageAccount 'sa' -Containers @('analytics', 'staging-analytics') } |
                    Should -Throw -ExpectedMessage '*sync error*'
            } finally {
                Remove-Item Function:global:az -ErrorAction SilentlyContinue
            }
        }
    }
}
