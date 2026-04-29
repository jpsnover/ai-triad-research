# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Invoke-EdgeDiscovery edge validation — gaps 7.1-7.4.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Edge validation (gaps 7.1-7.4)' {

    It 'Rejects edges with invalid type, self-loop, unknown target, and duplicates' {
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "edge-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

            $TaxJson = @{
                nodes = @(
                    @{ id = 'acc-beliefs-001'; label = 'Node A'; description = 'Test A'; category = 'Beliefs' }
                    @{ id = 'saf-beliefs-001'; label = 'Node B'; description = 'Test B'; category = 'Beliefs' }
                )
            } | ConvertTo-Json -Depth 5
            Set-Content -Path (Join-Path $TempDir 'accelerationist.json') -Value $TaxJson
            Set-Content -Path (Join-Path $TempDir 'safetyist.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'skeptic.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'situations.json') -Value '{"nodes":[]}'

            Mock Get-TaxonomyDir { $TempDir }
            Mock Resolve-AIApiKey { 'fake-key' }

            $script:CapturedEdgesJson = $null
            Mock Write-Utf8NoBom { $script:CapturedEdgesJson = $Value }

            Mock Invoke-NodeEdgeDiscovery {
                [PSCustomObject]@{
                    NodeId       = $Node.id
                    RawEdges     = @(
                        # 1. Valid edge — should be accepted
                        [PSCustomObject]@{ target = 'saf-beliefs-001'; type = 'SUPPORTS'; confidence = 0.8; rationale = 'Valid' }
                        # 2. Invalid edge type (gap 7.2) — should be rejected
                        [PSCustomObject]@{ target = 'saf-beliefs-001'; type = 'SLIGHTLY_RELATED'; confidence = 0.9; rationale = 'Bad type' }
                        # 3. Self-loop (gap 7.3) — should be rejected
                        [PSCustomObject]@{ target = 'acc-beliefs-001'; type = 'SUPPORTS'; confidence = 0.8; rationale = 'Self' }
                        # 4. Unknown target (gap 7.1) — should be rejected
                        [PSCustomObject]@{ target = 'nonexistent-999'; type = 'SUPPORTS'; confidence = 0.8; rationale = 'Bad target' }
                        # 5. Duplicate of #1 (gap 7.4) — should be rejected
                        [PSCustomObject]@{ target = 'saf-beliefs-001'; type = 'SUPPORTS'; confidence = 0.8; rationale = 'Duplicate' }
                    )
                    NewEdgeTypes = @()
                    Error        = $null
                    ElapsedSec   = 0.5
                }
            }

            $null = Invoke-EdgeDiscovery -NodeId 'acc-beliefs-001' -Force -RepoRoot $TempDir 3>$null 6>$null

            $script:CapturedEdgesJson | Should -Not -BeNullOrEmpty
            $written = $script:CapturedEdgesJson | ConvertFrom-Json

            # Only the first valid edge should survive
            $written.edges.Count | Should -Be 1
            $written.edges[0].type | Should -Be 'SUPPORTS'
            $written.edges[0].source | Should -Be 'acc-beliefs-001'
            $written.edges[0].target | Should -Be 'saf-beliefs-001'

            Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'Accepts all 9 canonical edge types' {
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "edge-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

            $TaxJson = @{
                nodes = @(
                    @{ id = 'acc-beliefs-001'; label = 'A'; description = 'A'; category = 'Beliefs' }
                    @{ id = 'saf-beliefs-001'; label = 'B'; description = 'B'; category = 'Beliefs' }
                )
            } | ConvertTo-Json -Depth 5
            Set-Content -Path (Join-Path $TempDir 'accelerationist.json') -Value $TaxJson
            Set-Content -Path (Join-Path $TempDir 'safetyist.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'skeptic.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'situations.json') -Value '{"nodes":[]}'

            Mock Get-TaxonomyDir { $TempDir }
            Mock Resolve-AIApiKey { 'fake-key' }

            $script:CapturedEdgesJson = $null
            Mock Write-Utf8NoBom { $script:CapturedEdgesJson = $Value }

            Mock Invoke-NodeEdgeDiscovery {
                $edges = @()
                foreach ($t in @('SUPPORTS', 'CONTRADICTS', 'ASSUMES', 'WEAKENS',
                                 'RESPONDS_TO', 'TENSION_WITH', 'CITES', 'INTERPRETS', 'SUPPORTED_BY')) {
                    $edges += [PSCustomObject]@{ target = 'saf-beliefs-001'; type = $t; confidence = 0.8; rationale = "Test $t" }
                }
                [PSCustomObject]@{
                    NodeId = $Node.id; RawEdges = $edges; NewEdgeTypes = @()
                    Error = $null; ElapsedSec = 0.5
                }
            }

            $null = Invoke-EdgeDiscovery -NodeId 'acc-beliefs-001' -Force -RepoRoot $TempDir 3>$null 6>$null

            $written = $script:CapturedEdgesJson | ConvertFrom-Json
            $written.edges.Count | Should -Be 9

            Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
