# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-IntellectualLineage {
    <#
    .SYNOPSIS
        Queries intellectual lineage entries across taxonomy nodes.
    .DESCRIPTION
        Searches graph_attributes.intellectual_lineage on all taxonomy nodes
        and returns matching entries. Each entry links a taxonomy node to a
        philosophical movement, economic theory, scientific paradigm, or other
        intellectual tradition that informs that node's position.

        Supports filtering by name/label wildcard, category, and POV scope.
        Returns deduplicated results by default (unique by name).
    .PARAMETER Label
        One or more wildcard patterns matched against lineage entry names.
    .PARAMETER Category
        Filter to entries with this exact category (e.g., 'economic_theory',
        'philosophical_movement', 'scientific_paradigm', 'social_theory',
        'technology_movement').
    .PARAMETER POV
        Filter to a specific POV before scanning. Default: all POVs.
    .PARAMETER IncludeNodes
        Include the source taxonomy node ID and label in the output.
    .PARAMETER All
        Return all occurrences instead of deduplicating by name.
    .EXAMPLE
        Get-IntellectualLineage
        # All unique lineage entries across the taxonomy.
    .EXAMPLE
        Get-IntellectualLineage -Label '*Altruism*'
        # Entries matching 'Altruism' in name.
    .EXAMPLE
        Get-IntellectualLineage -Category economic_theory
        # All economic theory influences.
    .EXAMPLE
        Get-IntellectualLineage -POV skeptic -Label '*bias*'
        # Skeptic-scoped search for bias-related influences.
    .EXAMPLE
        Get-IntellectualLineage -Label '*commons*' -IncludeNodes
        # Shows which taxonomy nodes reference 'commons' traditions.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [Alias('Name')]
        [string[]]$Label,

        [ValidateSet('academic_discipline', 'cultural_movement', 'economic_theory',
                     'ethical_framework', 'legal_framework', 'philosophical_movement',
                     'political_philosophy', 'scientific_paradigm', 'social_theory',
                     'technology_movement', 'other')]
        [string]$Category,

        [ArgumentCompleter({ param($cmd, $param, $word) @('accelerationist','safetyist','skeptic','situations') | Where-Object { $_ -like "$word*" } })]
        [string]$POV = '*',

        [switch]$IncludeNodes,

        [switch]$All
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    Assert-TaxonomyCacheFresh

    $HasLabel    = ($null -ne $Label) -and ($Label.Length -gt 0)
    $HasCategory = -not [string]::IsNullOrWhiteSpace($Category)
    $Seen        = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $Results     = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($Key in $script:TaxonomyData.Keys) {
        if ($Key -notlike $POV.ToLower()) { continue }
        $Entry = $script:TaxonomyData[$Key]

        foreach ($Node in $Entry.nodes) {
            if (-not $Node.PSObject.Properties['graph_attributes']) { continue }
            $GA = $Node.graph_attributes
            if (-not $GA.PSObject.Properties['intellectual_lineage']) { continue }

            foreach ($Item in $GA.intellectual_lineage) {
                # Handle bare strings (unenriched entries)
                if ($Item -is [string]) {
                    $Name = $Item
                    $Desc = $null
                    $Url  = $null
                    $Cat  = $null
                } else {
                    $Name = if ($Item.PSObject.Properties['name']) { $Item.name } else { "$Item" }
                    $Desc = if ($Item.PSObject.Properties['description']) { $Item.description } else { $null }
                    $Url  = if ($Item.PSObject.Properties['url']) { $Item.url } else { $null }
                    $Cat  = if ($Item.PSObject.Properties['category']) { $Item.category } else { $null }
                }

                # Filters
                if ($HasLabel) {
                    $Match = $false
                    foreach ($Pat in $Label) {
                        if ($Name -like $Pat) { $Match = $true; break }
                    }
                    if (-not $Match) { continue }
                }
                if ($HasCategory -and $Cat -ne $Category) { continue }

                # Dedup by name unless -All
                if (-not $All -and -not $Seen.Add($Name)) { continue }

                $Obj = [PSCustomObject]@{
                    PSTypeName  = 'AITriad.IntellectualLineage'
                    Name        = $Name
                    Category    = $Cat
                    Description = $Desc
                    Url         = $Url
                }

                if ($IncludeNodes) {
                    $Obj | Add-Member -NotePropertyName NodeId    -NotePropertyValue $Node.id
                    $Obj | Add-Member -NotePropertyName NodeLabel -NotePropertyValue $Node.label
                    $Obj | Add-Member -NotePropertyName NodePOV   -NotePropertyValue $Key
                }

                $Results.Add($Obj)
            }
        }
    }

    if ($Results.Count -eq 0) {
        $Terms = @()
        if ($HasLabel)    { $Terms += ($Label | ForEach-Object { "Label='$_'" }) }
        if ($HasCategory) { $Terms += "Category='$Category'" }
        if ($Terms.Count -gt 0) {
            Write-Warning "No lineage entries matched: $($Terms -join ', ')"
        } else {
            Write-Warning 'No intellectual lineage data found in taxonomy.'
        }
        return
    }

    $Results | Sort-Object Name
}
