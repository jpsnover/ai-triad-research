# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Invoke-GraphQuery cited node ID validation (gap 8.1).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Graph query node ID validation (gap 8.1)' {

    It 'Marks valid referenced_nodes as verified and invalid as unverified' {
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "gq-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

            $TaxJson = @{ nodes = @(
                @{ id = 'acc-beliefs-001'; label = 'A'; description = 'A'; category = 'Beliefs' }
            )} | ConvertTo-Json -Depth 5
            Set-Content -Path (Join-Path $TempDir 'accelerationist.json') -Value $TaxJson
            Set-Content -Path (Join-Path $TempDir 'safetyist.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'skeptic.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'situations.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'edges.json') -Value '{"edges":[]}'

            Mock Get-TaxonomyDir { $TempDir }
            Mock Resolve-AIApiKey { 'fake-key' }
            Mock Get-Prompt { 'Test prompt.' }
            Mock Write-Warning {}

            Mock Invoke-AIApi {
                [PSCustomObject]@{
                    Text = '{"answer":"Test.","confidence":0.8,"referenced_nodes":[{"id":"acc-beliefs-001","pov":"accelerationist","label":"A","relevance":"valid"},{"id":"fake-node-999","pov":"accelerationist","label":"Fake","relevance":"hallucinated"}],"paths_traced":[],"limitations":""}'
                    Backend = 'gemini'; Model = 'gemini-2.5-flash'; Truncated = $false; Usage = $null; RawResponse = @{}
                }
            }

            $result = Invoke-GraphQuery -Question 'Test' -Raw -RepoRoot $TempDir 3>$null 6>$null

            $result.referenced_nodes[0].verified | Should -BeTrue
            $result.referenced_nodes[1].verified | Should -BeFalse
            Should -Invoke Write-Warning -Times 1 -ParameterFilter { $Message -like '*could not be verified*' }

            Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'Adds unverified_nodes to paths with invalid node IDs' {
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "gq-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

            $TaxJson = @{ nodes = @(
                @{ id = 'acc-beliefs-001'; label = 'A'; description = 'A'; category = 'Beliefs' }
            )} | ConvertTo-Json -Depth 5
            Set-Content -Path (Join-Path $TempDir 'accelerationist.json') -Value $TaxJson
            Set-Content -Path (Join-Path $TempDir 'safetyist.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'skeptic.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'situations.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'edges.json') -Value '{"edges":[]}'

            Mock Get-TaxonomyDir { $TempDir }
            Mock Resolve-AIApiKey { 'fake-key' }
            Mock Get-Prompt { 'Test prompt.' }
            Mock Write-Warning {}

            Mock Invoke-AIApi {
                [PSCustomObject]@{
                    Text = '{"answer":"Path analysis.","confidence":0.8,"referenced_nodes":[],"paths_traced":[{"description":"Test path","nodes":["acc-beliefs-001","saf-goals-777"],"edge_types":["SUPPORTS"]}],"limitations":""}'
                    Backend = 'gemini'; Model = 'gemini-2.5-flash'; Truncated = $false; Usage = $null; RawResponse = @{}
                }
            }

            $result = Invoke-GraphQuery -Question 'Test' -Raw -RepoRoot $TempDir 3>$null 6>$null

            $result.paths_traced[0].unverified_nodes | Should -Contain 'saf-goals-777'
            Should -Invoke Write-Warning -Times 1

            Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'Detects unverified node IDs in answer text' {
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "gq-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

            $TaxJson = @{ nodes = @(
                @{ id = 'acc-beliefs-001'; label = 'A'; description = 'A'; category = 'Beliefs' }
            )} | ConvertTo-Json -Depth 5
            Set-Content -Path (Join-Path $TempDir 'accelerationist.json') -Value $TaxJson
            Set-Content -Path (Join-Path $TempDir 'safetyist.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'skeptic.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'situations.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'edges.json') -Value '{"edges":[]}'

            Mock Get-TaxonomyDir { $TempDir }
            Mock Resolve-AIApiKey { 'fake-key' }
            Mock Get-Prompt { 'Test prompt.' }
            Mock Write-Warning {}

            Mock Invoke-AIApi {
                [PSCustomObject]@{
                    Text = '{"answer":"The node saf-desires-999 contradicts acc-beliefs-001.","confidence":0.8,"referenced_nodes":[],"paths_traced":[],"limitations":""}'
                    Backend = 'gemini'; Model = 'gemini-2.5-flash'; Truncated = $false; Usage = $null; RawResponse = @{}
                }
            }

            $null = Invoke-GraphQuery -Question 'Test' -Raw -RepoRoot $TempDir 3>$null 6>$null

            Should -Invoke Write-Warning -Times 1 -ParameterFilter { $Message -like '*1 cited node*' }

            Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'Emits no warning when all cited nodes are valid' {
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "gq-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

            $TaxJson = @{ nodes = @(
                @{ id = 'acc-beliefs-001'; label = 'A'; description = 'A'; category = 'Beliefs' }
                @{ id = 'acc-beliefs-002'; label = 'B'; description = 'B'; category = 'Beliefs' }
            )} | ConvertTo-Json -Depth 5
            Set-Content -Path (Join-Path $TempDir 'accelerationist.json') -Value $TaxJson
            Set-Content -Path (Join-Path $TempDir 'safetyist.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'skeptic.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'situations.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'edges.json') -Value '{"edges":[]}'

            Mock Get-TaxonomyDir { $TempDir }
            Mock Resolve-AIApiKey { 'fake-key' }
            Mock Get-Prompt { 'Test prompt.' }
            Mock Write-Warning {}

            Mock Invoke-AIApi {
                [PSCustomObject]@{
                    Text = '{"answer":"Node acc-beliefs-001 supports acc-beliefs-002.","confidence":0.9,"referenced_nodes":[{"id":"acc-beliefs-001","pov":"accelerationist","label":"A","relevance":"test"}],"paths_traced":[{"description":"path","nodes":["acc-beliefs-001","acc-beliefs-002"],"edge_types":["SUPPORTS"]}],"limitations":""}'
                    Backend = 'gemini'; Model = 'gemini-2.5-flash'; Truncated = $false; Usage = $null; RawResponse = @{}
                }
            }

            $result = Invoke-GraphQuery -Question 'Test' -Raw -RepoRoot $TempDir 3>$null 6>$null

            Should -Invoke Write-Warning -Times 0
            $result.referenced_nodes[0].verified | Should -BeTrue

            Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
