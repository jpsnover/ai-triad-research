# Tag: e2e (t/2874)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Export-TriadDebateBrief real cmdlet→CLI E2E — asserts OUTPUT, not just exit 0 (t/2874).
.DESCRIPTION
    The t/2868 false-green (CLI exited 0 with no stdout, parsed to an empty export) and
    the -SkipNarration/--model omission (CLI exit 2) both passed the mocked suite. This
    runs the ACTUAL lib/brief CLI via tsx against a committed fixture debate and asserts a
    populated TriadDeckExport + a real brief.pptx on disk.

    Skips cleanly when node deps are absent (e.g. a PS-only CI job with no npm ci) so it is
    never a flaky blocking gate — it runs wherever lib/brief's runtime deps are installed.
#>

BeforeAll {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
    Import-Module (Join-Path $script:RepoRoot 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

    # exp-1438 debates are phase='debate' (not closed) → use -AllowOpenDebate (snapshot).
    $script:Fixture = Join-Path $script:RepoRoot 'lib' 'debate' 'exp-1438-results' 'exp-1438-01-C-opensource-debate.json'
    $script:HasDeps = (Test-Path (Join-Path $script:RepoRoot 'node_modules')) -and
                      [bool](Get-Command npx -ErrorAction SilentlyContinue) -and
                      (Test-Path $script:Fixture)
}

Describe 'Export-TriadDebateBrief E2E (real tsx CLI)' -Tag 'e2e' {

    It 'produces a populated TriadDeckExport + brief.pptx (asserts OUTPUT, not exit 0)' {
        if (-not $script:HasDeps) {
            Set-ItResult -Skipped -Because 'node_modules / npx / fixture not present (install deps to run this E2E)'
            return
        }
        $out = Join-Path ([System.IO.Path]::GetTempPath()) "brief-e2e-$(New-Guid)"
        try {
            $r = Export-TriadDebateBrief -Path $script:Fixture -SkipNarration -AllowOpenDebate `
                -Preset conference -OutputDirectory $out -PassThru -WarningAction SilentlyContinue
            $r | Should -BeOfType ([TriadDeckExport])
            $r.Path | Should -Match 'brief\.pptx$'
            Test-Path -LiteralPath $r.Path | Should -BeTrue -Because 'the pptx artifact must actually exist'
            $r.DebateId | Should -Not -BeNullOrEmpty
            $r.ManifestPath | Should -Match 'audit-manifest\.json$'
        }
        finally {
            Remove-Item -LiteralPath $out -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
