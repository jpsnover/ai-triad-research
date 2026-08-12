# Tag: unit (t/2530)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    L2 regression (t/2530): New-SecureTempPath returns an unpredictable temp path
    (no fixed filename) so a local attacker cannot pre-create the path as a
    symlink to redirect a later write. Pure PS, keyless — always runs.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'New-SecureTempPath (t/2530 L2)' -Tag 'unit' {

    It 'returns a path under the temp directory with the given prefix and extension' {
        InModuleScope AITriad {
            $tempRoot = [System.IO.Path]::GetTempPath()
            $p = New-SecureTempPath -Prefix 'AITriad-Help' -Extension 'html'
            $p | Should -BeLike (Join-Path $tempRoot 'AITriad-Help-*')
            [System.IO.Path]::GetExtension($p) | Should -Be '.html'
        }
    }

    It 'never returns the old fixed filenames' {
        InModuleScope AITriad {
            (Split-Path -Leaf (New-SecureTempPath -Prefix 'AITriad-Help' -Extension 'html')) | Should -Not -Be 'AITriad-Help.html'
            (Split-Path -Leaf (New-SecureTempPath -Prefix 'AITriad-TaxonomyCompare' -Extension 'html')) | Should -Not -Be 'AITriad-TaxonomyCompare.html'
        }
    }

    It 'produces a different path on each call (unguessable random component)' {
        InModuleScope AITriad {
            $a = New-SecureTempPath -Prefix 'x' -Extension 'tmp'
            $b = New-SecureTempPath -Prefix 'x' -Extension 'tmp'
            $a | Should -Not -Be $b
        }
    }

    It 'tolerates an extension with a leading dot' {
        InModuleScope AITriad {
            [System.IO.Path]::GetExtension((New-SecureTempPath -Extension '.env')) | Should -Be '.env'
        }
    }
}
