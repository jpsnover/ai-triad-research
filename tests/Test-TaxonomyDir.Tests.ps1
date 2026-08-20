# Tag: taxonomy (t/2876)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Test-TaxonomyDir — the pre-embedding taxonomy directory validator.
.DESCRIPTION
    Covers the motivating incident (t/2875): a stray entity_extraction_log.json
    whose 'nodes' entries are keyed 'node_id' instead of 'id' crashed the embed
    run with KeyError: 'id'. Test-TaxonomyDir must flag exactly that file as a
    problem, while passing a clean POV directory and correctly classifying the
    loader's skip rules (SKIP_FILES + 'embeddings-*').
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    function New-TaxTempDir {
        $Dir = Join-Path ([System.IO.Path]::GetTempPath()) "taxdir-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
        New-Item -ItemType Directory -Path $Dir -Force | Out-Null
        return $Dir
    }
}

Describe 'Test-TaxonomyDir' -Tag 'taxonomy' {

    It 'Is exported and callable after Import-Module' {
        Get-Command Test-TaxonomyDir -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
    }

    It 'Reports Ok for a directory of valid POV files' {
        $Dir = New-TaxTempDir
        try {
            Set-Content -Path (Join-Path $Dir 'accelerationist.json') -Value '{"nodes":[{"id":"acc-beliefs-001"}]}'
            Set-Content -Path (Join-Path $Dir 'safetyist.json')       -Value '{"nodes":[{"id":"saf-desires-001"}]}'

            $result = Test-TaxonomyDir -Path $Dir -PassThru 6>$null
            $result.Ok          | Should -BeTrue
            $result.Problems    | Should -Be 0
            $result.IngestCount | Should -Be 2
        }
        finally { Remove-Item -Path $Dir -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'Flags entity_extraction_log.json (nodes keyed node_id, not id) as a problem — t/2875' {
        $Dir = New-TaxTempDir
        try {
            Set-Content -Path (Join-Path $Dir 'accelerationist.json') -Value '{"nodes":[{"id":"acc-beliefs-001"}]}'
            # The exact incident shape: a top-level nodes[] whose entries are keyed
            # 'node_id'. Not in SKIP_FILES, not 'embeddings-*' → the loader ingests
            # it and crashes on node["id"].
            Set-Content -Path (Join-Path $Dir 'entity_extraction_log.json') `
                -Value '{"node_count":1,"nodes":[{"node_id":"acc-beliefs-003","model":"claude-sonnet-4-6"}]}'

            $result = Test-TaxonomyDir -Path $Dir -PassThru 6>$null
            $result.Ok       | Should -BeFalse
            $result.Problems | Should -Be 1

            $bad = @($result.Details | Where-Object { $_.File -eq 'entity_extraction_log.json' })
            $bad.Count       | Should -Be 1
            $bad[0].Severity | Should -Be 'Error'
            $bad[0].Reason   | Should -Match "lack an 'id'"
            # The alt-key hint should name the offending key so a human can act on it.
            $bad[0].Reason   | Should -Match 'node_id'
        }
        finally { Remove-Item -Path $Dir -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'Classifies SKIP_FILES and embeddings-* index artifacts as Skip (not ingested)' {
        $Dir = New-TaxTempDir
        try {
            Set-Content -Path (Join-Path $Dir 'accelerationist.json')      -Value '{"nodes":[{"id":"acc-beliefs-001"}]}'
            Set-Content -Path (Join-Path $Dir 'embeddings.json')           -Value '{"nodes":{}}'
            Set-Content -Path (Join-Path $Dir 'policy_actions.json')       -Value '{"policies":[]}'
            # embeddings-* index artifact: 'nodes' is a dict keyed by ID. Must be
            # skipped by the prefix rule, never validated as POV data.
            Set-Content -Path (Join-Path $Dir 'embeddings-orgstance-6733.json') -Value '{"nodes":{"acc-1":[0.1,0.2]}}'

            $result = Test-TaxonomyDir -Path $Dir -PassThru 6>$null
            $result.Ok        | Should -BeTrue
            $result.SkipCount | Should -Be 3

            $skipped = @($result.Details | Where-Object { $_.Action -eq 'Skip' } | ForEach-Object { $_.File })
            $skipped | Should -Contain 'embeddings.json'
            $skipped | Should -Contain 'policy_actions.json'
            $skipped | Should -Contain 'embeddings-orgstance-6733.json'
        }
        finally { Remove-Item -Path $Dir -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'Flags invalid JSON in an ingested file as a problem' {
        $Dir = New-TaxTempDir
        try {
            Set-Content -Path (Join-Path $Dir 'skeptic.json') -Value '{"nodes":[{"id":"skp-1"} ] '  # truncated / invalid

            $result = Test-TaxonomyDir -Path $Dir -PassThru 6>$null
            $result.Ok       | Should -BeFalse
            $result.Problems | Should -Be 1
            @($result.Details | Where-Object { $_.Reason -match 'invalid JSON' }).Count | Should -Be 1
        }
        finally { Remove-Item -Path $Dir -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'Throws an ActionableError when the directory does not exist' {
        $Missing = Join-Path ([System.IO.Path]::GetTempPath()) "taxdir-nope-$([guid]::NewGuid().ToString('N').Substring(0,8))"
        { Test-TaxonomyDir -Path $Missing 6>$null } | Should -Throw
    }
}
