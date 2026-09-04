# Tag: ingestion (t/3310 — shared WAF-fetch wrapper)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Get-UrlViaSharedFetcher — the shared PS wrapper over the Node fetch-CLI (t/3310/t/3324).
.DESCRIPTION
    Covers the load-bearing contract mapping (ConvertFrom-FetchCliOutput — pure, no node spawn) and
    the pre-flight guards. Both are private, exercised via InModuleScope.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue
}

Describe 'ConvertFrom-FetchCliOutput — frozen t/3324 contract' -Tag 'ingestion' {

    It 'maps status/contentType/finalUrl/bodySnippet from valid CLI JSON' {
        $r = InModuleScope AITriad {
            ConvertFrom-FetchCliOutput -Stdout '{"status":200,"contentType":"application/pdf","finalUrl":"https://x/y.pdf","error":null,"bodySnippet":"hello"}' `
                -Stderr '' -ExitCode 0 -OutPath 'C:\tmp\out.bin' -Url 'https://x/y.pdf'
        }
        $r.Status      | Should -Be 200
        $r.ContentType | Should -Be 'application/pdf'
        $r.FinalUrl    | Should -Be 'https://x/y.pdf'
        $r.BodySnippet | Should -Be 'hello'
        $r.OutPath     | Should -Be 'C:\tmp\out.bin'
        $r.Error       | Should -BeNullOrEmpty
    }

    It 'carries an HTTP-error status + error reason through' {
        $r = InModuleScope AITriad {
            ConvertFrom-FetchCliOutput -Stdout '{"status":403,"contentType":"","finalUrl":"","error":"forbidden","bodySnippet":"blocked"}' `
                -Stderr '' -ExitCode 1 -OutPath 'C:\tmp\o'
        }
        $r.Status | Should -Be 403
        $r.Error  | Should -Be 'forbidden'
    }

    It 'throws FetcherUnparseable AND deletes OutPath on non-JSON stdout' {
        $tmp = [System.IO.Path]::GetTempFileName()
        $result = InModuleScope AITriad -Parameters @{ tmp = $tmp } {
            param($tmp)
            try {
                ConvertFrom-FetchCliOutput -Stdout 'not json at all' -Stderr 'boom' -ExitCode 1 -OutPath $tmp | Out-Null
                return @{ matched = $false }
            }
            catch { return @{ matched = ($_.Exception.Message -match 'FetcherUnparseable') } }
        }
        $result.matched | Should -BeTrue
        Test-Path -LiteralPath $tmp | Should -BeFalse -Because 'the temp out-file is cleaned up on an unparseable result'
    }
}

Describe 'Get-UrlViaSharedFetcher — pre-flight guards' -Tag 'ingestion' {

    It 'throws NodeMissing when node is not on PATH' {
        $matched = InModuleScope AITriad {
            Mock Get-Command -ParameterFilter { $Name -eq 'node' } -MockWith { $null }
            try { Get-UrlViaSharedFetcher -Url 'https://example.com' | Out-Null; return $false }
            catch { return ($_.Exception.Message -match 'NodeMissing') }
        }
        $matched | Should -BeTrue
    }
}
