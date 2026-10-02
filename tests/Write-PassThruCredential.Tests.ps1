# Tag: security (t/3839)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Write-PassThruCredential — the single invariant backing -PassThru (t/3839, SO e/242#2).
.DESCRIPTION
    A credential is emitted IFF it authenticates this invocation; otherwise nothing is emitted
    and a warning names why. Both arms are mocked at the Test-Neo4jAuthProbe boundary (not
    Invoke-RestMethod) since that boundary is already covered by Test-Neo4jAuthProbe.Tests.ps1 —
    this file verifies Write-PassThruCredential's own branching, not the probe's HTTP behavior.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    function New-TestCredential([string]$AccountName, [string]$SecretValue) {
        $Sec = [System.Security.SecureString]::new()
        foreach ($ch in $SecretValue.ToCharArray()) { $Sec.AppendChar($ch) }
        $Sec.MakeReadOnly()
        return [System.Management.Automation.PSCredential]::new($AccountName, $Sec)
    }
}

Describe 'Write-PassThruCredential (t/3839)' -Tag 'security' {

    It 'emits the credential when Test-Neo4jAuthProbe reports Verified -- round-trips GetNetworkCredential().Password' {
        $Cred = New-TestCredential -AccountName 'neo4j' -SecretValue 'correct-password'
        InModuleScope AITriad -Parameters @{ Cred = $Cred } {
            param($Cred)
            Mock Test-Neo4jAuthProbe { [PSCustomObject]@{ Verified = $true; Reason = $null; Message = $null } }

            $Result = Write-PassThruCredential -Credential $Cred

            $Result | Should -Not -BeNullOrEmpty
            $Result.GetNetworkCredential().Password | Should -Be 'correct-password'
        }
    }

    It 'emits nothing and warns when Test-Neo4jAuthProbe reports unauthorized -- the arm that matters' {
        $Cred = New-TestCredential -AccountName 'neo4j' -SecretValue 'wrong-password'
        InModuleScope AITriad -Parameters @{ Cred = $Cred } {
            param($Cred)
            Mock Test-Neo4jAuthProbe { [PSCustomObject]@{ Verified = $false; Reason = 'unauthorized'; Message = 'credential rejected (HTTP 401)' } }
            Mock Write-Warn {}

            $Result = Write-PassThruCredential -Credential $Cred

            $Result | Should -BeNullOrEmpty
            Should -Invoke Write-Warn -Times 1 -ParameterFilter { $M -match 'unauthorized' }
        }
    }

    It 'emits nothing and warns when Test-Neo4jAuthProbe reports unreachable -- distinguished from unauthorized' {
        $Cred = New-TestCredential -AccountName 'neo4j' -SecretValue 'irrelevant'
        InModuleScope AITriad -Parameters @{ Cred = $Cred } {
            param($Cred)
            Mock Test-Neo4jAuthProbe { [PSCustomObject]@{ Verified = $false; Reason = 'unreachable'; Message = 'could not reach http://localhost:7474' } }
            Mock Write-Warn {}

            $Result = Write-PassThruCredential -Credential $Cred

            $Result | Should -BeNullOrEmpty
            Should -Invoke Write-Warn -Times 1 -ParameterFilter { $M -match 'unreachable' }
        }
    }
}
