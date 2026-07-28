# Tag: taxonomy (t/1186)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Get-Edge (t/1197: optional-field strict-mode guards)' -Tag 'taxonomy' {

    It 'Returns Model = $null for legacy edges missing the model property' {
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "get-edge-test-$(Get-Random)"
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
            try {
                @{
                    _schema_version = '1.0.0'
                    last_modified   = '2026-06-30'
                    edge_types      = @()
                    edges = @(
                        # Modern edge — has every field
                        @{ source = 'acc-beliefs-001'; target = 'saf-beliefs-001'; type = 'SUPPORTS'
                           bidirectional = $false; confidence = 0.85; status = 'approved'
                           rationale = 'modern edge'; discovered_at = '2026-06-30'; model = 'gemini-3.5-flash-lite' }
                        # Legacy edge — predates model tracking
                        @{ source = 'acc-beliefs-002'; target = 'saf-beliefs-002'; type = 'SUPPORTS'
                           bidirectional = $false; confidence = 0.7; status = 'approved'
                           rationale = 'legacy edge'; discovered_at = '2026-01-15' }
                        # Sparse edge — only the required fields
                        @{ source = 'acc-beliefs-003'; target = 'saf-beliefs-003'; type = 'CONTRADICTS' }
                    )
                } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $TempDir 'edges.json')

                Mock Get-TaxonomyDir { $TempDir }

                $r = Get-Edge
                @($r).Count | Should -Be 3

                $modern = $r | Where-Object { $_.Source -eq 'acc-beliefs-001' }
                $modern.Model | Should -Be 'gemini-3.5-flash-lite'

                $legacy = $r | Where-Object { $_.Source -eq 'acc-beliefs-002' }
                $legacy.Model | Should -BeNullOrEmpty
                $legacy.Rationale | Should -Be 'legacy edge'
                $legacy.DiscoveredAt | Should -Be '2026-01-15'

                $sparse = $r | Where-Object { $_.Source -eq 'acc-beliefs-003' }
                $sparse.Model | Should -BeNullOrEmpty
                $sparse.Rationale | Should -BeNullOrEmpty
                $sparse.Confidence | Should -BeNullOrEmpty
                $sparse.Status | Should -BeNullOrEmpty
                $sparse.DiscoveredAt | Should -BeNullOrEmpty
                $sparse.Bidirectional | Should -Be $false
            } finally {
                Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }

    It 'Does not throw when -Model filter is applied against legacy edges lacking model' {
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "get-edge-modelfilter-$(Get-Random)"
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
            try {
                @{
                    _schema_version = '1.0.0'
                    edges = @(
                        @{ source = 'a'; target = 'b'; type = 'SUPPORTS'; confidence = 0.8; model = 'gemini-3.5-flash-lite' }
                        @{ source = 'b'; target = 'c'; type = 'SUPPORTS'; confidence = 0.8 }                       # legacy, no model
                        @{ source = 'c'; target = 'd'; type = 'SUPPORTS'; confidence = 0.8; model = 'claude-opus-4' }
                    )
                } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $TempDir 'edges.json')
                Mock Get-TaxonomyDir { $TempDir }

                # Note: -Model has Test-AIModelId validation (canonical IDs only,
                # no wildcards). The guard still matters defensively — without it
                # the filter loop would crash on legacy edges before reaching the
                # match check. Use a valid canonical ID.
                { Get-Edge -Model 'gemini-3.5-flash-lite' } | Should -Not -Throw
                $hits = @(Get-Edge -Model 'gemini-3.5-flash-lite')
                $hits.Count | Should -Be 1
                $hits[0].Source | Should -Be 'a'
            } finally {
                Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }

    It 'Does not throw when -DiscoveredAfter is applied against legacy edges lacking discovered_at' {
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "get-edge-datefilter-$(Get-Random)"
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
            try {
                @{
                    _schema_version = '1.0.0'
                    edges = @(
                        @{ source = 'a'; target = 'b'; type = 'SUPPORTS'; confidence = 0.8; discovered_at = '2026-06-30' }
                        @{ source = 'b'; target = 'c'; type = 'SUPPORTS'; confidence = 0.8 }   # no discovered_at
                        @{ source = 'c'; target = 'd'; type = 'SUPPORTS'; confidence = 0.8; discovered_at = '2025-01-01' }
                    )
                } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $TempDir 'edges.json')
                Mock Get-TaxonomyDir { $TempDir }

                { Get-Edge -DiscoveredAfter '2026-01-01' } | Should -Not -Throw
                $hits = @(Get-Edge -DiscoveredAfter '2026-01-01')
                $hits.Count | Should -Be 1
                $hits[0].Source | Should -Be 'a'
            } finally {
                Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }

    It 'Does not throw on a real-world data shape with ~12% missing model' {
        # Sanity: same scenario the original bug report described
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "get-edge-bulk-$(Get-Random)"
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
            try {
                $edges = @()
                for ($i = 0; $i -lt 100; $i++) {
                    $edge = @{ source = "n-$i"; target = "n-$($i+1)"; type = 'SUPPORTS'
                               bidirectional = $false; confidence = 0.8; status = 'approved'
                               rationale = 'test'; discovered_at = '2026-06-30' }
                    if ($i % 8 -ne 0) { $edge.model = 'gemini-3.5-flash-lite' }   # 12 of 100 missing model
                    $edges += $edge
                }
                @{ _schema_version = '1.0.0'; last_modified = '2026-06-30'; edge_types = @(); edges = $edges } |
                    ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $TempDir 'edges.json')

                Mock Get-TaxonomyDir { $TempDir }
                { Get-Edge } | Should -Not -Throw
                $r = Get-Edge
                @($r | Where-Object { $null -eq $_.Model }).Count | Should -Be 13   # i=0,8,16,...,96
            } finally {
                Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
