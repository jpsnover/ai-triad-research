# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# t/4129: staging must deploy the commit Container Image BUILT, read from the run name, never
# the workflow_run head_sha (the dispatch ref tip).

BeforeAll {
    $script:Script = Join-Path $PSScriptRoot '..' 'operations' 'devops' 'Get-BuiltShaFromRunName.ps1'
    . $script:Script
}

Describe 'Get-BuiltShaFromRunName (t/4129)' {
    It 'extracts the full built SHA from the run name' {
        Get-BuiltShaFromRunName 'Container Image (sha-eeb267d00d0f87fec1870cf99b8af26c3c57cf3c)' |
            Should -Be 'eeb267d00d0f87fec1870cf99b8af26c3c57cf3c'
    }

    It 'accepts a short SHA, matching the short tag the build would push for a short input' {
        Get-BuiltShaFromRunName 'Container Image (sha-eeb267d)' | Should -Be 'eeb267d'
    }

    It 'normalises case' {
        Get-BuiltShaFromRunName 'Container Image (sha-EEB267D00D)' | Should -Be 'eeb267d00d'
    }

    It 'returns nothing for a pre-change run name with no marker (fail-closed, no head_sha fallback)' {
        Get-BuiltShaFromRunName 'Container Image' | Should -BeNullOrEmpty
    }

    It 'returns nothing for empty, too-short or non-hex markers' {
        Get-BuiltShaFromRunName '' | Should -BeNullOrEmpty
        Get-BuiltShaFromRunName 'Container Image (sha-abc12)' | Should -BeNullOrEmpty
        Get-BuiltShaFromRunName 'Container Image (sha-zzzzzzz)' | Should -BeNullOrEmpty
    }

    It 'invoked without a marker, throws an actionable error that refuses the head_sha fallback' {
        { & $script:Script -RunName 'Container Image' } | Should -Throw '*Refusing to fall back to workflow_run.head_sha*'
    }

    It 'invoked with a marker, writes sha=<commit> to GITHUB_OUTPUT' {
        $out = Join-Path ([IO.Path]::GetTempPath()) "gho-$([guid]::NewGuid().ToString('N'))"
        $prev = $env:GITHUB_OUTPUT
        try {
            $env:GITHUB_OUTPUT = $out
            & $script:Script -RunName 'Container Image (sha-eeb267d00d0f87fec1870cf99b8af26c3c57cf3c)' -GitHubOutput 6>$null
            Get-Content -LiteralPath $out | Should -Be 'sha=eeb267d00d0f87fec1870cf99b8af26c3c57cf3c'
        } finally {
            $env:GITHUB_OUTPUT = $prev
            Remove-Item -LiteralPath $out -ErrorAction SilentlyContinue
        }
    }
}
