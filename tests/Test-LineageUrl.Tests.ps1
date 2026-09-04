# Tag: lineage (t/3313)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Test-LineageUrl — the POV citation-liveness check migrated to the shared Node fetch-CLI
    (t/3313). Proves the WAF-fingerprint fix: a live WAF-protected citation (Node fetches 200) is no
    longer falsely marked dead, and the fetch no longer uses Invoke-WebRequest. Private function,
    exercised via InModuleScope with Get-UrlViaSharedFetcher mocked (no node spawn, no network).
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue
}

Describe 'Test-LineageUrl — shared-fetcher migration (t/3313)' -Tag 'lineage' {

    It 'treats a WAF-protected citation that Node fetches (200) as LIVE — the fix' {
        InModuleScope AITriad {
            Mock Get-UrlViaSharedFetcher { [PSCustomObject]@{ Status = 200; BodySnippet = 'The Federalist Papers, No. 10.'; OutPath = $null } }
            Mock Invoke-WebRequest { throw 'the migration must not call Invoke-WebRequest' }
            Test-LineageUrl -Url 'https://www.sanders.senate.gov/live-citation' | Should -BeTrue
            Should -Invoke Get-UrlViaSharedFetcher -Times 1 -Exactly
            Should -Not -Invoke Invoke-WebRequest
        }
    }

    It 'treats a non-200 status as DEAD' {
        InModuleScope AITriad {
            Mock Get-UrlViaSharedFetcher { [PSCustomObject]@{ Status = 404; BodySnippet = ''; OutPath = $null } }
            Test-LineageUrl -Url 'https://example.com/gone' | Should -BeFalse
        }
    }

    It 'treats a 200 soft-404 body ("page not found") as DEAD' {
        InModuleScope AITriad {
            Mock Get-UrlViaSharedFetcher { [PSCustomObject]@{ Status = 200; BodySnippet = 'Sorry — this page not found on our server.'; OutPath = $null } }
            Test-LineageUrl -Url 'https://example.com/soft404' | Should -BeFalse
        }
    }

    It 'returns $false (not-verifiable) when the fetcher throws (e.g. NodeMissing) without leaking the error' {
        InModuleScope AITriad {
            Mock Get-UrlViaSharedFetcher { throw 'NodeMissing: node was not found on PATH' }
            (Test-LineageUrl -Url 'https://example.com/x' 4>$null) | Should -BeFalse
        }
    }

    It 'deletes the fetcher-owned OutPath temp file after a liveness check' {
        $tmp = [System.IO.Path]::GetTempFileName()
        InModuleScope AITriad -Parameters @{ tmp = $tmp } {
            param($tmp)
            Mock Get-UrlViaSharedFetcher { [PSCustomObject]@{ Status = 200; BodySnippet = 'ok'; OutPath = $tmp } }
            Test-LineageUrl -Url 'https://example.com/live' | Out-Null
        }
        Test-Path -LiteralPath $tmp | Should -BeFalse -Because 'Test-LineageUrl only needs status+snippet, so it cleans up the temp bytes'
    }

    It 'rejects an empty or non-http(s) URL without invoking the fetcher' {
        InModuleScope AITriad {
            Mock Get-UrlViaSharedFetcher { throw 'must not fetch a malformed URL' }
            Test-LineageUrl -Url ''             | Should -BeFalse
            Test-LineageUrl -Url 'ftp://x/y'    | Should -BeFalse
            Test-LineageUrl -Url 'not-a-url'    | Should -BeFalse
            Should -Not -Invoke Get-UrlViaSharedFetcher
        }
    }
}
