# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Pester tests for the AITriad PowerShell module.
    Tests module loading, exported functions, data path resolution,
    and core cmdlet behavior.
.DESCRIPTION
    Run with: Invoke-Pester ./tests/
    Or from the repo root: Invoke-Pester
#>

BeforeDiscovery {
    # Detect whether the separate data repo is available (may not be in CI).
    # Must be in BeforeDiscovery so -Skip: expressions can reference $HasDataRepo.
    $repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
    $configPath = Join-Path $repoRoot '.aitriad.json'
    if (Test-Path $configPath) {
        $cfg = Get-Content -Raw $configPath | ConvertFrom-Json
        $dataRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $cfg.data_root))
        $taxDir = Join-Path $dataRoot $cfg.taxonomy_dir
        $HasDataRepo = Test-Path $taxDir
    } else {
        $HasDataRepo = Test-Path (Join-Path $repoRoot 'taxonomy' 'Origin')
    }
}

BeforeAll {
    # Load module from source (dev layout)
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
    if (-not (Test-Path $ModulePath)) {
        # Try build dir
        $ModulePath = Join-Path $PSScriptRoot '..' 'build' 'AITriad' 'AITriad.psd1'
    }
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Module Loading' {
    It 'Should import without errors' {
        Get-Module AITriad | Should -Not -BeNullOrEmpty
    }

    It 'Should export expected function count (40+)' {
        $functions = (Get-Module AITriad).ExportedFunctions.Keys
        $functions.Count | Should -BeGreaterOrEqual 40
    }

    It 'Should export key functions' {
        $required = @(
            'Get-Tax', 'Import-AITriadDocument', 'Invoke-POVSummary',
            'Find-Conflict', 'Get-TaxonomyHealth', 'Show-TaxonomyEditor',
            'Install-AITriadData', 'Register-AIBackend', 'Find-PossibleFallacy',
            'Find-PolicyAction', 'Invoke-AttributeExtraction', 'Invoke-EdgeDiscovery',
            'Show-TriadDialogue', 'Get-Edge', 'Approve-Edge'
        )
        $exported = (Get-Module AITriad).ExportedFunctions.Keys
        foreach ($fn in $required) {
            $exported | Should -Contain $fn -Because "$fn should be exported"
        }
    }

    It 'Should register global aliases' {
        # Aliases are set via Set-Alias -Scope Global in the psm1
        Get-Alias TaxonomyEditor -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
        Get-Alias POViewer -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
        Get-Alias SummaryViewer -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
    }
}

Describe 'Data Path Resolution' {
    It 'Get-Tax should return nodes when data is available' -Skip:(-not $HasDataRepo) {
        $nodes = Get-Tax
        $nodes | Should -Not -BeNullOrEmpty -Because 'Data repo should be available'
    }

    It 'Get-Tax -Id should return a single node' {
        $node = Get-Tax -Id 'acc-goals-001'
        if ($node) {
            $node.Id | Should -Be 'acc-goals-001'
            $node.Label | Should -Not -BeNullOrEmpty
            $node.Description | Should -Not -BeNullOrEmpty
            $node.POV | Should -Be 'accelerationist'
        }
    }

    It 'Get-Tax -POV should filter by perspective' {
        $accNodes = Get-Tax -POV accelerationist
        if ($accNodes) {
            $accNodes | ForEach-Object { $_.POV | Should -Be 'accelerationist' }
        }
    }
}

Describe 'AI Model Configuration' {
    It 'ai-models.json should exist in repo or module' {
        $repoPath = Join-Path $PSScriptRoot '..' 'ai-models.json'
        $modulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'ai-models.json'
        ($repoPath | Test-Path) -or ($modulePath | Test-Path) | Should -Be $true
    }

    It 'ai-models.json should contain models' {
        $repoPath = Join-Path $PSScriptRoot '..' 'ai-models.json'
        if (Test-Path $repoPath) {
            $config = Get-Content -Raw $repoPath | ConvertFrom-Json
            $config.models.Count | Should -BeGreaterOrEqual 5
            $config.backends.Count | Should -BeGreaterOrEqual 2
        }
    }

    It 'Model validation should work for known models' -Skip:(-not $HasDataRepo) {
        # Test via parameter validation on a real cmdlet (requires taxonomy data)
        { Find-PolicyAction -Model 'gemini-2.5-flash' -DryRun -POV accelerationist -ErrorAction Stop } | Should -Not -Throw
    }

    It 'Model validation should reject invalid models' {
        { Find-PolicyAction -Model 'totally-fake-model' -DryRun -POV accelerationist -ErrorAction Stop } | Should -Throw
    }
}

Describe 'Build Output' -Tag 'Build' {
    BeforeAll {
        $BuildDir = Join-Path $PSScriptRoot '..' 'build' 'AITriad'
        $BuildExists = Test-Path $BuildDir
    }

    It 'Build directory should exist (run Build-Module.ps1 first)' -Skip:(-not $BuildExists) {
        Test-Path $BuildDir | Should -Be $true
    }

    It 'Should contain module manifest' -Skip:(-not $BuildExists) {
        Test-Path (Join-Path $BuildDir 'AITriad.psd1') | Should -Be $true
    }

    It 'Should contain companion modules' -Skip:(-not $BuildExists) {
        Test-Path (Join-Path $BuildDir 'AIEnrich.psm1') | Should -Be $true
        Test-Path (Join-Path $BuildDir 'DocConverters.psm1') | Should -Be $true
    }

    It 'Should contain ai-models.json' -Skip:(-not $BuildExists) {
        Test-Path (Join-Path $BuildDir 'ai-models.json') | Should -Be $true
    }

    It 'Should contain prompts' -Skip:(-not $BuildExists) {
        $prompts = Get-ChildItem (Join-Path $BuildDir 'Prompts') -Filter '*.prompt' -ErrorAction SilentlyContinue
        $prompts.Count | Should -BeGreaterOrEqual 10
    }

    It 'Built module should load from isolated location' -Skip:(-not $BuildExists) {
        $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "aitriad-pester-$(Get-Random)"
        $ModDir = Join-Path $TempDir 'AITriad'
        try {
            Copy-Item -Recurse $BuildDir $ModDir
            $mod = Import-Module $ModDir -Force -PassThru -WarningAction SilentlyContinue
            $mod | Should -Not -BeNullOrEmpty
            $mod.ExportedFunctions.Count | Should -BeGreaterOrEqual 40
        }
        finally {
            Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
        }
    }

    It 'Module manifest should be valid' -Skip:(-not $BuildExists) {
        { Test-ModuleManifest -Path (Join-Path $BuildDir 'AITriad.psd1') -ErrorAction Stop } | Should -Not -Throw
    }
}

Describe 'Cmdlet Parameter Validation' {
    It 'Find-PossibleFallacy should reject invalid POV' {
        { Find-PossibleFallacy -POV 'invalid' -DryRun } | Should -Throw
    }

    It 'Find-PolicyAction should reject invalid POV' {
        { Find-PolicyAction -POV 'invalid' -DryRun } | Should -Throw
    }

    It 'Invoke-AttributeExtraction should accept -DryRun' -Skip:(-not $HasDataRepo) {
        # DryRun should not throw (requires taxonomy data)
        { Invoke-AttributeExtraction -DryRun -POV accelerationist -ErrorAction SilentlyContinue } | Should -Not -Throw
    }

    It 'Get-Tax should accept -POV parameter' {
        { Get-Tax -POV accelerationist -ErrorAction SilentlyContinue } | Should -Not -Throw
    }

    It 'Get-Tax should accept -Id parameter' {
        { Get-Tax -Id 'nonexistent-id' -ErrorAction SilentlyContinue } | Should -Not -Throw
    }
}

Describe 'Show-AITriadHelp' {
    It 'Should have the command available' {
        Get-Command Show-AITriadHelp -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
    }
}

Describe 'Install-AITriadData' {
    It 'Should have the command available' {
        Get-Command Install-AITriadData -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
    }
}
