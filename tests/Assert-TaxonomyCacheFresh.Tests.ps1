# Tag: taxonomy (t/1186)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Assert-TaxonomyCacheFresh staleness detection.
.DESCRIPTION
    Regression coverage for the asymmetry bug where non-POV aux files in the
    taxonomy dir (logs, staging, cruxes — files without a 'nodes' property)
    were scanned by the freshness check but never had their timestamp recorded
    by the reload loop, causing `-not $Cached` to fire forever and force a full
    reload on every check past the 30s cooldown.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Assert-TaxonomyCacheFresh staleness detection' -Tag 'taxonomy' {

    It 'Does not reload again when only non-POV aux files are present and unchanged' {
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "cache-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

            # POV taxonomy files (have a 'nodes' property — these get cached)
            Set-Content -Path (Join-Path $TempDir 'accelerationist.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'safetyist.json')       -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'skeptic.json')         -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'situations.json')      -Value '{"nodes":[]}'
            # Non-POV aux file: not in the exclusion list, no 'nodes' property.
            # This is the file that used to perpetually re-trigger reloads.
            $AuxFile = Join-Path $TempDir 'aggregated-cruxes.json'
            Set-Content -Path $AuxFile -Value '{"cruxes":[]}'

            Mock Get-TaxonomyDir { $TempDir }

            # Start from a clean cache so the first call performs the initial load.
            $script:TaxonomyData = @{}
            $script:TaxonomyFileTimestamps = @{}
            $script:TaxonomyCacheLastCheck = $null

            # First call: cache empty -> must reload from disk.
            $firstRun = Assert-TaxonomyCacheFresh -Verbose 4>&1
            @($firstRun | Where-Object { $_ -match 'reloading from disk' }).Count |
                Should -BeGreaterThan 0 -Because 'an empty cache should load from disk'

            # The aux file must now have a recorded timestamp even though it was
            # not loaded into $script:TaxonomyData.
            $script:TaxonomyFileTimestamps.ContainsKey($AuxFile) |
                Should -BeTrue -Because 'every scanned file must be stamped, not just POV files'

            # Defeat the 30s cooldown so the second call actually re-runs the check.
            $script:TaxonomyCacheLastCheck = $null

            # Second call with nothing changed on disk: must NOT reload.
            $secondRun = Assert-TaxonomyCacheFresh -Verbose 4>&1
            @($secondRun | Where-Object { $_ -match 'reloading from disk' }).Count |
                Should -Be 0 -Because 'unchanged aux files must not trigger a reload'

            Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'Still reloads when a POV taxonomy file is genuinely modified' {
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "cache-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

            Set-Content -Path (Join-Path $TempDir 'accelerationist.json') -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'safetyist.json')       -Value '{"nodes":[]}'
            Set-Content -Path (Join-Path $TempDir 'skeptic.json')         -Value '{"nodes":[]}'
            $PovFile = Join-Path $TempDir 'situations.json'
            Set-Content -Path $PovFile -Value '{"nodes":[]}'

            Mock Get-TaxonomyDir { $TempDir }

            $script:TaxonomyData = @{}
            $script:TaxonomyFileTimestamps = @{}
            $script:TaxonomyCacheLastCheck = $null

            Assert-TaxonomyCacheFresh | Out-Null  # initial load

            # Modify a POV file and push its timestamp into the future to beat
            # filesystem timestamp granularity.
            Set-Content -Path $PovFile -Value '{"nodes":[{"id":"saf-beliefs-001"}]}'
            (Get-Item $PovFile).LastWriteTime = (Get-Date).AddSeconds(5)

            $script:TaxonomyCacheLastCheck = $null
            $run = Assert-TaxonomyCacheFresh -Verbose 4>&1
            @($run | Where-Object { $_ -match 'reloading from disk' }).Count |
                Should -BeGreaterThan 0 -Because 'a changed POV file must still trigger a reload'

            Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'Does not register a sidecar log (entity_extraction_log.json) as a POV — t/1834' {
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "cache-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

            # A real POV file (nodes[].id) — must register.
            Set-Content -Path (Join-Path $TempDir 'accelerationist.json') `
                -Value '{"nodes":[{"id":"acc-desires-001","label":"L","description":"D"}]}'
            # The entity extraction idempotence sidecar (t/1806): a top-level nodes[]
            # whose entries are keyed by 'node_id', not 'id'. It is NOT in the
            # exclusion list, so only the shape gate keeps it out of TaxonomyData.
            Set-Content -Path (Join-Path $TempDir 'entity_extraction_log.json') `
                -Value '{"node_count":1,"nodes":[{"node_id":"acc-beliefs-003","model":"claude-sonnet-4-6"}]}'

            Mock Get-TaxonomyDir { $TempDir }

            $script:TaxonomyData = @{}
            $script:TaxonomyFileTimestamps = @{}
            $script:TaxonomyCacheLastCheck = $null

            Assert-TaxonomyCacheFresh | Out-Null

            $script:TaxonomyData.ContainsKey('accelerationist') |
                Should -BeTrue -Because 'a real POV file must still register'
            $script:TaxonomyData.ContainsKey('entity_extraction_log') |
                Should -BeFalse -Because 'a sidecar log (node_id-keyed nodes[]) must not be treated as a POV'

            # And Get-Tax must not crash with the log present in the dir.
            { Get-Tax -Id 'acc-desires-001' } |
                Should -Not -Throw -Because 't/1834: Get-Tax crashed on the id-less log nodes'

            Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
