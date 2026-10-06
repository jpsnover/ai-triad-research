# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-NodeCitationMetrics {
    <#
    .SYNOPSIS
        Flattens $NodeIndex to AllNodes and derives OrphanNodes/MostCited/LeastCited (t/3910
        extraction from Get-TaxonomyHealthData). Situations nodes are excluded from
        MostCited/LeastCited (they are not POV-ranked).
    .OUTPUTS
        [pscustomobject] { AllNodes; OrphanNodes; MostCited; LeastCited } -- all arrays.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)][hashtable]$NodeIndex
    )

    Set-StrictMode -Version Latest

    $AllNodes = @($NodeIndex.GetEnumerator() | ForEach-Object {
        [PSCustomObject]@{
            Id        = $_.Key
            POV       = $_.Value.POV
            Category  = $_.Value.Category
            Label     = $_.Value.Label
            Citations = $_.Value.Citations
            DocIds    = $_.Value.DocIds.ToArray()
        }
    })

    $OrphanNodes = @($AllNodes | Where-Object { $_.Citations -eq 0 })
    $MostCited   = @($AllNodes | Where-Object { $_.POV -ne 'situations' } |
                      Sort-Object Citations -Descending | Select-Object -First 10)
    $LeastCited  = @($AllNodes | Where-Object { $_.POV -ne 'situations' -and $_.Citations -gt 0 } |
                      Sort-Object Citations | Select-Object -First 10)

    return [PSCustomObject]@{
        AllNodes    = $AllNodes
        OrphanNodes = $OrphanNodes
        MostCited   = $MostCited
        LeastCited  = $LeastCited
    }
}
