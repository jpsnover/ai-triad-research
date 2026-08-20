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

    OPT-IN: this drives the real JS pipeline (tsx + render), which the default
    test-powershell CI job cannot run (node_modules present but tsx/pipeline not
    reliably runnable there — it failed fast in CI). To avoid a flaky BLOCKING gate,
    it self-skips unless AITRIAD_RUN_BRIEF_E2E is set. Run locally from a full checkout:
        $env:AITRIAD_RUN_BRIEF_E2E = '1'; Invoke-Pester ./tests/Export-TriadDebateBrief.E2E.Tests.ps1
#>

BeforeAll {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
    Import-Module (Join-Path $script:RepoRoot 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

    # exp-1438 debates are phase='debate' (not closed) → use -AllowOpenDebate (snapshot).
    $script:Fixture = Join-Path $script:RepoRoot 'lib' 'debate' 'exp-1438-results' 'exp-1438-01-C-opensource-debate.json'
    # Opt-in only (see file header): the default CI job cannot run the JS pipeline.
    $script:OptedIn = -not [string]::IsNullOrWhiteSpace($env:AITRIAD_RUN_BRIEF_E2E)
    $script:HasDeps = $script:OptedIn -and
                      (Test-Path (Join-Path $script:RepoRoot 'node_modules')) -and
                      [bool](Get-Command npx -ErrorAction SilentlyContinue) -and
                      (Test-Path $script:Fixture)
}

Describe 'Export-TriadDebateBrief E2E (real tsx CLI)' -Tag 'e2e' {

    It 'produces a populated TriadDeckExport + brief.pptx (asserts OUTPUT, not exit 0)' {
        if (-not $script:HasDeps) {
            $why = if (-not $script:OptedIn) { 'opt-in only — set AITRIAD_RUN_BRIEF_E2E=1 to run' }
                   else { 'node_modules / npx / fixture not present' }
            Set-ItResult -Skipped -Because $why
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
