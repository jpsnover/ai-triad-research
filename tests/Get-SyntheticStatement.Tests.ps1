# Tag: synthetic (Get-SyntheticStatement)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

# Unit tests for Get-SyntheticStatement. Get-SyntheticStatement is a public cmdlet, so it is called
# directly and Get-TaxonomyDir is mocked with -ModuleName AITriad (no InModuleScope needed). A TestDrive
# corpus exercises pov-derivation, pruned filtering, -IncludePruned, pipeline binding, and the
# absent-corpus WARNING path.

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

    function New-TestCorpus {
        param([string]$Dir)
        $syn = Join-Path $Dir 'synthetic'
        New-Item -ItemType Directory -Path $syn -Force | Out-Null
        function New-Entry ($n, $s, $pruned) {
            [ordered]@{ node_id = $n; statement = $s; archetype = 'plain'; audience = 'general'
                model = 'gemini-2.5-flash'; generation_timestamp = '2026-09-12T00:00:00Z'
                prompt_hash = 'h1'; description_hash = 'd1'; rationale = $null
                pruned = $pruned; prune_reason = $(if ($pruned) { 'near-dup' } else { $null }) }
        }
        $acc = [ordered]@{
            pov = 'acc'; generated_at = '2026-09-12T00:00:00Z'; node_count = 2; entry_count = 4
            models = @('gemini-2.5-flash'); temperature = 1.0
            entries = @(
                (New-Entry 'acc-beliefs-003' 'Scaling is destiny.' $false)
                (New-Entry 'acc-beliefs-003' 'Compute compounds.'  $false)
                (New-Entry 'acc-beliefs-003' 'A near-duplicate.'    $true)
                (New-Entry 'acc-beliefs-004' 'Regulation lags.'     $false)
            )
        }
        $acc | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $syn 'corpus_acc.json') -Encoding utf8
    }
}

Describe 'Get-SyntheticStatement' -Tag 'synthetic' {

    It 'is exported from the module' {
        Get-Command -Module AITriad -Name 'Get-SyntheticStatement' | Should -Not -BeNullOrEmpty
    }

    It 'returns the non-pruned statements for a BDI element (pov derived from the id prefix)' {
        $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "getsynth-$(Get-Random)"
        New-TestCorpus -Dir $TempDir
        try {
            Mock Get-TaxonomyDir { $TempDir } -ModuleName AITriad
            $r = @(Get-SyntheticStatement -NodeId 'acc-beliefs-003')
            $r.Count | Should -Be 2                                        # pruned entry excluded by default
            @($r.statement) | Should -Contain 'Scaling is destiny.'
            @($r.statement) | Should -Contain 'Compute compounds.'
            @($r.statement) | Should -Not -Contain 'A near-duplicate.'
            @($r | Where-Object { $_.node_id -ne 'acc-beliefs-003' }).Count | Should -Be 0
        } finally { Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It '-IncludePruned also returns pruned entries' {
        $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "getsynth-$(Get-Random)"
        New-TestCorpus -Dir $TempDir
        try {
            Mock Get-TaxonomyDir { $TempDir } -ModuleName AITriad
            $r = @(Get-SyntheticStatement -NodeId 'acc-beliefs-003' -IncludePruned)
            $r.Count | Should -Be 3
            @($r.statement) | Should -Contain 'A near-duplicate.'
        } finally { Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'returns nothing for a node with no corpus entries' {
        $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "getsynth-$(Get-Random)"
        New-TestCorpus -Dir $TempDir
        try {
            Mock Get-TaxonomyDir { $TempDir } -ModuleName AITriad
            @(Get-SyntheticStatement -NodeId 'acc-beliefs-999').Count | Should -Be 0
        } finally { Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'warns and returns nothing when the POV corpus file is absent' {
        $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "getsynth-$(Get-Random)"
        New-Item -ItemType Directory -Path (Join-Path $TempDir 'synthetic') -Force | Out-Null   # dir exists, no corpus_saf.json
        try {
            Mock Get-TaxonomyDir { $TempDir } -ModuleName AITriad
            $warn = @()
            $r = @(Get-SyntheticStatement -NodeId 'saf-beliefs-001' -WarningVariable warn -WarningAction SilentlyContinue)
            $r.Count | Should -Be 0
            ($warn -join ' ') | Should -Match 'No synthetic corpus for POV'
        } finally { Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'accepts the node id from the pipeline and binds by the Id property' {
        $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "getsynth-$(Get-Random)"
        New-TestCorpus -Dir $TempDir
        try {
            Mock Get-TaxonomyDir { $TempDir } -ModuleName AITriad
            # bare-string pipeline
            ('acc-beliefs-004' | Get-SyntheticStatement).statement | Should -Be 'Regulation lags.'
            # by Id property (mirrors piping taxonomy nodes)
            $node = [pscustomobject]@{ Id = 'acc-beliefs-003' }
            @($node | Get-SyntheticStatement).Count | Should -Be 2
        } finally { Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue }
    }
}
