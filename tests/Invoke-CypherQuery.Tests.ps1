# Tag: security (t/3855)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Invoke-CypherQuery rethrows instead of swallowing (t/3855).
.DESCRIPTION
    Invoke-CypherQuery's HTTP/auth catch, and its Cypher-level `errors` array check,
    used to Write-Fail (console only) + a bare `return` -- never rethrow. A caller's
    -ErrorAction Stop had no effect, and a failed query was indistinguishable from a
    query that legitimately returned zero rows (t/3833's Step 6b leaned on this before
    t/3856 worked around it by bypassing Invoke-CypherQuery entirely).

    These tests exercise the real function by mocking Invoke-RestMethod to return each
    of the three failure shapes a real Neo4j HTTP endpoint can produce, plus a happy
    path to protect existing successful-query behavior.
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

Describe 'Invoke-CypherQuery rethrows on failure (t/3855)' -Tag 'security' {

    It 'throws (not returns $null) on HTTP 401 -- the arm that would have falsely "succeeded" before t/3855' {
        $Cred = New-TestCredential -AccountName 'neo4j' -SecretValue 'wrong-password'
        InModuleScope AITriad -Parameters @{ Cred = $Cred } {
            param($Cred)
            Mock Invoke-RestMethod {
                $FakeResponse = [PSCustomObject]@{ StatusCode = 401 }
                $Ex = [System.Exception]::new('Unauthorized')
                $Ex | Add-Member -MemberType NoteProperty -Name Response -Value $FakeResponse -Force
                throw [System.Management.Automation.ErrorRecord]::new(
                    $Ex, 'Neo4jAuthError', [System.Management.Automation.ErrorCategory]::AuthenticationError, $null)
            }

            { Invoke-CypherQuery -Query 'RETURN 1' -Credential $Cred -ErrorAction Stop } | Should -Throw -ExpectedMessage '*401*'
        }
    }

    It 'throws (not returns $null) when the connection fails -- distinguished from unauthorized' {
        $Cred = New-TestCredential -AccountName 'neo4j' -SecretValue 'irrelevant'
        InModuleScope AITriad -Parameters @{ Cred = $Cred } {
            param($Cred)
            Mock Invoke-RestMethod {
                throw [System.Net.Http.HttpRequestException]::new('No connection could be made because the target machine actively refused it.')
            }

            { Invoke-CypherQuery -Query 'RETURN 1' -Credential $Cred -ErrorAction Stop } | Should -Throw -ExpectedMessage '*Could not reach*'
        }
    }

    It 'throws on a Cypher-level error (HTTP 200 with an errors array) -- the third failure mode' {
        $Cred = New-TestCredential -AccountName 'neo4j' -SecretValue 'correct-password'
        InModuleScope AITriad -Parameters @{ Cred = $Cred } {
            param($Cred)
            Mock Invoke-RestMethod {
                [PSCustomObject]@{
                    results = @()
                    errors  = @(@{ code = 'Neo.ClientError.Statement.SyntaxError'; message = 'Invalid input' })
                }
            }

            { Invoke-CypherQuery -Query 'RETURN GARBAGE SYNTAX' -Credential $Cred -ErrorAction Stop } | Should -Throw -ExpectedMessage '*Invalid input*'
        }
    }

    It 'still returns parsed results on success (regression guard)' {
        $Cred = New-TestCredential -AccountName 'neo4j' -SecretValue 'correct-password'
        InModuleScope AITriad -Parameters @{ Cred = $Cred } {
            param($Cred)
            Mock Invoke-RestMethod {
                [PSCustomObject]@{
                    results = @(@{ columns = @('n'); data = @(@{ row = @(1) }) })
                    errors  = @()
                }
            }

            $Result = Invoke-CypherQuery -Query 'RETURN 1 AS n' -Credential $Cred

            $Result.n | Should -Be 1
        }
    }
}
