# Tag: unit
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Test-NodeModulesCurrent — detect a node_modules install that no longer matches
    the committed pnpm lockfile, so Show-TaxonomyEditor -Dev reinstalls after a pull.
.DESCRIPTION
    Uses real temp directories: pnpm-lock.yaml at the root and pnpm's installed copy
    at node_modules/.pnpm/lock.yaml. Every Reason arm is exercised, including the
    CRLF-vs-LF case that must NOT read as a change.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue -ErrorAction Stop
}

Describe 'Test-NodeModulesCurrent' -Tag 'unit' {

    BeforeEach {
        $script:Root = Join-Path ([System.IO.Path]::GetTempPath()) "nmc-$([guid]::NewGuid().ToString('N').Substring(0,8))"
        $script:PnpmDir = Join-Path $script:Root (Join-Path 'node_modules' '.pnpm')
        New-Item -ItemType Directory -Path $script:Root -Force | Out-Null
        $script:Lock = "lockfileVersion: '9.0'`nimporters:`n  .:`n    dependencies: {}`n"
    }

    AfterEach {
        Remove-Item -Path $script:Root -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'reports current when the installed lockfile matches the committed one' {
        [System.IO.File]::WriteAllText((Join-Path $script:Root 'pnpm-lock.yaml'), $script:Lock)
        New-Item -ItemType Directory -Path $script:PnpmDir -Force | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $script:PnpmDir 'lock.yaml'), $script:Lock)

        InModuleScope AITriad -Parameters @{ Root = $script:Root } {
            param($Root)
            $r = Test-NodeModulesCurrent -RepoRoot $Root
            $r.Current | Should -BeTrue
            $r.Reason  | Should -Be 'current'
        }
    }

    It 'reports lockfile-changed when a pull changed pnpm-lock.yaml' {
        [System.IO.File]::WriteAllText((Join-Path $script:Root 'pnpm-lock.yaml'), $script:Lock + "  # bumped`n")
        New-Item -ItemType Directory -Path $script:PnpmDir -Force | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $script:PnpmDir 'lock.yaml'), $script:Lock)

        InModuleScope AITriad -Parameters @{ Root = $script:Root } {
            param($Root)
            $r = Test-NodeModulesCurrent -RepoRoot $Root
            $r.Current | Should -BeFalse
            $r.Reason  | Should -Be 'lockfile-changed'
        }
    }

    It 'reports not-installed when node_modules has no pnpm lockfile copy' {
        [System.IO.File]::WriteAllText((Join-Path $script:Root 'pnpm-lock.yaml'), $script:Lock)

        InModuleScope AITriad -Parameters @{ Root = $script:Root } {
            param($Root)
            $r = Test-NodeModulesCurrent -RepoRoot $Root
            $r.Current | Should -BeFalse
            $r.Reason  | Should -Be 'not-installed'
        }
    }

    It 'treats a CRLF checkout of an otherwise-identical lockfile as current' {
        [System.IO.File]::WriteAllText((Join-Path $script:Root 'pnpm-lock.yaml'), $script:Lock.Replace("`n", "`r`n"))
        New-Item -ItemType Directory -Path $script:PnpmDir -Force | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $script:PnpmDir 'lock.yaml'), $script:Lock)

        InModuleScope AITriad -Parameters @{ Root = $script:Root } {
            param($Root)
            (Test-NodeModulesCurrent -RepoRoot $Root).Reason | Should -Be 'current'
        }
    }

    It 'reports no-lockfile (current, cannot judge) when the root has no pnpm-lock.yaml' {
        InModuleScope AITriad -Parameters @{ Root = $script:Root } {
            param($Root)
            $r = Test-NodeModulesCurrent -RepoRoot $Root
            $r.Current | Should -BeTrue
            $r.Reason  | Should -Be 'no-lockfile'
        }
    }
}
