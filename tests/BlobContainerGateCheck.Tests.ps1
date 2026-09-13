# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Covers Invoke-BlobContainerGateCheck — t/2718 error-class discrimination
    + t/3461 flakiness hardening (bounded retry / fail-fast on definitive RBAC).
.DESCRIPTION
    az storage container show exits non-zero for both ContainerNotFound (404)
    and RBAC failures (AuthorizationPermissionMismatch / AuthenticationFailed, 403).

    t/2718 must-hold: EVERY unresolved non-zero az exit must throw and block —
    categorization is diagnostic-only.

    t/3461: `--auth-mode login` MASKS a transient 403/throttle as ContainerNotFound,
    so ambiguous/transient-class errors are RETRIED (a blip self-heals; a real
    missing container stays missing and still blocks), while a definitive
    AuthorizationPermissionMismatch fails FAST (no retry).

    Tests shadow `az` as a PowerShell function to inject captured stderr fixtures
    and, for retry cases, to vary the result across attempts via a call counter.
    All 8 containers are always passed (the count guard requires exactly 8);
    -RetryDelaySeconds 0 so Pester never actually sleeps. az-call counting keys
    off the total: with 8 containers, no-retry = 8 calls, full-retry = 8*MaxAttempts.
#>

Describe 'Invoke-BlobContainerGateCheck — discrimination + retry (t/2718, t/3461)' {

    BeforeAll {
        $script:GateScript = "$PSScriptRoot/../operations/devops/Invoke-BlobContainerGateCheck.ps1"
        $script:AllContainers = @('analytics', 'staging-analytics', 'user-content', 'staging-user-content', 'community', 'staging-community', 'brief-exports', 'staging-brief-exports')

        function script:Invoke-Gate ([string]$StorageAccount, [string[]]$Containers = $script:AllContainers, [int]$MaxAttempts = 3) {
            & $script:GateScript -StorageAccount $StorageAccount -Containers $Containers -MaxAttempts $MaxAttempts -RetryDelaySeconds 0
        }

        # Captures Write-Host (stream 6) output even when gate throws
        function script:Capture-GateOutput ([string]$StorageAccount, [string[]]$Containers = $script:AllContainers, [int]$MaxAttempts = 3) {
            & { try { & $script:GateScript -StorageAccount $StorageAccount -Containers $Containers -MaxAttempts $MaxAttempts -RetryDelaySeconds 0 } catch {} } 6>&1 | Out-String
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

        It 'prints verified count for all 8 containers' {
            $output = script:Capture-GateOutput -StorageAccount 'myaccount'
            $output | Should -Match 'All 8 blob containers verified'
        }
    }

    Context 'ContainerNotFound — persistent (real missing OR unresolved masked-403) still blocks' {
        BeforeEach {
            function global:az {
                param([Parameter(ValueFromRemainingArguments)][object[]]$azArgs)
                Write-Error 'ERROR: (ContainerNotFound) The specified container does not exist.' -ErrorAction Continue
                $global:LASTEXITCODE = 1
            }
        }
        AfterEach { Remove-Item Function:global:az -ErrorAction SilentlyContinue }

        It 'throws and blocks the deploy after retries are exhausted' {
            { script:Invoke-Gate -StorageAccount 'sa' } | Should -Throw -ExpectedMessage '*check FAILED*'
        }

        It 'final error names the MASKED 403 possibility (does not assert deletion)' {
            $output = script:Capture-GateOutput -StorageAccount 'sa'
            $output | Should -Match '::error::.*MASKED 403'
        }

        It 'final error carries an SP Blob-Data role-state read (t/3462)' {
            $output = script:Capture-GateOutput -StorageAccount 'sa'
            $output | Should -Match 'SP Blob-Data role on sa:'
        }
    }

    Context 'ContainerNotFound with role-state enrichment (t/3462 — best-effort, never blocks)' {
        # Each test installs an az mock that branches by subcommand: container show
        # always NotFound (to reach the notfound branch); identity/SA/roleAssignments
        # calls return fixtures. $global:RoleDefsFixture varies present vs absent.
        # (Mock defined inside It so it registers at run time, not Pester discovery.)
        AfterEach {
            Remove-Item Function:global:az -ErrorAction SilentlyContinue
            Remove-Item Variable:global:RoleDefsFixture -ErrorAction SilentlyContinue
        }

        It 'reports role PRESENT when a Storage Blob Data role is assigned' {
            $global:RoleDefsFixture = '/subscriptions/s/providers/Microsoft.Authorization/roleDefinitions/ba92f5b4-2d11-453d-a403-e96b0029c9fe'
            function global:az {
                param([Parameter(ValueFromRemainingArguments)][object[]]$azArgs)
                if ($azArgs[0] -eq 'storage' -and $azArgs[1] -eq 'container') { Write-Error 'ERROR: (ContainerNotFound) The specified container does not exist.' -ErrorAction Continue; $global:LASTEXITCODE = 1; return }
                if ($azArgs[0] -eq 'account') { Write-Output 'sp-app-id'; $global:LASTEXITCODE = 0; return }
                if ($azArgs[0] -eq 'ad') { Write-Output 'principal-oid'; $global:LASTEXITCODE = 0; return }
                if ($azArgs[0] -eq 'storage' -and $azArgs[1] -eq 'account') { Write-Output '/subscriptions/s/resourceGroups/ai-triad/providers/Microsoft.Storage/storageAccounts/sa'; $global:LASTEXITCODE = 0; return }
                if ($azArgs[0] -eq 'rest') { Write-Output $global:RoleDefsFixture; $global:LASTEXITCODE = 0; return }
                $global:LASTEXITCODE = 0
            }
            $output = script:Capture-GateOutput -StorageAccount 'sa'
            $output | Should -Match 'role PRESENT'
        }

        It 'reports role ABSENT when no blob-data role is assigned' {
            # Reader (acdd72a7…) is a control-plane role, NOT a Storage Blob Data role.
            $global:RoleDefsFixture = '/subscriptions/s/providers/Microsoft.Authorization/roleDefinitions/acdd72a7-3385-48ef-bd42-f606fba81ae7'
            function global:az {
                param([Parameter(ValueFromRemainingArguments)][object[]]$azArgs)
                if ($azArgs[0] -eq 'storage' -and $azArgs[1] -eq 'container') { Write-Error 'ERROR: (ContainerNotFound) The specified container does not exist.' -ErrorAction Continue; $global:LASTEXITCODE = 1; return }
                if ($azArgs[0] -eq 'account') { Write-Output 'sp-app-id'; $global:LASTEXITCODE = 0; return }
                if ($azArgs[0] -eq 'ad') { Write-Output 'principal-oid'; $global:LASTEXITCODE = 0; return }
                if ($azArgs[0] -eq 'storage' -and $azArgs[1] -eq 'account') { Write-Output '/subscriptions/s/resourceGroups/ai-triad/providers/Microsoft.Storage/storageAccounts/sa'; $global:LASTEXITCODE = 0; return }
                if ($azArgs[0] -eq 'rest') { Write-Output $global:RoleDefsFixture; $global:LASTEXITCODE = 0; return }
                $global:LASTEXITCODE = 0
            }
            $output = script:Capture-GateOutput -StorageAccount 'sa'
            $output | Should -Match 'role ABSENT'
        }

        It 'still throws/blocks regardless of role-state (t/2718 must-hold)' {
            function global:az {
                param([Parameter(ValueFromRemainingArguments)][object[]]$azArgs)
                if ($azArgs[0] -eq 'storage' -and $azArgs[1] -eq 'container') { Write-Error 'ERROR: (ContainerNotFound) The specified container does not exist.' -ErrorAction Continue; $global:LASTEXITCODE = 1; return }
                Write-Output ''; $global:LASTEXITCODE = 0
            }
            { script:Invoke-Gate -StorageAccount 'sa' } | Should -Throw -ExpectedMessage '*check FAILED*'
        }
    }

    Context 'ContainerNotFound — transient (clears on retry) → gate passes (t/3461 core)' {
        BeforeEach {
            # Fail the first two az calls (globally) with ContainerNotFound, then
            # succeed for every subsequent call. The first container therefore
            # takes 3 attempts (fail,fail,ok); the remaining 7 succeed first try.
            $global:azCalls = 0
            function global:az {
                param([Parameter(ValueFromRemainingArguments)][object[]]$azArgs)
                $global:azCalls++
                if ($global:azCalls -lt 3) {
                    Write-Error 'ERROR: (ContainerNotFound) The specified container does not exist.' -ErrorAction Continue
                    $global:LASTEXITCODE = 1
                } else {
                    $global:LASTEXITCODE = 0
                }
            }
        }
        AfterEach { Remove-Item Function:global:az -ErrorAction SilentlyContinue }

        It 'does NOT throw — a masked/transient blip self-heals within MaxAttempts' {
            { script:Invoke-Gate -StorageAccount 'sa' } | Should -Not -Throw
        }

        It 'retried the failing container (total az calls exceed the 8 containers)' {
            $global:azCalls = 0
            script:Invoke-Gate -StorageAccount 'sa' 6>$null
            $global:azCalls | Should -BeGreaterThan 8   # 8 would mean zero retries
        }
    }

    Context 'AuthorizationPermissionMismatch (403 — definitive RBAC) fails FAST, no retry (t/3461)' {
        BeforeEach {
            $global:azCalls = 0
            function global:az {
                param([Parameter(ValueFromRemainingArguments)][object[]]$azArgs)
                $global:azCalls++
                Write-Error 'ERROR: (AuthorizationPermissionMismatch) This request is not authorized to perform this operation using this permission.' -ErrorAction Continue
                $global:LASTEXITCODE = 1
            }
        }
        AfterEach { Remove-Item Function:global:az -ErrorAction SilentlyContinue }

        It 'throws and blocks the deploy' {
            { script:Invoke-Gate -StorageAccount 'sa' } | Should -Throw
        }

        It 'emits ::error:: identifying an RBAC denial' {
            $output = script:Capture-GateOutput -StorageAccount 'sa'
            $output | Should -Match '::error::.*RBAC DENIED'
        }

        It 'fail-fast: exactly one az call per container, no retries (8 total, not 24)' {
            $global:azCalls = 0
            $null = script:Capture-GateOutput -StorageAccount 'sa'
            $global:azCalls | Should -Be 8
        }
    }

    Context 'AuthenticationFailed (transient-class) — retried then blocks if unresolved' {
        BeforeEach {
            function global:az {
                param([Parameter(ValueFromRemainingArguments)][object[]]$azArgs)
                Write-Error 'ERROR: (AuthenticationFailed) Server failed to authenticate the request.' -ErrorAction Continue
                $global:LASTEXITCODE = 1
            }
        }
        AfterEach { Remove-Item Function:global:az -ErrorAction SilentlyContinue }

        It 'throws and blocks the deploy after retries' {
            { script:Invoke-Gate -StorageAccount 'sa' } | Should -Throw
        }

        It 'final error is classed transient (not asserted as deletion)' {
            $output = script:Capture-GateOutput -StorageAccount 'sa'
            $output | Should -Match '::error::.*transient-class'
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
        It 'throws sync error when container list is not exactly 8' {
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
