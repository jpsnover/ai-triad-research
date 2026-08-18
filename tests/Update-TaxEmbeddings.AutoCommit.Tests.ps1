# Tag: enrichment (t/2753)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Update-TaxEmbeddings -AutoCommit prevents shared-data-checkout drift (t/2753).
.DESCRIPTION
    After a successful regen, -AutoCommit (default $true) git-adds + commits
    embeddings.json to the DATA repo with machine attribution, so a run never leaves
    unattributed churn in the shared data tree (t/2750 incident). Uses a real fake
    embed_taxonomy.py (exit 0) like the t/1653 test, and mocks git / Get-DataRoot /
    Get-TaxonomyDir to assert the commit logic without touching a real data repo.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Update-TaxEmbeddings -AutoCommit (t/2753)' -Tag 'enrichment' {

    BeforeEach {
        $py = if (Get-Command python -ErrorAction SilentlyContinue) { 'python' }
              elseif (Get-Command python3 -ErrorAction SilentlyContinue) { 'python3' } else { $null }
        $script:HavePython = [bool]$py

        $script:TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("aitriad-t2753-" + [System.Guid]::NewGuid().ToString('N'))
        $script:CodeScripts = Join-Path $script:TempRoot 'code\scripts'
        $script:TaxDir      = Join-Path $script:TempRoot 'data\taxonomy\Origin'
        New-Item -ItemType Directory -Path $script:CodeScripts -Force | Out-Null
        New-Item -ItemType Directory -Path $script:TaxDir -Force | Out-Null
        # Success no-op embed script + a real embeddings.json for the Test-Path guard.
        Set-Content -Path (Join-Path $script:CodeScripts 'embed_taxonomy.py') -Value 'import sys; sys.exit(0)' -Encoding utf8
        Set-Content -Path (Join-Path $script:TaxDir 'embeddings.json') -Value '{"nodes":{}}' -Encoding utf8
    }

    AfterEach {
        Remove-Item -Path $script:TempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'commits embeddings.json to the data repo when it changed (default AutoCommit)' {
        if (-not $script:HavePython) { Set-ItResult -Skipped -Because 'python missing on PATH — AutoCommit guard NOT RUN'; return }
        InModuleScope AITriad -Parameters @{ Code = (Join-Path $script:TempRoot 'code'); Tax = $script:TaxDir; Data = (Join-Path $script:TempRoot 'data') } {
            param($Code, $Tax, $Data)
            $orig = $script:RepoRoot; $script:RepoRoot = $Code
            try {
                Mock Get-DataRoot    { $Data }
                Mock Get-TaxonomyDir { $Tax }
                # git: repo present, file changed, add/commit succeed.
                Mock git -MockWith {
                    $global:LASTEXITCODE = 0
                    if ($args -contains 'rev-parse') { return 'true' }
                    if ($args -contains 'status')   { return ' M taxonomy/Origin/embeddings.json' }
                    return $null
                }
                Update-TaxEmbeddings *> $null
                Should -Invoke git -ParameterFilter { $args -contains 'commit' } -Times 1
            } finally { $script:RepoRoot = $orig }
        }
    }

    It 'does NOT commit when embeddings.json is unchanged (no-change guard)' {
        if (-not $script:HavePython) { Set-ItResult -Skipped -Because 'python missing'; return }
        InModuleScope AITriad -Parameters @{ Code = (Join-Path $script:TempRoot 'code'); Tax = $script:TaxDir; Data = (Join-Path $script:TempRoot 'data') } {
            param($Code, $Tax, $Data)
            $orig = $script:RepoRoot; $script:RepoRoot = $Code
            try {
                Mock Get-DataRoot    { $Data }
                Mock Get-TaxonomyDir { $Tax }
                Mock git -MockWith {
                    $global:LASTEXITCODE = 0
                    if ($args -contains 'rev-parse') { return 'true' }
                    if ($args -contains 'status')   { return '' }   # clean → no change
                    return $null
                }
                Update-TaxEmbeddings *> $null
                Should -Invoke git -ParameterFilter { $args -contains 'commit' } -Times 0 -Because 'a no-op regen must not create an empty commit'
            } finally { $script:RepoRoot = $orig }
        }
    }

    It '-AutoCommit:$false performs no git operations (pipeline owns the commit)' {
        if (-not $script:HavePython) { Set-ItResult -Skipped -Because 'python missing'; return }
        InModuleScope AITriad -Parameters @{ Code = (Join-Path $script:TempRoot 'code'); Tax = $script:TaxDir; Data = (Join-Path $script:TempRoot 'data') } {
            param($Code, $Tax, $Data)
            $orig = $script:RepoRoot; $script:RepoRoot = $Code
            try {
                Mock Get-DataRoot    { $Data }
                Mock Get-TaxonomyDir { $Tax }
                Mock git -MockWith { $global:LASTEXITCODE = 0; return 'true' }
                Update-TaxEmbeddings -AutoCommit:$false *> $null
                Should -Invoke git -Times 0 -Because 'AutoCommit:$false leaves all git work to the caller'
            } finally { $script:RepoRoot = $orig }
        }
    }

    It 'warns and does not throw when the data root is not a git work tree' {
        if (-not $script:HavePython) { Set-ItResult -Skipped -Because 'python missing'; return }
        InModuleScope AITriad -Parameters @{ Code = (Join-Path $script:TempRoot 'code'); Tax = $script:TaxDir; Data = (Join-Path $script:TempRoot 'data') } {
            param($Code, $Tax, $Data)
            $orig = $script:RepoRoot; $script:RepoRoot = $Code
            try {
                Mock Get-DataRoot    { $Data }
                Mock Get-TaxonomyDir { $Tax }
                Mock git -MockWith { $global:LASTEXITCODE = 128; return $null }   # rev-parse fails → not a work tree
                { Update-TaxEmbeddings *> $null } | Should -Not -Throw
                Should -Invoke git -ParameterFilter { $args -contains 'commit' } -Times 0
            } finally { $script:RepoRoot = $orig }
        }
    }
}
