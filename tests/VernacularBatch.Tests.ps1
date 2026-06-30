# Tag: enrichment (t/1186)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Invoke-VernacularBatch' -Tag 'enrichment' {

    It 'Is exported from the module' {
        Get-Command Invoke-VernacularBatch -Module AITriad -ErrorAction Stop | Should -Not -BeNullOrEmpty
    }

    It 'Has Concurrency parameter with ValidateRange' {
        Import-Module $ModulePath -Force -WarningAction SilentlyContinue
        $cmd = Get-Command Invoke-VernacularBatch -Module AITriad
        $cmd.Parameters.ContainsKey('Concurrency') | Should -Be $true
        $validate = @($cmd.Parameters['Concurrency'].Attributes | Where-Object { $_ -is [System.Management.Automation.ValidateRangeAttribute] })
        @($validate).Count | Should -Be 1
    }

    It 'Has Force switch parameter' {
        $cmd = Get-Command Invoke-VernacularBatch -Module AITriad
        $cmd.Parameters.ContainsKey('Force') | Should -Be $true
        $cmd.Parameters['Force'].SwitchParameter | Should -Be $true
    }

    It 'Supports ShouldProcess (WhatIf/Confirm)' {
        $cmd = Get-Command Invoke-VernacularBatch -Module AITriad
        $cmd.Parameters.ContainsKey('WhatIf') | Should -Be $true
        $cmd.Parameters.ContainsKey('Confirm') | Should -Be $true
    }

    It 'Throws ActionableError when TaxonomyPath does not exist' {
        InModuleScope AITriad {
            { Invoke-VernacularBatch -TaxonomyPath '/nonexistent/path/xyz' } | Should -Throw
        }
    }
}

Describe 'Invoke-VernacularBatch Skip Logic' -Tag 'enrichment' {

    BeforeAll {
        $script:TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "vernacular-test-$(Get-Random)"
        New-Item -ItemType Directory -Path $script:TempDir -Force | Out-Null

        $script:TaxData = [PSCustomObject]@{
            _schema_version = '3.0'
            pov             = 'test'
            nodes           = @(
                [PSCustomObject]@{ id = 'test-001'; description = 'A sufficiently long description for testing that exceeds twenty characters' }
                [PSCustomObject]@{ id = 'test-002'; description = '' }
                [PSCustomObject]@{ id = 'test-003'; description = 'Short' }
                [PSCustomObject]@{ id = 'test-004'; description = '[DEPRECATED] This node has been deprecated and should be skipped entirely' }
                [PSCustomObject]@{ id = 'test-005'; description = 'Another valid description that is long enough for processing'; plain_description = 'Already generated'; plain_description_version = 'flash-lite:v1' }
                [PSCustomObject]@{ id = 'test-006'; description = 'Valid node with stale version tag that should be regenerated'; plain_description = 'Old text'; plain_description_version = 'old-version:v0' }
                [PSCustomObject]@{ id = 'test-007'; description = $null }
            )
        }

        $script:TaxData | ConvertTo-Json -Depth 10 |
            Set-Content -Path (Join-Path $script:TempDir 'accelerationist.json') -Encoding UTF8
    }

    AfterAll {
        if (Test-Path $script:TempDir) { Remove-Item $script:TempDir -Recurse -Force }
    }

    It 'Skips nodes with empty description' {
        InModuleScope AITriad -Parameters @{ Dir = $script:TempDir } {
            param($Dir)
            Mock Invoke-AIApi -MockWith {
                [PSCustomObject]@{ Text = 'Plain version of the description.' }
            }
            $result = Invoke-VernacularBatch -TaxonomyPath $Dir -Confirm:$false
            $result.Skipped | Should -BeGreaterOrEqual 1
        }
    }

    It 'Skips nodes with short description (< 20 chars)' {
        InModuleScope AITriad -Parameters @{ Dir = $script:TempDir } {
            param($Dir)
            Mock Invoke-AIApi -MockWith {
                [PSCustomObject]@{ Text = 'Plain version.' }
            }
            $result = Invoke-VernacularBatch -TaxonomyPath $Dir -Confirm:$false
            $result.Skipped | Should -BeGreaterOrEqual 2
        }
    }

    It 'Skips deprecated nodes' {
        InModuleScope AITriad -Parameters @{ Dir = $script:TempDir } {
            param($Dir)
            Mock Invoke-AIApi -MockWith {
                [PSCustomObject]@{ Text = 'Plain version.' }
            }
            $result = Invoke-VernacularBatch -TaxonomyPath $Dir -Confirm:$false
            $result.Skipped | Should -BeGreaterOrEqual 3
        }
    }

    It 'Skips nodes with up-to-date plain_description' {
        InModuleScope AITriad -Parameters @{ Dir = $script:TempDir } {
            param($Dir)
            Mock Invoke-AIApi -MockWith {
                [PSCustomObject]@{ Text = 'Plain version.' }
            }
            $result = Invoke-VernacularBatch -TaxonomyPath $Dir -Confirm:$false
            $result.Skipped | Should -BeGreaterOrEqual 4
        }
    }

    It 'Identifies stale-version nodes for processing (not skipped)' {
        InModuleScope AITriad -Parameters @{ Dir = $script:TempDir } {
            param($Dir)
            # Re-create test data (prior tests may have modified the file)
            $TaxData = [PSCustomObject]@{
                _schema_version = '3.0'; pov = 'test'
                nodes = @(
                    [PSCustomObject]@{ id = 'test-001'; description = 'A sufficiently long description for testing that exceeds twenty characters' }
                    [PSCustomObject]@{ id = 'test-002'; description = '' }
                    [PSCustomObject]@{ id = 'test-003'; description = 'Short' }
                    [PSCustomObject]@{ id = 'test-004'; description = '[DEPRECATED] This node has been deprecated and should be skipped entirely' }
                    [PSCustomObject]@{ id = 'test-005'; description = 'Another valid description that is long enough for processing'; plain_description = 'Already generated'; plain_description_version = 'flash-lite:v1' }
                    [PSCustomObject]@{ id = 'test-006'; description = 'Valid node with stale version tag that should be regenerated'; plain_description = 'Old text'; plain_description_version = 'old-version:v0' }
                    [PSCustomObject]@{ id = 'test-007'; description = $null }
                )
            }
            $TaxData | ConvertTo-Json -Depth 10 |
                Set-Content -Path (Join-Path $Dir 'accelerationist.json') -Encoding UTF8

            $result = Invoke-VernacularBatch -TaxonomyPath $Dir -Confirm:$false
            # test-006 has stale version → should be processed (Generated or Failed), not skipped
            # test-001 also processed (no plain_description at all)
            ($result.Generated + $result.Failed) | Should -Be 2
        }
    }

    It 'Force flag submits already-current nodes for processing' {
        InModuleScope AITriad {
            $forceDir = Join-Path ([System.IO.Path]::GetTempPath()) "vernacular-force-$(Get-Random)"
            New-Item -ItemType Directory -Path $forceDir -Force | Out-Null
            try {
                $TaxData = [PSCustomObject]@{
                    _schema_version = '3.0'; pov = 'test'
                    nodes = @(
                        [PSCustomObject]@{ id = 'f-001'; description = 'A sufficiently long description for testing force mode behavior'; plain_description = 'Already done'; plain_description_version = 'flash-lite:v1' }
                    )
                }
                $TaxData | ConvertTo-Json -Depth 10 |
                    Set-Content -Path (Join-Path $forceDir 'accelerationist.json') -Encoding UTF8

                $noForce = Invoke-VernacularBatch -TaxonomyPath $forceDir -Confirm:$false
                # Without Force, up-to-date node is skipped
                $noForce.Skipped | Should -Be 1
                ($noForce.Generated + $noForce.Failed) | Should -Be 0

                # Re-create the file (previous run may have modified it)
                $TaxData | ConvertTo-Json -Depth 10 |
                    Set-Content -Path (Join-Path $forceDir 'accelerationist.json') -Encoding UTF8

                $withForce = Invoke-VernacularBatch -TaxonomyPath $forceDir -Force -Confirm:$false
                # With Force, the node is processed (Generated or Failed)
                ($withForce.Generated + $withForce.Failed) | Should -Be 1
                $withForce.Skipped | Should -Be 0
            } finally {
                Remove-Item $forceDir -Recurse -Force
            }
        }
    }

    It 'Returns zero generated when all nodes skipped' {
        InModuleScope AITriad {
            $emptyDir = Join-Path ([System.IO.Path]::GetTempPath()) "vernacular-empty-$(Get-Random)"
            New-Item -ItemType Directory -Path $emptyDir -Force | Out-Null
            try {
                $TaxData = [PSCustomObject]@{
                    _schema_version = '3.0'; pov = 'test'
                    nodes = @(
                        [PSCustomObject]@{ id = 'test-x'; description = '' }
                        [PSCustomObject]@{ id = 'test-y'; description = 'Too short' }
                    )
                }
                $TaxData | ConvertTo-Json -Depth 10 |
                    Set-Content -Path (Join-Path $emptyDir 'accelerationist.json') -Encoding UTF8
                $result = Invoke-VernacularBatch -TaxonomyPath $emptyDir -Confirm:$false
                $result.Generated | Should -Be 0
                $result.Skipped | Should -Be 2
            } finally {
                Remove-Item $emptyDir -Recurse -Force
            }
        }
    }

    It 'WhatIf does not modify files' {
        InModuleScope AITriad {
            $whatIfDir = Join-Path ([System.IO.Path]::GetTempPath()) "vernacular-whatif-$(Get-Random)"
            New-Item -ItemType Directory -Path $whatIfDir -Force | Out-Null
            try {
                $TaxData = [PSCustomObject]@{
                    _schema_version = '3.0'; pov = 'test'
                    nodes = @(
                        [PSCustomObject]@{ id = 'wi-001'; description = 'A sufficiently long description for testing WhatIf mode behavior' }
                    )
                }
                $FilePath = Join-Path $whatIfDir 'accelerationist.json'
                $TaxData | ConvertTo-Json -Depth 10 | Set-Content -Path $FilePath -Encoding UTF8
                $before = Get-Content $FilePath -Raw

                Invoke-VernacularBatch -TaxonomyPath $whatIfDir -WhatIf

                $after = Get-Content $FilePath -Raw
                $after | Should -Be $before
            } finally {
                Remove-Item $whatIfDir -Recurse -Force
            }
        }
    }
}

Describe 'Module Manifest - VernacularBatch' -Tag 'enrichment' {

    It 'FunctionsToExport includes Invoke-VernacularBatch' {
        $manifestPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
        $manifest = Test-ModuleManifest -Path $manifestPath
        $manifest.ExportedFunctions.Keys | Should -Contain 'Invoke-VernacularBatch'
    }
}
