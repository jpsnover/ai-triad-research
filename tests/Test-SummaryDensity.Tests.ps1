# Tag: ingestion (t/1646)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression tests for the t/1646 false-positive density warning.
.DESCRIPTION
    Merge-ChunkSummaries returns an [ordered] hashtable whose pov_summaries →
    camp → key_points entries are NOT visible via $x.PSObject.Properties[...].
    The old Test-SummaryDensity read camp data through PSObject.Properties, which
    is blind to dictionary keys, so it counted 0 key_points for every camp even
    when the merged object held many — emitting spurious "N camp has 0
    key_points" / "total key_points: 0" warnings on a summary that was actually
    dense (ground truth for the trigger doc: acc=9, saf=6, skp=8 = 23 points).

    The fix routes BOTH the merge writer and the checker through the shared
    Get-SummaryProp accessor + $script:AITriadPovCamps constant, so the two can
    never disagree about the structure. These tests feed the checker the exact
    dictionary shape the writer emits and assert the warning does not fire.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-SummaryDensity dictionary-shape density accounting' -Tag 'ingestion' {

    It 'Does not warn when a dictionary-shaped merged object holds dense per-camp key_points' {
        InModuleScope AITriad {
            # Build the exact structure Merge-ChunkSummaries returns: an [ordered]
            # hashtable whose camps are [ordered] hashtables — keys invisible to
            # PSObject.Properties. Mirrors the t/1646 ground truth 9 / 6 / 8.
            function New-Points {
                param([int]$N, [string]$Prefix)
                $list = for ($i = 1; $i -le $N; $i++) {
                    [ordered]@{ point = "$Prefix point $i"; taxonomy_node_id = "$Prefix-$i" }
                }
                @($list)
            }

            $Merged = [ordered]@{
                pov_summaries = [ordered]@{
                    accelerationist = [ordered]@{ key_points = New-Points -N 9 -Prefix 'acc' }
                    safetyist       = [ordered]@{ key_points = New-Points -N 6 -Prefix 'saf' }
                    skeptic         = [ordered]@{ key_points = New-Points -N 8 -Prefix 'skp' }
                }
                factual_claims    = @()
                unmapped_concepts = @(
                    [ordered]@{ suggested_label = 'novel-concept-a' }
                    [ordered]@{ suggested_label = 'novel-concept-b' }
                )
            }

            $Floors = @{ KpMin = 3; UcMin = 1; TotalFloor = 6 }
            $Result = Test-SummaryDensity -SummaryObject $Merged -Floors $Floors

            $Result.Pass | Should -BeTrue -Because '23 key_points across camps is well above the total floor and every camp is non-empty'
            @($Result.Shortfalls).Count | Should -Be 0 -Because 'a dense dictionary-shaped summary must not trip any density shortfall (the t/1646 false positive)'
        }
    }

    It 'Still flags a genuinely sparse camp (no empty_cells) so the fix does not silence real signal' {
        InModuleScope AITriad {
            $Merged = [ordered]@{
                pov_summaries = [ordered]@{
                    accelerationist = [ordered]@{ key_points = @([ordered]@{ point = 'only one' }) }
                    safetyist       = [ordered]@{ key_points = @() }
                    skeptic         = [ordered]@{ key_points = @() }
                }
                factual_claims    = @()
                unmapped_concepts = @()
            }

            $Floors = @{ KpMin = 3; UcMin = 1; TotalFloor = 6 }
            $Result = Test-SummaryDensity -SummaryObject $Merged -Floors $Floors

            $Result.Pass | Should -BeFalse -Because 'two empty camps and a total of 1 key_point is genuinely below floor'
            @($Result.Shortfalls | Where-Object { $_ -like 'safetyist has 0 key_points*' }).Count |
                Should -Be 1 -Because 'a truly empty camp with no empty_cells declaration must still be reported'
        }
    }

    It 'Honors empty_cells declarations on a dictionary-shaped object (licensed emptiness)' {
        InModuleScope AITriad {
            $Categories = @('Desires', 'Beliefs', 'Intentions')
            $EmptyCells = foreach ($cat in $Categories) {
                [ordered]@{ camp = 'skeptic'; category = $cat }
            }

            $Merged = [ordered]@{
                pov_summaries = [ordered]@{
                    accelerationist = [ordered]@{ key_points = @(1..5 | ForEach-Object { [ordered]@{ point = "acc $_" } }) }
                    safetyist       = [ordered]@{ key_points = @(1..4 | ForEach-Object { [ordered]@{ point = "saf $_" } }) }
                    skeptic         = [ordered]@{ key_points = @() }
                }
                empty_cells       = @($EmptyCells)
                factual_claims    = @()
                unmapped_concepts = @([ordered]@{ suggested_label = 'x' })
            }

            $Floors = @{ KpMin = 3; UcMin = 1; TotalFloor = 6 }
            $Result = Test-SummaryDensity -SummaryObject $Merged -Floors $Floors

            @($Result.Shortfalls | Where-Object { $_ -like 'skeptic has 0 key_points*' }).Count |
                Should -Be 0 -Because 'the empty skeptic camp is fully declared in empty_cells, so its emptiness is licensed'
        }
    }
}
