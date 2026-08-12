#Requires -Module Pester

<#
.SYNOPSIS
    Regression tests for Test-DebatePersistence (t/2545).
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force
}

Describe 'Test-DebatePersistence' -Tag 'debate', 'persistence' {

    It 'Is exported from the AITriad module' {
        Get-Command -Module AITriad -Name 'Test-DebatePersistence' | Should -Not -BeNullOrEmpty
    }

    It 'Returns Status=OK against a writable temp directory' {
        $Dir = Join-Path ([System.IO.Path]::GetTempPath()) "debate-probe-$([System.IO.Path]::GetRandomFileName())"
        $null = New-Item -ItemType Directory -Path $Dir -Force

        try {
            $result = Test-DebatePersistence -DebatesDir $Dir
            $result.Status     | Should -Be 'OK'
            $result.Path       | Should -Be $Dir
            $result.LockHolder | Should -BeNullOrEmpty
        } finally {
            Remove-Item -LiteralPath $Dir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'Returns a DebatePersistenceResult typed object' {
        $Dir = Join-Path ([System.IO.Path]::GetTempPath()) "debate-probe-$([System.IO.Path]::GetRandomFileName())"
        $null = New-Item -ItemType Directory -Path $Dir -Force

        try {
            $result = Test-DebatePersistence -DebatesDir $Dir
            $result.GetType().Name | Should -Be 'DebatePersistenceResult'
        } finally {
            Remove-Item -LiteralPath $Dir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'Creates the debates directory if it does not exist' {
        $Dir = Join-Path ([System.IO.Path]::GetTempPath()) "debate-probe-missing-$([System.IO.Path]::GetRandomFileName())"
        $Dir | Should -Not -Exist

        try {
            $result = Test-DebatePersistence -DebatesDir $Dir
            $result.Status | Should -Be 'OK'
            $Dir           | Should -Exist
        } finally {
            Remove-Item -LiteralPath $Dir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'Returns Status=NO_PERMISSION when the directory is read-only (Windows ACL)' -Skip:(-not $IsWindows) {
        $Dir = Join-Path ([System.IO.Path]::GetTempPath()) "debate-probe-ro-$([System.IO.Path]::GetRandomFileName())"
        $null = New-Item -ItemType Directory -Path $Dir -Force

        try {
            $acl = Get-Acl $Dir
            $acl.SetAccessRuleProtection($true, $false)
            $denyRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
                [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
                'Write',
                'Deny'
            )
            $acl.AddAccessRule($denyRule)
            Set-Acl -Path $Dir -AclObject $acl

            $result = Test-DebatePersistence -DebatesDir $Dir
            $result.Status | Should -Be 'NO_PERMISSION'
        } finally {
            # Restore write before cleanup
            $acl2 = Get-Acl $Dir
            $acl2.SetAccessRuleProtection($false, $true)
            Set-Acl -Path $Dir -AclObject $acl2 -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $Dir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'Returns Status=LOCKED when Rename-Item throws IOException' {
        # Must use InModuleScope so the mock intercepts the call inside the module
        InModuleScope AITriad {
            $Dir = Join-Path ([System.IO.Path]::GetTempPath()) "debate-probe-locked-$([System.IO.Path]::GetRandomFileName())"
            $null = New-Item -ItemType Directory -Path $Dir -Force
            try {
                Mock Rename-Item { throw [System.IO.IOException]::new('File is locked by another process') }
                $result = Test-DebatePersistence -DebatesDir $Dir
                $result.Status | Should -Be 'LOCKED'
            } finally {
                Remove-Item -LiteralPath $Dir -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }

    It 'Leaves no probe files behind after a successful run' {
        $Dir = Join-Path ([System.IO.Path]::GetTempPath()) "debate-probe-clean-$([System.IO.Path]::GetRandomFileName())"
        $null = New-Item -ItemType Directory -Path $Dir -Force

        try {
            $null = Test-DebatePersistence -DebatesDir $Dir
            @(Get-ChildItem $Dir -Filter 'persist-probe-*').Count | Should -Be 0
        } finally {
            Remove-Item -LiteralPath $Dir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'Leaves no probe files behind after a LOCKED failure' {
        InModuleScope AITriad {
            $Dir = Join-Path ([System.IO.Path]::GetTempPath()) "debate-probe-clean-locked-$([System.IO.Path]::GetRandomFileName())"
            $null = New-Item -ItemType Directory -Path $Dir -Force
            try {
                Mock Rename-Item { throw [System.IO.IOException]::new('File is locked') }
                $null = Test-DebatePersistence -DebatesDir $Dir
                @(Get-ChildItem $Dir -Filter 'persist-probe-*').Count | Should -Be 0
            } finally {
                Remove-Item -LiteralPath $Dir -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
