# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Measure-DebateCoverage {
    <#
    .SYNOPSIS
        Part of Measure-TaxonomyBaseline's ontology-coverage metric (t/3910
        decomposition; no behavior change): argument_map and bdi_layer coverage
        across debate records.
    .PARAMETER DebatesDir
        Directory of debate JSON files. A missing directory yields all-zero counts
        (no behavior change -- the original silently skipped the whole block too).
    .OUTPUTS
        [PSCustomObject] { TotalDebates; DebatesWithArgMap; TotalDisagreements;
        DisagreementsWithBdi }.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [string]$DebatesDir
    )

    Set-StrictMode -Version Latest

    $TotalDebates = 0; $DebatesWithArgMap = 0
    $TotalDisagreements = 0; $DisagreementsWithBdi = 0

    if (Test-Path $DebatesDir) {
        foreach ($DebFile in Get-ChildItem -Path $DebatesDir -Filter '*.json' -File -ErrorAction SilentlyContinue) {
            try {
                $Debate = Get-Content -Raw -Path $DebFile.FullName | ConvertFrom-Json
                $TotalDebates++

                if ($Debate.PSObject.Properties['argument_map'] -and $Debate.argument_map) {
                    $DebatesWithArgMap++
                }

                if ($Debate.PSObject.Properties['synthesis'] -and $Debate.synthesis.PSObject.Properties['disagreements']) {
                    foreach ($D in @($Debate.synthesis.disagreements)) {
                        $TotalDisagreements++
                        if ($D.PSObject.Properties['bdi_layer'] -and $D.bdi_layer) {
                            $DisagreementsWithBdi++
                        }
                    }
                }
            }
            catch { }
        }
    }

    return [PSCustomObject]@{
        TotalDebates         = $TotalDebates
        DebatesWithArgMap    = $DebatesWithArgMap
        TotalDisagreements   = $TotalDisagreements
        DisagreementsWithBdi = $DisagreementsWithBdi
    }
}
