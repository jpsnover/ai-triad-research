# Tag: taxonomy (t/1588 Phase A — crux linkage helper)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Covers Private/Get-CruxLinkCount — PS mirror of the TS
    loadCruxLinksFromAggregated in lib/debate/cruxLinkage.ts.
.DESCRIPTION
    Both sides read the same aggregated-cruxes.json to derive the
    crux_density signal used by the severeTestScheduler and now by
    Get-NodeTestingRecord -SortBy Deficit. Any drift between the two
    loaders would silently desync the importance ranking, so this
    suite locks the counting semantics — every linked_node_id on
    every crux entry contributes +1 to that nodeId's count.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    $script:workDir = Join-Path ([System.IO.Path]::GetTempPath()) "cruxlink-t1588-$(Get-Random)"
    $null = New-Item -ItemType Directory -Path $script:workDir -Force
    $script:cruxPath = Join-Path $script:workDir 'aggregated-cruxes.json'
}

AfterAll {
    if ($script:workDir -and (Test-Path $script:workDir)) {
        Remove-Item -Recurse -Force $script:workDir -ErrorAction SilentlyContinue
    }
}

Describe 'Get-CruxLinkCount (t/1588 Phase A)' -Tag 'taxonomy' {

    It 'Counts each linked_node_id occurrence across all crux entries' {
        InModuleScope AITriad -Parameters @{ Path = $script:cruxPath } {
            param($Path)
            @{ cruxes = @(
                @{ id='crux-1'; linked_node_ids = @('saf-beliefs-1','saf-beliefs-2') }
                @{ id='crux-2'; linked_node_ids = @('saf-beliefs-1','acc-desires-9') }
                @{ id='crux-3'; linked_node_ids = @('saf-beliefs-1') }
            )} | ConvertTo-Json -Depth 5 | Set-Content -Path $Path -Encoding utf8NoBOM

            $counts = Get-CruxLinkCount -Path $Path
            $counts['saf-beliefs-1'] | Should -Be 3 -Because 'appears on all 3 cruxes'
            $counts['saf-beliefs-2'] | Should -Be 1
            $counts['acc-desires-9'] | Should -Be 1
            @($counts.Keys).Count    | Should -Be 3
        }
    }

    It 'Returns empty hashtable when the file is missing' {
        InModuleScope AITriad {
            $counts = Get-CruxLinkCount -Path (Join-Path ([System.IO.Path]::GetTempPath()) "does-not-exist-$(Get-Random).json")
            @($counts.Keys).Count | Should -Be 0
        }
    }

    It 'Returns empty hashtable when cruxes key is absent (never throws)' {
        InModuleScope AITriad -Parameters @{ Path = $script:cruxPath } {
            param($Path)
            @{ metadata = @{ note = 'no cruxes yet' } } | ConvertTo-Json | Set-Content -Path $Path -Encoding utf8NoBOM
            { Get-CruxLinkCount -Path $Path } | Should -Not -Throw
            $counts = Get-CruxLinkCount -Path $Path
            @($counts.Keys).Count | Should -Be 0
        }
    }

    It 'Tolerates crux entries with no linked_node_ids' {
        InModuleScope AITriad -Parameters @{ Path = $script:cruxPath } {
            param($Path)
            @{ cruxes = @(
                @{ id='crux-1' }
                @{ id='crux-2'; linked_node_ids = @('acc-1') }
            )} | ConvertTo-Json -Depth 5 | Set-Content -Path $Path -Encoding utf8NoBOM
            $counts = Get-CruxLinkCount -Path $Path
            $counts['acc-1']       | Should -Be 1
            @($counts.Keys).Count  | Should -Be 1
        }
    }
}
