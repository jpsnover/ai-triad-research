# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Measure-DescriptionQuality {
    <#
    .SYNOPSIS
        Metric 6 of Measure-TaxonomyBaseline (t/3910 decomposition; no behavior
        change): description length percentiles, stub/short counts, and the
        genus-differentia pattern match rate.
    .PARAMETER AllNodes
        Node id -> node lookup.
    .OUTPUTS
        [ordered hashtable] the descriptions report section.
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Specialized.OrderedDictionary])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$AllNodes
    )

    Set-StrictMode -Version Latest

    $DescLengths = @()
    $GenusPattern = 0
    $ShortDescs = 0
    $StubDescs = 0

    foreach ($Node in $AllNodes.Values) {
        $Desc = if ($Node.PSObject.Properties['description']) { $Node.description } else { '' }
        if (-not $Desc) { $StubDescs++; continue }
        $DescLengths += $Desc.Length
        if ($Desc.Length -lt 50) { $ShortDescs++ }
        if ($Desc -eq $Node.label) { $StubDescs++ }
        if ($Desc -match '^An?\s+(Belief|Desire|Intention)\s+within\s+(accelerationist|safetyist|skeptic)\s+discourse\s+that\s+' -or
            $Desc -match '^A\s+cross-cutting\s+concept\s+that\s+') {
            $GenusPattern++
        }
    }

    $SortedDesc = @($DescLengths | Sort-Object)   # @(): same empty->$null StrictMode trap as $SortedKP (t/3998)

    return [ordered]@{
        total_nodes               = $AllNodes.Count
        median_desc_length        = if ($SortedDesc.Count -gt 0) { $SortedDesc[[int]($SortedDesc.Count / 2)] } else { 0 }
        p10_desc_length           = if ($SortedDesc.Count -gt 9) { $SortedDesc[[int]($SortedDesc.Count * 0.1)] } else { 0 }
        p90_desc_length           = if ($SortedDesc.Count -gt 9) { $SortedDesc[[int]($SortedDesc.Count * 0.9)] } else { 0 }
        short_descriptions        = $ShortDescs
        stub_descriptions         = $StubDescs
        genus_differentia_pattern = $GenusPattern
        genus_differentia_pct     = [Math]::Round($GenusPattern / [Math]::Max(1, $AllNodes.Count) * 100, 1)
    }
}
