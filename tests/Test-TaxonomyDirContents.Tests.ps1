# Tag: taxonomy (t/1654)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Covers Test-TaxonomyDirContents pre-embedding validation cmdlet (t/1654).
.DESCRIPTION
    Builds a temp taxonomy directory with crafted JSON files and verifies the
    cmdlet classifies each the way embed_taxonomy.py would load it: a list of
    node objects is Safe, a dict `nodes` is Unsafe (iterating yields keys), and
    SKIP_FILES / embeddings- prefixed files are Skipped (and therefore Safe
    regardless of shape). Also covers the missing-directory error path.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    $script:TaxDir = Join-Path ([System.IO.Path]::GetTempPath()) "taxdircontents-t1654-$(Get-Random)"
    New-Item -ItemType Directory -Path $script:TaxDir -Force | Out-Null

    # A well-formed taxonomy file: nodes is a list of objects → Safe.
    @{ nodes = @(
            @{ id = 'acc-belief-001'; label = 'a' }
            @{ id = 'acc-belief-002'; label = 'b' }
        ) } | ConvertTo-Json -Depth 5 |
        Set-Content -Path (Join-Path $script:TaxDir 'accelerationist.json') -Encoding utf8NoBOM

    # A dict-shaped nodes field (embedding-index style) NOT caught by the prefix
    # skip — this is exactly the t/1652 crash shape → Unsafe.
    @{ nodes = @{ 'k1' = @(0.1, 0.2); 'k2' = @(0.3, 0.4) } } | ConvertTo-Json -Depth 5 |
        Set-Content -Path (Join-Path $script:TaxDir 'stray-index.json') -Encoding utf8NoBOM

    # A file matching the embeddings- prefix → Skipped, Safe (shape ignored).
    @{ nodes = @{ 'k1' = @(0.1) } } | ConvertTo-Json -Depth 5 |
        Set-Content -Path (Join-Path $script:TaxDir 'embeddings-orgstance-6733.json') -Encoding utf8NoBOM

    # A SKIP_FILES member → Skipped, Safe.
    @{ nodes = @{ 'k1' = @(0.1) } } | ConvertTo-Json -Depth 5 |
        Set-Content -Path (Join-Path $script:TaxDir 'edges.json') -Encoding utf8NoBOM

    $script:Results = Test-TaxonomyDirContents -TaxonomyDir $script:TaxDir -Detailed 3>$null
}

AfterAll {
    if ($script:TaxDir -and (Test-Path $script:TaxDir)) {
        Remove-Item -Recurse -Force -Path $script:TaxDir -ErrorAction SilentlyContinue
    }
}

Describe 'Test-TaxonomyDirContents (t/1654)' -Tag 'taxonomy' {

    It 'Emits one record per JSON file' {
        @($script:Results).Count | Should -Be 4
    }

    It 'Flags a list-of-objects nodes file as Safe and not Skipped' {
        $r = $script:Results | Where-Object { $_.File -eq 'accelerationist.json' }
        $r         | Should -Not -BeNullOrEmpty
        $r.Safe    | Should -Be $true
        $r.Skipped | Should -Be $false
        $r.NodeCount | Should -Be 2
    }

    It 'Flags a dict-shaped nodes file as Unsafe (the t/1652 crash shape)' {
        $r = $script:Results | Where-Object { $_.File -eq 'stray-index.json' }
        $r         | Should -Not -BeNullOrEmpty
        $r.Safe    | Should -Be $false
        $r.Skipped | Should -Be $false
        $r.NodesType | Should -Be 'dict'
    }

    It 'Skips an embeddings- prefixed file and reports it Safe' {
        $r = $script:Results | Where-Object { $_.File -eq 'embeddings-orgstance-6733.json' }
        $r         | Should -Not -BeNullOrEmpty
        $r.Skipped | Should -Be $true
        $r.Safe    | Should -Be $true
    }

    It 'Skips a SKIP_FILES member and reports it Safe' {
        $r = $script:Results | Where-Object { $_.File -eq 'edges.json' }
        $r         | Should -Not -BeNullOrEmpty
        $r.Skipped | Should -Be $true
        $r.Safe    | Should -Be $true
    }

    It 'Omits Detailed-only columns when -Detailed is not passed' {
        $compact = Test-TaxonomyDirContents -TaxonomyDir $script:TaxDir 3>$null
        $first = @($compact)[0]
        $names = $first.PSObject.Properties.Name
        $names | Should -Contain 'File'
        $names | Should -Contain 'Safe'
        $names | Should -Not -Contain 'Reason'
        $names | Should -Not -Contain 'NodeCount'
    }

    It 'Throws an ActionableError when the taxonomy directory does not exist' {
        $missing = Join-Path ([System.IO.Path]::GetTempPath()) "taxdircontents-missing-$(Get-Random)"
        { Test-TaxonomyDirContents -TaxonomyDir $missing } | Should -Throw
    }
}
