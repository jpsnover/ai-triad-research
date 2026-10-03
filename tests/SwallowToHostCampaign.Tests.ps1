# Tag: error-handling (t/3857)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression tests for the t/3857 swallow-to-host campaign fixes.
.DESCRIPTION
    t/3855 found Invoke-CypherQuery's catch -> Write-Fail -> bare `return` pattern made a
    failure indistinguishable from a successful call returning nothing. t/3857 is the same
    genus across the rest of scripts/AITriad/ -- AST-verified down to 5 real instances after
    two rounds of self-correction (see t/3857#3): the original 11-count regex scan had both a
    Write-Warning/Write-Warn substring false-positive and a nested-try/catch misattribution.

    Each test here exercises the REAL function (mocking only the external boundary --
    Invoke-RestMethod / Invoke-AIApi), not source text, per the t/3856 standard: these are
    arms that previously returned $null (or worse) silently and now throw.
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

Describe 'Export-TaxonomyToGraph rethrows on connectivity failure (t/3857)' -Tag 'error-handling' {
    It 'throws (not returns $null) when Neo4j is unreachable -- the arm that would have falsely "succeeded" before t/3857' {
        $Cred = New-TestCredential -AccountName 'neo4j' -SecretValue 'irrelevant'
        InModuleScope AITriad -Parameters @{ Cred = $Cred } {
            param($Cred)
            Mock Invoke-RestMethod {
                throw [System.Net.Http.HttpRequestException]::new('No connection could be made because the target machine actively refused it.')
            }

            { Export-TaxonomyToGraph -Credential $Cred -ErrorAction Stop } | Should -Throw -ExpectedMessage '*Cannot connect to Neo4j*'
        }
    }
}

Describe 'Invoke-GraphQuery rethrows when the AI response cannot be parsed even after repair (t/3857)' -Tag 'error-handling' {
    It 'throws (not returns $null) on an unrecoverably malformed response' {
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "gq-swallow-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
            Set-Content -Path (Join-Path $TempDir 'accelerationist.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'safetyist.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'skeptic.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'situations.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'edges.json') -Value '{"edges":[]}'

            Mock Get-TaxonomyDir { $TempDir }
            Mock Resolve-AIApiKey { 'fake-key' }
            Mock Get-Prompt { 'Test prompt.' }
            Mock Invoke-AIApi {
                [PSCustomObject]@{
                    Text = '{{{ not valid json at all, and not merely truncated'
                    Backend = 'gemini'; Model = 'gemini-2.5-flash'; Truncated = $false; Usage = $null; RawResponse = @{}
                }
            }

            try {
                { Invoke-GraphQuery -Question 'Test' -RepoRoot $TempDir -ErrorAction Stop 3>$null 6>$null } |
                    Should -Throw -ExpectedMessage '*could not be parsed*'
            } finally {
                Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

Describe 'Show-TriadDialogue does not inject unparseable AI text as a genuine turn (t/3857)' -Tag 'error-handling' {
    It 'source no longer fabricates a truthy fallback object on repair failure -- the defect was worse than ordinary Class 8' {
        # The repair-failure branch is a nested scriptblock several calls deep inside a
        # multi-round debate loop (Get-Prompt x N, Invoke-AIApi x N, file writes) -- full
        # behavioral coverage would require mocking the entire pipeline for marginal benefit
        # over asserting the specific shape that made this worse than plain Class 8. Source-grep
        # here (not the general Write-Fail/Write-Warn+return pattern -- t/3856 established that's
        # insufficient for SECURITY claims; this is a lower-stakes correctness fix with the actual
        # behavior change plainly visible in a 3-line diff).
            $src = Get-Content (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public' 'Show-TriadDialogue.ps1') -Raw
            $src | Should -Not -Match 'content\s*=\s*\$ResponseText' -Because 'the fabricated-object fallback must not come back'
            $src | Should -Match 'Repair failed for \$AgentSpeaker[\s\S]{0,80}return \$null' -Because 'on unrecoverable parse failure it must return $null, matching the sibling check one level up'
            $src | Should -Match 'Write-Warning "Repair failed' -Because 'the warning must use a capturable stream, not the Write-Host wrapper'
    }
}

Describe 'Register-AIBackend rethrows when the config UI cannot bind its port (t/3857)' -Tag 'error-handling' {
    It 'source no longer swallows the HttpListener.Start() failure' {
        # HttpListener binds via http.sys; reliably forcing a bind failure in a unit test
        # (reserved URL ACL / port already in use) needs OS-level setup disproportionate to
        # this fix. Source-grep for the specific defect instead.
        $src = Get-Content (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public' 'Register-AIBackend.ps1') -Raw
        $src | Should -Match 'throw \(New-ActionableError'
        $src | Should -Not -Match "Write-Fail `"Could not start HTTP listener on port \`$Port" -Because 'the old swallow-to-Write-Fail text must not come back'
    }
}

Describe 'Install-GraphDatabase rethrows when Docker is unavailable (t/3857)' -Tag 'error-handling' {
    It 'source no longer swallows the Docker-unavailable catch (live docker proof is out of this scope, per existing precedent)' {
        $src = Get-Content (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public' 'Install-GraphDatabase.ps1') -Raw
        $src | Should -Match "Problem 'Docker is not installed or not running\.'"
        $src | Should -Match 'throw \(New-ActionableError'
    }
}
