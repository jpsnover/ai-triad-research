# Tag: unit (t/2530)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    M1 regression (t/2530): Protect-UserSecretFile restricts a secret file to the
    current user (chmod 600 on Unix; inheritance-off, owner-only DACL on Windows).
    Pure PS, keyless — always runs.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Protect-UserSecretFile (t/2530 M1)' -Tag 'unit' {

    It 'restricts a file to the current user only' {
        InModuleScope AITriad {
            $f = Join-Path $TestDrive 'secret.env'
            Set-Content -LiteralPath $f -Value 'GEMINI_API_KEY=abc' -Encoding utf8

            Protect-UserSecretFile -Path $f

            if ($IsWindows) {
                $acl = Get-Acl -LiteralPath $f
                # Inheritance disabled and no non-owner accounts retained.
                $acl.AreAccessRulesProtected | Should -BeTrue
                $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
                foreach ($rule in $acl.Access) {
                    $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier])
                    $sid | Should -Be $me
                }
            }
            else {
                # -rw------- : owner read/write, nothing for group/other.
                (Get-Item -LiteralPath $f).UnixMode | Should -Be '-rw-------'
            }
        }
    }

    It 'does not throw when the target is missing (best-effort warn)' {
        InModuleScope AITriad {
            $missing = Join-Path $TestDrive 'nope.env'
            { Protect-UserSecretFile -Path $missing -WarningAction SilentlyContinue } | Should -Not -Throw
        }
    }
}
