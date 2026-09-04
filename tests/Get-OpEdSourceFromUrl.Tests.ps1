# Tag: oped (t/3320 — shared-fetcher migration)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Get-OpEdSourceFromUrl after its migration to the shared Node fetcher (t/3320).
.DESCRIPTION
    Private helper — exercised via InModuleScope with Get-UrlViaSharedFetcher + Get-OpEdSource mocked
    (no node, no network). Verifies it delegates convert to Get-OpEdSource with the fetcher's OutPath +
    Content-Type on success, and throws a FetchFailed ActionableError on a non-200 status.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue
}

Describe 'Get-OpEdSourceFromUrl — shared-fetcher migration' -Tag 'oped' {

    It 'delegates to Get-OpEdSource with the fetcher OutPath + ContentType on status 200' {
        $captured = InModuleScope AITriad {
            $tmp = [System.IO.Path]::GetTempFileName()
            Mock Get-UrlViaSharedFetcher {
                [PSCustomObject]@{ Status = 200; ContentType = 'application/pdf'; FinalUrl = 'https://x/y.pdf'
                    Error = $null; BodySnippet = ''; OutPath = $tmp; ExitCode = 0 }
            }
            $script:seen = $null
            Mock Get-OpEdSource {
                $script:seen = @{ ContentPath = $ContentPath; ContentType = $ContentType; SourceUrl = $SourceUrl }
                [pscustomobject]@{ SourceMarkdown = 'ok' }
            }
            Get-OpEdSourceFromUrl -Url 'https://x/y.pdf' | Out-Null
            $script:seen
        }
        $captured.ContentType | Should -Be 'application/pdf'
        $captured.SourceUrl   | Should -Be 'https://x/y.pdf'
        $captured.ContentPath | Should -Not -BeNullOrEmpty
    }

    It 'throws FetchFailed on a non-200 status (and does not call the converter)' {
        $matched = InModuleScope AITriad {
            Mock Get-UrlViaSharedFetcher {
                [PSCustomObject]@{ Status = 403; ContentType = ''; FinalUrl = ''; Error = 'forbidden'
                    BodySnippet = 'blocked'; OutPath = [System.IO.Path]::GetTempFileName(); ExitCode = 1 }
            }
            Mock Get-OpEdSource { throw 'Get-OpEdSource must not be called on a fetch failure' }
            try { Get-OpEdSourceFromUrl -Url 'https://x' | Out-Null; return $false }
            catch { return ($_.Exception.Message -match 'FetchFailed') }
        }
        $matched | Should -BeTrue
    }
}
