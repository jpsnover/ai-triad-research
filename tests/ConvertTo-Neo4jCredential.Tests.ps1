# Tag: security (t/3839)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    ConvertTo-Neo4jCredential round-trip (t/3839).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'ConvertTo-Neo4jCredential (t/3839)' -Tag 'security' {

    It 'builds a PSCredential whose UserName and GetNetworkCredential().Password round-trip the inputs' {
        InModuleScope AITriad {
            $Cred = ConvertTo-Neo4jCredential -Principal 'neo4j' -Secret 'correct-password'

            $Cred | Should -BeOfType [System.Management.Automation.PSCredential]
            $Cred.UserName | Should -Be 'neo4j'
            $Cred.GetNetworkCredential().Password | Should -Be 'correct-password'
        }
    }

    It 'has no Username/Password-named parameters (PSAvoidUsingUsernameAndPasswordParams)' {
        $cmd = InModuleScope AITriad { Get-Command ConvertTo-Neo4jCredential }
        $cmd.Parameters.Keys | Should -Not -Contain 'User'
        $cmd.Parameters.Keys | Should -Not -Contain 'Password'
    }
}
