# Tag: security (t/3856)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Test-Neo4jAuthProbe — real (not source-grep) verification of the t/3856 repair.
.DESCRIPTION
    t/3833's Step 6b existed to fail loudly on a Neo4j credential mismatch, but its probe
    routed through Invoke-CypherQuery, which catches its own HTTP/auth exceptions internally
    and never rethrows -- so -ErrorAction Stop at that call site was a no-op and the probe
    reported "verified" regardless of outcome. The ONLY prior test of this (t/3833's condition
    4, "both arms tested") was a source-grep on string literals in
    tests/Neo4j-PasswordHardening.Tests.ps1 -- it never executed the verification logic, so it
    could not have caught the defect it was meant to guard.

    These tests exercise Test-Neo4jAuthProbe directly by mocking Invoke-RestMethod to return
    each of the three outcomes a real Neo4j HTTP endpoint can produce, so they discriminate
    actual behavior rather than asserting source text. The 401 and connection-refused arms
    are the ones that matter: a probe built the old way (through Invoke-CypherQuery) would
    report Verified=$true on BOTH of them, so these two arms are exactly the cases that would
    have FAILED against the old implementation -- the evidence SO asked for (e/242#4) that
    this is a real repair, not a restated assumption.
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

Describe 'Test-Neo4jAuthProbe (t/3856)' -Tag 'security' {

    It 'reports Verified=$true when Invoke-RestMethod succeeds (correct credential)' {
        $Cred = New-TestCredential -AccountName 'neo4j' -SecretValue 'correct-password'
        InModuleScope AITriad -Parameters @{ Cred = $Cred } {
            param($Cred)
            Mock Invoke-RestMethod { return @{ results = @(); errors = @() } }

            $Result = Test-Neo4jAuthProbe -Credential $Cred

            $Result.Verified | Should -Be $true
            $Result.Reason | Should -BeNullOrEmpty
        }
    }

    It 'reports Verified=$false with Reason "unauthorized" on an HTTP 401 (wrong credential) -- the arm that would have falsely passed before t/3856' {
        $Cred = New-TestCredential -AccountName 'neo4j' -SecretValue 'wrong-password'
        InModuleScope AITriad -Parameters @{ Cred = $Cred } {
            param($Cred)
            $FakeResponse = [PSCustomObject]@{ StatusCode = 401 }
            Mock Invoke-RestMethod {
                $Ex = [System.Exception]::new('Unauthorized')
                $ErrorRecord = [System.Management.Automation.ErrorRecord]::new(
                    $Ex, 'Neo4jAuthError', [System.Management.Automation.ErrorCategory]::AuthenticationError, $null)
                # Attach a Response property via Add-Member so the probe's $_.Exception.Response check works
                # the same way a real HttpResponseException's would.
                $Ex | Add-Member -MemberType NoteProperty -Name Response -Value $FakeResponse -Force
                throw $ErrorRecord
            }

            $Result = Test-Neo4jAuthProbe -Credential $Cred

            $Result.Verified | Should -Be $false
            $Result.Reason | Should -Be 'unauthorized'
            $Result.Message | Should -Match '401'
        }
    }

    It 'reports Verified=$false with Reason "unreachable" when the connection fails -- the arm that would have falsely passed before t/3856' {
        $Cred = New-TestCredential -AccountName 'neo4j' -SecretValue 'irrelevant'
        InModuleScope AITriad -Parameters @{ Cred = $Cred } {
            param($Cred)
            Mock Invoke-RestMethod {
                throw [System.Net.Http.HttpRequestException]::new('No connection could be made because the target machine actively refused it.')
            }

            $Result = Test-Neo4jAuthProbe -Credential $Cred

            $Result.Verified | Should -Be $false
            $Result.Reason | Should -Be 'unreachable'
            $Result.Message | Should -Match 'could not reach'
        }
    }

    It 'distinguishes unauthorized from unreachable by Reason, not just by failing' {
        $CredWrong = New-TestCredential -AccountName 'neo4j' -SecretValue 'wrong'
        $CredIrrelevant = New-TestCredential -AccountName 'neo4j' -SecretValue 'irrelevant'
        InModuleScope AITriad -Parameters @{ CredWrong = $CredWrong; CredIrrelevant = $CredIrrelevant } {
            param($CredWrong, $CredIrrelevant)
            Mock Invoke-RestMethod {
                $FakeResponse = [PSCustomObject]@{ StatusCode = 401 }
                $Ex = [System.Exception]::new('Unauthorized')
                $Ex | Add-Member -MemberType NoteProperty -Name Response -Value $FakeResponse -Force
                throw [System.Management.Automation.ErrorRecord]::new(
                    $Ex, 'Neo4jAuthError', [System.Management.Automation.ErrorCategory]::AuthenticationError, $null)
            }
            $Unauthorized = Test-Neo4jAuthProbe -Credential $CredWrong

            Mock Invoke-RestMethod { throw [System.Net.Http.HttpRequestException]::new('refused') }
            $Unreachable = Test-Neo4jAuthProbe -Credential $CredIrrelevant

            $Unauthorized.Reason | Should -Not -Be $Unreachable.Reason -Because 'the two failure modes have opposite remedies (t/3833 SO cond.5) and must not collapse to one signal'
        }
    }
}
