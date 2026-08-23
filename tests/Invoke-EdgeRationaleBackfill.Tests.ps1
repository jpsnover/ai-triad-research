# Tag: taxonomy (t/2679)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Invoke-EdgeRationaleBackfill (t/2679) — AI edge-rationale backfill.
.DESCRIPTION
    The AI call (Invoke-AIApi) and the writer (Write-EdgesFile) are mocked, so NO
    spend and NO disk writes occur. Each It is self-contained (fixture + mocks + call
    in one InModuleScope) to avoid cross-file mock-carry flakiness.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Invoke-EdgeRationaleBackfill (t/2679)' -Tag 'taxonomy' {

    It 'is exported from the AITriad module' {
        Get-Command -Module AITriad -Name 'Invoke-EdgeRationaleBackfill' | Should -Not -BeNullOrEmpty
    }

    It 'DryRun selects only UIVisible rationale-less edges — no API call, no write' {
        InModuleScope AITriad {
            $dir = Join-Path ([System.IO.Path]::GetTempPath()) "erb-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            @{ nodes = @(
                @{ id = 'acc-b-1'; label = 'A'; description = 'Desc A' }
                @{ id = 'acc-b-2'; label = 'B'; description = 'Desc B' }
            ) } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $dir 'accelerationist.json')
            @{
                _schema_version = '1.0.0'; _doc = 't'; last_modified = '2026-01-01'
                edge_types = @(@{ type = 'SUPPORTS'; bidirectional = $false; definition = 'Source strengthens target.' })
                edges = @(
                    @{ source = 'acc-b-1'; target = 'acc-b-2'; type = 'SUPPORTS'; confidence = 0.8; status = 'approved' }                          # rationale-less approved
                    @{ source = 'acc-b-2'; target = 'acc-b-1'; type = 'SUPPORTS'; confidence = 0.7; status = 'approved'; rationale = 'already here' } # has rationale
                    @{ source = 'acc-b-1'; target = 'acc-b-2'; type = 'WEAKENS';  confidence = 0.6; status = 'proposed' }                          # proposed
                )
            } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $dir 'edges.json')

            Mock Get-TaxonomyDir { $dir }
            Mock Resolve-AIApiKey { 'fake-key' }
            Mock Invoke-AIApi { [PSCustomObject]@{ Text = '{"rationale":"nope"}' } }
            Mock Write-EdgesFile { }

            try {
                $r = Invoke-EdgeRationaleBackfill -Scope UIVisible -DryRun 6>$null
                $r.Targeted | Should -Be 1 -Because 'only the approved rationale-less edge qualifies (has-rationale + proposed excluded)'
                $r.DryRun   | Should -BeTrue
                $r.Backfilled | Should -Be 0
                Should -Invoke Invoke-AIApi   -Times 0 -Exactly
                Should -Invoke Write-EdgesFile -Times 0 -Exactly
            } finally { Remove-Item -Path $dir -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }

    It 'backfills an approved rationale-less edge and writes it back' {
        InModuleScope AITriad {
            $dir = Join-Path ([System.IO.Path]::GetTempPath()) "erb-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            @{ nodes = @(
                @{ id = 'acc-b-1'; label = 'A'; description = 'Desc A' }
                @{ id = 'acc-b-2'; label = 'B'; description = 'Desc B' }
            ) } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $dir 'accelerationist.json')
            @{
                _schema_version = '1.0.0'; _doc = 't'; last_modified = '2026-01-01'
                edge_types = @(@{ type = 'SUPPORTS'; bidirectional = $false; definition = 'Source strengthens target.' })
                edges = @(@{ source = 'acc-b-1'; target = 'acc-b-2'; type = 'SUPPORTS'; confidence = 0.8; status = 'approved' })
            } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $dir 'edges.json')

            Mock Get-TaxonomyDir { $dir }
            Mock Resolve-AIApiKey { 'fake-key' }
            Mock Invoke-AIApi { [PSCustomObject]@{ Text = '{"rationale":"Generated reason"}' } }
            $script:Captured = $null
            Mock Write-EdgesFile { $script:Captured = $EdgesData }

            try {
                $r = Invoke-EdgeRationaleBackfill -Scope UIVisible -CheckpointEvery 0 6>$null
                $r.Backfilled | Should -Be 1
                $r.Failed     | Should -Be 0
                Should -Invoke Invoke-AIApi -Times 1 -Exactly
                Should -Invoke Write-EdgesFile -Times 1 -Exactly
                $script:Captured.edges[0].rationale | Should -Be 'Generated reason'
            } finally { Remove-Item -Path $dir -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }

    It 'stamps rationale_source=backfill on a backfilled edge (t/2944 write-together invariant)' {
        InModuleScope AITriad {
            $dir = Join-Path ([System.IO.Path]::GetTempPath()) "erb-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            @{ nodes = @(
                @{ id = 'acc-b-1'; label = 'A'; description = 'Desc A' }
                @{ id = 'acc-b-2'; label = 'B'; description = 'Desc B' }
            ) } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $dir 'accelerationist.json')
            @{
                _schema_version = '1.0.0'; _doc = 't'; last_modified = '2026-01-01'
                edge_types = @(@{ type = 'SUPPORTS'; bidirectional = $false; definition = 'Source strengthens target.' })
                edges = @(@{ source = 'acc-b-1'; target = 'acc-b-2'; type = 'SUPPORTS'; confidence = 0.8; status = 'approved' })
            } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $dir 'edges.json')

            Mock Get-TaxonomyDir { $dir }
            Mock Resolve-AIApiKey { 'fake-key' }
            Mock Invoke-AIApi { [PSCustomObject]@{ Text = '{"rationale":"Generated reason"}' } }
            $script:Captured = $null
            Mock Write-EdgesFile { $script:Captured = $EdgesData }

            try {
                $r = Invoke-EdgeRationaleBackfill -Scope UIVisible -CheckpointEvery 0 6>$null
                $r.Backfilled | Should -Be 1
                # The rationale and its provenance move together in the same write.
                $script:Captured.edges[0].rationale        | Should -Be 'Generated reason'
                $script:Captured.edges[0].rationale_source | Should -Be 'backfill'
            } finally { Remove-Item -Path $dir -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }

    It 'is idempotent + scope-aware: -Scope All includes proposed, excludes already-populated' {
        InModuleScope AITriad {
            $dir = Join-Path ([System.IO.Path]::GetTempPath()) "erb-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            @{ nodes = @(
                @{ id = 'acc-b-1'; label = 'A'; description = 'Desc A' }
                @{ id = 'acc-b-2'; label = 'B'; description = 'Desc B' }
            ) } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $dir 'accelerationist.json')
            @{
                _schema_version = '1.0.0'; _doc = 't'; last_modified = '2026-01-01'
                edge_types = @(@{ type = 'SUPPORTS'; bidirectional = $false; definition = 'x' })
                edges = @(
                    @{ source = 'acc-b-1'; target = 'acc-b-2'; type = 'SUPPORTS'; confidence = 0.8; status = 'approved' }
                    @{ source = 'acc-b-2'; target = 'acc-b-1'; type = 'SUPPORTS'; confidence = 0.7; status = 'approved'; rationale = 'already here' }
                    @{ source = 'acc-b-1'; target = 'acc-b-2'; type = 'WEAKENS';  confidence = 0.6; status = 'proposed' }
                )
            } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $dir 'edges.json')

            Mock Get-TaxonomyDir { $dir }
            Mock Resolve-AIApiKey { 'fake-key' }
            Mock Invoke-AIApi { [PSCustomObject]@{ Text = '{"rationale":"nope"}' } }
            Mock Write-EdgesFile { }

            try {
                $r = Invoke-EdgeRationaleBackfill -Scope All -DryRun 6>$null
                $r.Targeted | Should -Be 2 -Because 'All-scope targets both rationale-less edges (approved + proposed); the already-populated one is excluded'
            } finally { Remove-Item -Path $dir -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }

    It 'SILENT-BLANK: empty rationale from the LLM leaves the edge unchanged (Failed=1, never written blank)' {
        InModuleScope AITriad {
            $dir = Join-Path ([System.IO.Path]::GetTempPath()) "erb-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            @{ nodes = @(
                @{ id = 'acc-b-1'; label = 'A'; description = 'Desc A' }
                @{ id = 'acc-b-2'; label = 'B'; description = 'Desc B' }
            ) } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $dir 'accelerationist.json')
            @{
                _schema_version = '1.0.0'; _doc = 't'; last_modified = '2026-01-01'
                edge_types = @(@{ type = 'SUPPORTS'; bidirectional = $false; definition = 'x' })
                edges = @(@{ source = 'acc-b-1'; target = 'acc-b-2'; type = 'SUPPORTS'; confidence = 0.8; status = 'approved' })
            } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $dir 'edges.json')

            Mock Get-TaxonomyDir { $dir }
            Mock Resolve-AIApiKey { 'fake-key' }
            Mock Invoke-AIApi { [PSCustomObject]@{ Text = '{"rationale":""}' } }  # empty — the silent-blank case
            Mock Write-EdgesFile { }

            try {
                $r = Invoke-EdgeRationaleBackfill -Scope UIVisible -CheckpointEvery 0 -WarningAction SilentlyContinue 6>$null
                $r.Backfilled | Should -Be 0
                $r.Failed     | Should -Be 1
                Should -Invoke Write-EdgesFile -Times 0 -Exactly -Because 'a blank rationale must never be written (t/2674 contract)'
            } finally { Remove-Item -Path $dir -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }

    It '-Limit caps the number of edges processed' {
        InModuleScope AITriad {
            $dir = Join-Path ([System.IO.Path]::GetTempPath()) "erb-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            @{ nodes = @(
                @{ id = 'acc-b-1'; label = 'A'; description = 'Desc A' }
                @{ id = 'acc-b-2'; label = 'B'; description = 'Desc B' }
            ) } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $dir 'accelerationist.json')
            @{
                _schema_version = '1.0.0'; _doc = 't'; last_modified = '2026-01-01'
                edge_types = @(@{ type = 'SUPPORTS'; bidirectional = $false; definition = 'x' })
                edges = @(
                    @{ source = 'acc-b-1'; target = 'acc-b-2'; type = 'SUPPORTS'; confidence = 0.8; status = 'approved' }
                    @{ source = 'acc-b-2'; target = 'acc-b-1'; type = 'SUPPORTS'; confidence = 0.7; status = 'approved' }
                )
            } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $dir 'edges.json')

            Mock Get-TaxonomyDir { $dir }
            Mock Resolve-AIApiKey { 'fake-key' }
            Mock Invoke-AIApi { [PSCustomObject]@{ Text = '{"rationale":"nope"}' } }
            Mock Write-EdgesFile { }

            try {
                $r = Invoke-EdgeRationaleBackfill -Scope UIVisible -Limit 1 -DryRun 6>$null
                $r.Targeted | Should -Be 1 -Because '-Limit 1 caps two eligible edges to one'
            } finally { Remove-Item -Path $dir -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }

    It '-MinConfidence excludes edges below the threshold' {
        InModuleScope AITriad {
            $dir = Join-Path ([System.IO.Path]::GetTempPath()) "erb-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            @{ nodes = @(
                @{ id = 'acc-b-1'; label = 'A'; description = 'Desc A' }
                @{ id = 'acc-b-2'; label = 'B'; description = 'Desc B' }
            ) } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $dir 'accelerationist.json')
            @{
                _schema_version = '1.0.0'; _doc = 't'; last_modified = '2026-01-01'
                edge_types = @(@{ type = 'SUPPORTS'; bidirectional = $false; definition = 'x' })
                edges = @(
                    @{ source = 'acc-b-1'; target = 'acc-b-2'; type = 'SUPPORTS'; confidence = 0.97; status = 'approved' }  # keep
                    @{ source = 'acc-b-2'; target = 'acc-b-1'; type = 'SUPPORTS'; confidence = 0.80; status = 'approved' }  # below 0.95
                )
            } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $dir 'edges.json')

            Mock Get-TaxonomyDir { $dir }
            Mock Resolve-AIApiKey { 'fake-key' }
            Mock Invoke-AIApi { [PSCustomObject]@{ Text = '{"rationale":"nope"}' } }
            Mock Write-EdgesFile { }

            try {
                $r = Invoke-EdgeRationaleBackfill -Scope UIVisible -MinConfidence 0.95 -DryRun 6>$null
                $r.Targeted | Should -Be 1 -Because 'only the 0.97 edge clears the 0.95 gate; the 0.80 edge is excluded'
            } finally { Remove-Item -Path $dir -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }

    It 'skips self-loop edges (source == target) and reports the count' {
        InModuleScope AITriad {
            $dir = Join-Path ([System.IO.Path]::GetTempPath()) "erb-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            @{ nodes = @(
                @{ id = 'acc-b-1'; label = 'A'; description = 'Desc A' }
                @{ id = 'acc-b-2'; label = 'B'; description = 'Desc B' }
            ) } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $dir 'accelerationist.json')
            @{
                _schema_version = '1.0.0'; _doc = 't'; last_modified = '2026-01-01'
                edge_types = @(@{ type = 'SUPPORTS'; bidirectional = $false; definition = 'x' })
                edges = @(
                    @{ source = 'acc-b-1'; target = 'acc-b-1'; type = 'SUPPORTS'; confidence = 0.99; status = 'approved' }  # self-loop → skip
                    @{ source = 'acc-b-1'; target = 'acc-b-2'; type = 'SUPPORTS'; confidence = 0.99; status = 'approved' }  # keep
                )
            } | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $dir 'edges.json')

            Mock Get-TaxonomyDir { $dir }
            Mock Resolve-AIApiKey { 'fake-key' }
            Mock Invoke-AIApi { [PSCustomObject]@{ Text = '{"rationale":"nope"}' } }
            Mock Write-EdgesFile { }

            try {
                $r = Invoke-EdgeRationaleBackfill -Scope UIVisible -DryRun -WarningAction SilentlyContinue 6>$null
                $r.Targeted         | Should -Be 1 -Because 'the self-loop is excluded; only the real edge remains'
                $r.SelfLoopsSkipped | Should -Be 1 -Because 'the source==target edge must be counted as a skipped self-loop'
            } finally { Remove-Item -Path $dir -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }
}
