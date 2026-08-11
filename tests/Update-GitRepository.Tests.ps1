# Tag: unit (t/2478)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Update-GitRepository, the launch-path repo sync used by
    Show-TaxonomyEditor (t/2478).
.DESCRIPTION
    Exercises the helper against real temporary git repositories (bare origin +
    clones) rather than mocks, because the contract under test is git's actual
    fast-forward semantics: applies new origin commits, no-ops when current,
    and never throws when the directory is not a repo or history has diverged —
    launch must always proceed.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue -ErrorAction Stop
}

Describe 'Update-GitRepository' -Tag 'unit' {

    BeforeEach {
        $script:Root = Join-Path ([System.IO.Path]::GetTempPath()) "ugr-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
        New-Item -ItemType Directory -Path $script:Root -Force | Out-Null

        # Bare origin + a seed clone that pushes the initial commit.
        $script:Bare = Join-Path $script:Root 'origin.git'
        git init --bare --initial-branch=main $script:Bare 2>&1 | Out-Null

        $script:Seed = Join-Path $script:Root 'seed'
        git clone $script:Bare $script:Seed 2>&1 | Out-Null
        Push-Location $script:Seed
        git config user.email 'test@test.local'
        git config user.name 'test'
        Set-Content -Path 'file.txt' -Value 'v1'
        git add file.txt 2>&1 | Out-Null
        git commit -m 'v1' 2>&1 | Out-Null
        git push origin HEAD:main 2>&1 | Out-Null
        Pop-Location

        # The clone under test.
        $script:Local = Join-Path $script:Root 'local'
        git clone $script:Bare $script:Local 2>&1 | Out-Null
        Push-Location $script:Local
        git config user.email 'test@test.local'
        git config user.name 'test'
        Pop-Location
    }

    AfterEach {
        if (Test-Path $script:Root) {
            Remove-Item $script:Root -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'fast-forwards the local clone when origin has new commits' {
        Push-Location $script:Seed
        Set-Content -Path 'file.txt' -Value 'v2'
        git commit -am 'v2' 2>&1 | Out-Null
        git push origin HEAD:main 2>&1 | Out-Null
        Pop-Location

        $Result = InModuleScope AITriad -Parameters @{ P = $script:Local } {
            param($P)
            Update-GitRepository -Path $P -Label 'test repository'
        }

        $Result | Should -BeTrue
        Get-Content (Join-Path $script:Local 'file.txt') | Should -Be 'v2'
    }

    It 'returns $true when already up to date' {
        $Result = InModuleScope AITriad -Parameters @{ P = $script:Local } {
            param($P)
            Update-GitRepository -Path $P -Label 'test repository'
        }
        $Result | Should -BeTrue
    }

    It 'returns $false and does not throw for a directory that is not a git repo' {
        $Plain = Join-Path $script:Root 'plain'
        New-Item -ItemType Directory -Path $Plain -Force | Out-Null

        $Result = InModuleScope AITriad -Parameters @{ P = $Plain } {
            param($P)
            Update-GitRepository -Path $P -Label 'test repository'
        }
        $Result | Should -BeFalse
    }

    It 'returns $false and does not throw when local history has diverged (no fast-forward)' {
        # Local-only commit...
        Push-Location $script:Local
        Set-Content -Path 'file.txt' -Value 'local-change'
        git commit -am 'local divergence' 2>&1 | Out-Null
        Pop-Location
        # ...while origin advances separately.
        Push-Location $script:Seed
        Set-Content -Path 'file.txt' -Value 'remote-change'
        git commit -am 'remote divergence' 2>&1 | Out-Null
        git push origin HEAD:main 2>&1 | Out-Null
        Pop-Location

        $Result = InModuleScope AITriad -Parameters @{ P = $script:Local } {
            param($P)
            Update-GitRepository -Path $P -Label 'test repository'
        }

        $Result | Should -BeFalse
        # Local work is untouched — the helper must never discard changes.
        Get-Content (Join-Path $script:Local 'file.txt') | Should -Be 'local-change'
    }
}
