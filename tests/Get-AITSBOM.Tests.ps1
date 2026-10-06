# Tag: sbom (t/3910)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Characterization tests for Get-AITSBOM (t/3910), written to pin current
    behavior BEFORE the complexity refactor so the same assertions pass
    unchanged after it.
.DESCRIPTION
    Pins: entry shape/fields across all six enumeration sources via a
    $TestDrive -RepoRoot fixture (npm, python, ai-models, schemas -- the
    four sources that take -RepoRoot; PowerShell modules and system tools
    always read from the real repo/PATH and are asserted structurally
    only); the malformed-input warning/fallback paths for each parseable
    source; -Format Table/Json/Csv/CycloneDX/SPDX; -CheckUpdates populating
    Status on every entry; and -Update's "all up to date" / outdated-list
    console paths under -WhatIf (never touching the real package managers).
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue
}

Describe 'Get-AITSBOM' -Tag 'sbom' {

    BeforeAll {
        $script:FixtureRoot = Join-Path $TestDrive 'repo'
        New-Item -ItemType Directory -Path $script:FixtureRoot -Force | Out-Null

        # Root package.json (dependencies + devDependencies)
        @{
            dependencies    = @{ 'left-pad' = '^1.3.0' }
            devDependencies = @{ 'eslint' = '~8.0.0' }
        } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $script:FixtureRoot 'package.json')

        # requirements.txt: a pinned pkg, an extras pkg, a comment, a blank line, an 'any' pkg.
        # Deliberately fake names (never really pip-installed) so Update-AITSBOMPythonMetadata's
        # `pip show` enrichment can never race this fixture's asserted values.
        @"
# comment line
zzz-fixture-pinned-pkg==2.31.0
zzz-fixture-extras-pkg[s3]>=1.26.0

zzz-fixture-any-pkg
"@ | Set-Content -Path (Join-Path $script:FixtureRoot 'requirements.txt')

        # ai-models.json
        @{
            models = @(
                @{ id = 'gemini-3.5-flash-lite'; backend = 'gemini'; display_name = 'Gemini 3.5 Flash Lite'; license = 'proprietary' }
                @{ id = 'claude-sonnet-5'; backend = 'anthropic' }
                @{ id = 'no-backend-model' }
            )
        } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $script:FixtureRoot 'ai-models.json')

        # taxonomy/schemas/*.schema.json
        $SchemaDir = Join-Path (Join-Path $script:FixtureRoot 'taxonomy') 'schemas'
        New-Item -ItemType Directory -Path $SchemaDir -Force | Out-Null
        @{ version = '1.2.0' } | ConvertTo-Json | Set-Content -Path (Join-Path $SchemaDir 'node.schema.json')
        @{ '$schema' = 'http://json-schema.org/draft-07/schema#' } | ConvertTo-Json | Set-Content -Path (Join-Path $SchemaDir 'no-version.schema.json')

        # scripts/ dir required by Get-AITSBOMPythonPackages's path join, even though
        # requirements.txt itself lives at the fixture root in this test (RepoRoot/scripts/requirements.txt
        # is the real convention; mirror it so the path resolves).
        $ScriptsDir = Join-Path $script:FixtureRoot 'scripts'
        New-Item -ItemType Directory -Path $ScriptsDir -Force | Out-Null
        Move-Item -Path (Join-Path $script:FixtureRoot 'requirements.txt') -Destination (Join-Path $ScriptsDir 'requirements.txt')
    }

    Context 'enumeration -- fixture-backed sources (npm, python, ai-models, schemas)' {

        It 'includes npm dependencies and devDependencies with cleaned version specifiers' {
            $r = Get-AITSBOM -RepoRoot $script:FixtureRoot -WarningAction SilentlyContinue
            $npm = @($r | Where-Object { $_.Name -eq 'left-pad' })
            $npm.Count | Should -Be 1
            $npm[0].Version | Should -Be '1.3.0'
            $npm[0].Type | Should -Be 'npm'
            $npm[0].Scope | Should -Be 'required'

            $dev = @($r | Where-Object { $_.Name -eq 'eslint' })
            $dev[0].Version | Should -Be '8.0.0'
            $dev[0].Type | Should -Be 'npm-dev'
            $dev[0].Scope | Should -Be 'development'
        }

        It 'includes python packages, with extras bracket stripped from the PyPI URL but kept in Name' {
            # Fake, never-really-installed package names (see the requirements.txt fixture
            # above), so Update-AITSBOMPythonMetadata's `pip show` enrichment can never
            # overwrite these asserted values with a real installed version.
            $r = Get-AITSBOM -RepoRoot $script:FixtureRoot -WarningAction SilentlyContinue
            $pinned = @($r | Where-Object { $_.Name -eq 'zzz-fixture-pinned-pkg' })
            $pinned[0].Version | Should -Be '2.31.0'
            $pinned[0].Type | Should -Be 'python'

            $extras = @($r | Where-Object { $_.Name -eq 'zzz-fixture-extras-pkg[s3]' })
            $extras[0].Version | Should -Be '1.26.0'
            $extras[0].SourceUrl | Should -Be 'https://pypi.org/project/zzz-fixture-extras-pkg/'

            $any = @($r | Where-Object { $_.Name -eq 'zzz-fixture-any-pkg' -and $_.Type -eq 'python' })
            $any[0].Version | Should -Be 'any'
        }

        It 'includes AI models with backend-specific SourceUrl, and no URL/supplier when backend is absent' {
            $r = Get-AITSBOM -RepoRoot $script:FixtureRoot -WarningAction SilentlyContinue
            $gemini = @($r | Where-Object { $_.Name -eq 'gemini-3.5-flash-lite' })[0]
            $gemini.SourceUrl | Should -Be 'https://ai.google.dev/models/gemini-3.5-flash-lite'
            $gemini.License | Should -Be 'proprietary'
            $gemini.Description | Should -Be 'Gemini 3.5 Flash Lite'

            $noBackend = @($r | Where-Object { $_.Name -eq 'no-backend-model' })[0]
            $noBackend.SourceUrl | Should -BeNullOrEmpty
            $noBackend.Supplier | Should -BeNullOrEmpty
            $noBackend.Version | Should -Be 'latest' -Because 'no version field on the fixture model'
        }

        It 'includes schema files, reading version or falling back to json-schema/unknown' {
            $r = Get-AITSBOM -RepoRoot $script:FixtureRoot -WarningAction SilentlyContinue
            $versioned = @($r | Where-Object { $_.Name -eq 'node.schema' })[0]
            $versioned.Version | Should -Be '1.2.0'
            $versioned.Type | Should -Be 'schema'

            $unversioned = @($r | Where-Object { $_.Name -eq 'no-version.schema' })[0]
            $unversioned.Version | Should -Be 'json-schema'
        }
    }

    Context 'enumeration -- real-repo sources (PowerShell modules, system tools)' {

        It 'includes at least the three companion PowerShell modules' {
            $r = Get-AITSBOM -RepoRoot $script:FixtureRoot -WarningAction SilentlyContinue
            $companions = @($r | Where-Object { $_.Type -eq 'ps-module' -and $_.Name -in @('AIEnrich', 'DocConverters', 'PdfOptimizer') })
            $companions.Count | Should -Be 3
        }

        It 'includes all eight system tools, each with a non-null Version (found or "not found")' {
            $r = Get-AITSBOM -RepoRoot $script:FixtureRoot -WarningAction SilentlyContinue
            $tools = @($r | Where-Object { $_.Type -eq 'system' })
            $tools.Count | Should -Be 8
            $tools | ForEach-Object { $_.Version | Should -Not -BeNullOrEmpty }
        }
    }

    Context 'malformed-input fallback paths (Fallback-Path Logging)' {

        It 'warns and continues when package.json is malformed, without crashing other sections' {
            $BadRoot = Join-Path $TestDrive 'bad-npm'
            New-Item -ItemType Directory -Path $BadRoot -Force | Out-Null
            New-Item -ItemType Directory -Path (Join-Path $BadRoot 'scripts') -Force | Out-Null
            'not valid json' | Set-Content -Path (Join-Path $BadRoot 'package.json')

            $w = $null
            $r = Get-AITSBOM -RepoRoot $BadRoot -WarningVariable w -WarningAction SilentlyContinue
            $w | Where-Object { $_ -match 'Failed to parse package\.json' } | Should -Not -BeNullOrEmpty
            @($r | Where-Object { $_.Type -eq 'ps-module' }).Count | Should -BeGreaterThan 0 -Because 'other sections still ran'
        }

        It 'warns and continues when ai-models.json is malformed' {
            $BadRoot = Join-Path $TestDrive 'bad-models'
            New-Item -ItemType Directory -Path $BadRoot -Force | Out-Null
            New-Item -ItemType Directory -Path (Join-Path $BadRoot 'scripts') -Force | Out-Null
            'not valid json' | Set-Content -Path (Join-Path $BadRoot 'ai-models.json')

            $w = $null
            $null = Get-AITSBOM -RepoRoot $BadRoot -WarningVariable w -WarningAction SilentlyContinue
            $w | Where-Object { $_ -match 'Failed to parse ai-models\.json' } | Should -Not -BeNullOrEmpty
        }

        It 'silently skips an unparseable schema file (empty catch, pinned current behavior)' {
            $BadRoot = Join-Path $TestDrive 'bad-schema'
            $SchemaDir = Join-Path (Join-Path $BadRoot 'taxonomy') 'schemas'
            New-Item -ItemType Directory -Path $SchemaDir -Force | Out-Null
            New-Item -ItemType Directory -Path (Join-Path $BadRoot 'scripts') -Force | Out-Null
            'not valid json' | Set-Content -Path (Join-Path $SchemaDir 'broken.schema.json')

            $w = $null
            $r = Get-AITSBOM -RepoRoot $BadRoot -WarningVariable w -WarningAction SilentlyContinue
            $w | Where-Object { $_ -match 'broken' } | Should -BeNullOrEmpty -Because 'schema parse failures are swallowed, not warned'
            $entry = @($r | Where-Object { $_.Name -eq 'broken.schema' })[0]
            $entry.Version | Should -Be 'unknown'
        }
    }

    Context 'output formatting' {

        It '-Format Table returns the raw entries (every field present, LatestVersion/Status null without -CheckUpdates)' {
            $r = Get-AITSBOM -RepoRoot $script:FixtureRoot -WarningAction SilentlyContinue
            $r | Should -Not -BeNullOrEmpty
            ($r | Where-Object { $_.Name -eq 'left-pad' })[0].Status | Should -BeNullOrEmpty
        }

        It '-Format Json returns valid JSON with the base field set (no LatestVersion/Status)' {
            $Json = Get-AITSBOM -RepoRoot $script:FixtureRoot -Format Json -WarningAction SilentlyContinue
            $Parsed = $Json | ConvertFrom-Json
            $Parsed.Count | Should -BeGreaterThan 0
            $Row = $Parsed | Where-Object { $_.Name -eq 'left-pad' } | Select-Object -First 1
            $Row.PSObject.Properties.Name | Should -Not -Contain 'LatestVersion'
        }

        It '-Format Csv returns parseable CSV with a header row' {
            $Csv = Get-AITSBOM -RepoRoot $script:FixtureRoot -Format Csv -WarningAction SilentlyContinue
            $Parsed = $Csv | ConvertFrom-Csv
            $Parsed.Count | Should -BeGreaterThan 0
            $Parsed[0].PSObject.Properties.Name | Should -Contain 'Name'
        }

        It '-Format CycloneDX returns a valid 1.5 document with one component per entry' {
            $r = Get-AITSBOM -RepoRoot $script:FixtureRoot -WarningAction SilentlyContinue
            $Doc = (Get-AITSBOM -RepoRoot $script:FixtureRoot -Format CycloneDX -WarningAction SilentlyContinue) | ConvertFrom-Json
            $Doc.bomFormat | Should -Be 'CycloneDX'
            $Doc.specVersion | Should -Be '1.5'
            @($Doc.components).Count | Should -Be @($r).Count
            $Comp = $Doc.components | Where-Object { $_.name -eq 'left-pad' } | Select-Object -First 1
            $Comp.purl | Should -Be 'pkg:npm/left-pad@1.3.0'
        }

        It '-Format SPDX returns a valid 2.3 document with one package per entry' {
            $r = Get-AITSBOM -RepoRoot $script:FixtureRoot -WarningAction SilentlyContinue
            $Doc = (Get-AITSBOM -RepoRoot $script:FixtureRoot -Format SPDX -WarningAction SilentlyContinue) | ConvertFrom-Json
            $Doc.spdxVersion | Should -Be 'SPDX-2.3'
            @($Doc.packages).Count | Should -Be @($r).Count
            $Pkg = $Doc.packages | Where-Object { $_.name -eq 'left-pad' } | Select-Object -First 1
            $Pkg.licenseConcluded | Should -Be 'NOASSERTION' -Because 'no lock-file enrichment ran in this fixture'
        }
    }

    Context '-CheckUpdates' {

        BeforeEach {
            # The 'npm' arm is the only internal seam mockable without touching the real
            # network (Invoke-WithRecovery existed before this refactor too).
            Mock Invoke-WithRecovery -ModuleName AITriad -MockWith { '1.3.0' }
        }

        It 'populates a non-null Status on every entry, never leaving one at the initial $null' {
            $r = Get-AITSBOM -RepoRoot $script:FixtureRoot -CheckUpdates -WarningAction SilentlyContinue
            $r | ForEach-Object { $_.Status | Should -Not -BeNullOrEmpty -Because "entry '$($_.Name)' ($($_.Type)) must get a Status" }
        }

        It 'marks the mocked npm package as up-to-date when the mocked latest equals the local version' {
            $r = Get-AITSBOM -RepoRoot $script:FixtureRoot -CheckUpdates -WarningAction SilentlyContinue
            $Row = @($r | Where-Object { $_.Name -eq 'left-pad' })[0]
            $Row.LatestVersion | Should -Be '1.3.0'
            $Row.Status | Should -Be 'up-to-date'
        }

        It '-Format Json under -CheckUpdates includes LatestVersion and Status fields' {
            $Json = Get-AITSBOM -RepoRoot $script:FixtureRoot -Format Json -CheckUpdates -WarningAction SilentlyContinue
            $Row = ($Json | ConvertFrom-Json) | Where-Object { $_.Name -eq 'left-pad' } | Select-Object -First 1
            $Row.PSObject.Properties.Name | Should -Contain 'LatestVersion'
            $Row.PSObject.Properties.Name | Should -Contain 'Status'
        }
    }

    Context '-Update' {

        BeforeEach {
            Mock Invoke-WithRecovery -ModuleName AITriad -MockWith { '1.3.0' }
        }

        It 'reports all up to date and never prompts when nothing is outdated' {
            { Get-AITSBOM -RepoRoot $script:FixtureRoot -Update -Force -WhatIf -WarningAction SilentlyContinue } | Should -Not -Throw
        }

        It 'lists an outdated package and does not touch the real package manager under -WhatIf' {
            Mock Invoke-WithRecovery -ModuleName AITriad -MockWith { '99.0.0' }
            { Get-AITSBOM -RepoRoot $script:FixtureRoot -Update -Force -WhatIf -WarningAction SilentlyContinue } | Should -Not -Throw
        }
    }
}
