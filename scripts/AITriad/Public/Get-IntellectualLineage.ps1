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

        When lineage_categories.json is available, entries are enriched with
        Level 1 (broad) and Level 2 (specific) category classifications.

        Supports filtering by name/label wildcard, category, subcategory,
        and POV scope. Returns deduplicated results by default (unique by name).
    .PARAMETER Label
        One or more wildcard patterns matched against lineage entry names.
    .PARAMETER Category
        Filter by Level 1 category ID (e.g., 'ai-ml', 'economics', 'ethics-moral').
        Also accepts legacy per-node categories (e.g., 'economic_theory').
    .PARAMETER Subcategory
        Filter by Level 2 subcategory ID (e.g., 'ai-safety-alignment',
        'labor-political-economy').
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
        Get-IntellectualLineage -Category economics
        # All entries in the Economics & Political Economy L1 category.
    .EXAMPLE
        Get-IntellectualLineage -Subcategory ai-safety-alignment
        # All entries in the AI Safety & Alignment L2 subcategory.
    .EXAMPLE
        Get-IntellectualLineage -POV skeptic -Label '*bias*'
        # Skeptic-scoped search for bias-related influences.
    .EXAMPLE
        Get-IntellectualLineage -Label '*commons*' -IncludeNodes
        # Shows which taxonomy nodes reference 'commons' traditions.
    .LINK
        Show-AITriadHelp
    .LINK
        Get-PovLineage
    .LINK
        Repair-PovLineage
    #>
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [Alias('Name')]
        [string[]]$Label,

        [ArgumentCompleter({
            param($cmd, $param, $word)
            # L1 category IDs + legacy per-node categories
            @('ai-ml', 'techno-movements', 'ethics-moral', 'political-legal',
              'economics', 'social-behavioral', 'sts', 'formal-math',
              'risk-security', 'philosophy-epistemology', 'uncategorized',
              'academic_discipline', 'cultural_movement', 'economic_theory',
              'ethical_framework', 'legal_framework', 'philosophical_movement',
              'political_philosophy', 'scientific_paradigm', 'social_theory',
              'technology_movement', 'other') | Where-Object { $_ -like "$word*" }
        })]
        [string]$Category,

        [ArgumentCompleter({
            param($cmd, $param, $word)
            @('ai-safety-alignment', 'technology-society', 'labor-political-economy',
              'regulation-institutional-economics', 'legal-theory-applied-ethics',
              'democratic-governance', 'critical-social-theory', 'science-epistemology',
              'cognitive-behavioral-science', 'information-theory-cybernetics',
              'existential-risk-futures', 'game-decision-theory', 'digital-rights-governance',
              'tech-movements-open-source', 'philosophy-of-mind', 'consciousness-transhumanism',
              'environmental-sustainability', 'systems-complexity', 'surveillance-security',
              'political-economy-development', 'economic-inequality', 'neuroethics-bioethics',
              'media-communication', 'organizational-theory', 'military-defense',
              'international-relations', 'innovation-entrepreneurship', 'education-learning',
              'data-science-statistics', 'rights-justice', 'behavioral-economics',
              'social-epistemology', 'public-health', 'theology-religion',
              'art-design-creativity', 'feminist-gender-theory', 'postcolonial-theory',
              'metaphysics-ontology', 'disability-studies', 'uncategorized'
            ) | Where-Object { $_ -like "$word*" }
        })]
        [string]$Subcategory,

        [ArgumentCompleter({ param($cmd, $param, $word) @('accelerationist','safetyist','skeptic','situations') | Where-Object { $_ -like "$word*" } })]
        [string]$POV = '*',

        [switch]$IncludeNodes,

        [switch]$All
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    Assert-TaxonomyCacheFresh

    # ── Load lineage_categories.json for L1/L2 mapping ───────────────────
    $L1Lookup    = @{}  # L1 id → label
    $L2Lookup    = @{}  # L2 id → { label, l1_parent }
    $NameMapping = $null  # name → { l1, l2 }
    $HasL2Data   = $false

    $CatFile = Get-TaxonomyDir 'lineage_categories.json'
    if (Test-Path $CatFile) {
        try {
            $CatData = Get-Content -Raw -Path $CatFile | ConvertFrom-Json -AsHashtable
            if ($CatData.ContainsKey('categories')) {
                foreach ($c in $CatData['categories']) {
                    $L1Lookup[$c['id']] = $c['label']
                }
            }
            if ($CatData.ContainsKey('level2_categories')) {
                $HasL2Data = $true
                foreach ($c in $CatData['level2_categories']) {
                    $L2Lookup[$c['id']] = @{ label = $c['label']; l1_parent = $c['l1_parent'] }
                }
            }
            if ($CatData.ContainsKey('mapping')) {
                $NameMapping = $CatData['mapping']
            }
        } catch {
            Write-Verbose "Could not load lineage_categories.json: $_"
        }
    }

    $HasLabel    = ($null -ne $Label) -and ($Label.Length -gt 0)
    $HasCategory = -not [string]::IsNullOrWhiteSpace($Category)
    $HasSubcat   = -not [string]::IsNullOrWhiteSpace($Subcategory)
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
                    $EntryName = $Item
                    $Desc = $null
                    $Url  = $null
                    $NodeCat = $null
                } else {
                    $EntryName = if ($Item.PSObject.Properties['name']) { $Item.name } else { "$Item" }
                    $Desc = if ($Item.PSObject.Properties['description']) { $Item.description } else { $null }
                    $Url  = if ($Item.PSObject.Properties['url']) { $Item.url } else { $null }
                    $NodeCat = if ($Item.PSObject.Properties['category']) { $Item.category } else { $null }
                }

                # Resolve L1/L2 from mapping
                $L1Id = $null; $L1Label = $null
                $L2Id = $null; $L2Label = $null
                if ($null -ne $NameMapping -and $NameMapping.ContainsKey($EntryName)) {
                    $Map = $NameMapping[$EntryName]
                    if ($Map -is [hashtable] -or ($null -ne $Map -and $Map.PSObject.Properties['l1'])) {
                        $L1Id = if ($Map -is [hashtable]) { $Map['l1'] } else { $Map.l1 }
                        $L2Id = if ($Map -is [hashtable]) { $Map['l2'] } else { $Map.l2 }
                    } elseif ($Map -is [string]) {
                        # Legacy flat string mapping
                        $L1Id = $Map
                    }
                    if ($L1Id -and $L1Lookup.ContainsKey($L1Id)) { $L1Label = $L1Lookup[$L1Id] }
                    if ($L2Id -and $L2Lookup.ContainsKey($L2Id)) { $L2Label = $L2Lookup[$L2Id].label }
                }

                # Label filter
                if ($HasLabel) {
                    $Match = $false
                    foreach ($Pat in $Label) {
                        if ($EntryName -like $Pat) { $Match = $true; break }
                    }
                    if (-not $Match) { continue }
                }

                # Category filter — matches L1 id OR legacy per-node category
                if ($HasCategory -and $L1Id -ne $Category -and $NodeCat -ne $Category) { continue }

                # Subcategory filter — matches L2 id
                if ($HasSubcat -and $L2Id -ne $Subcategory) { continue }

                # Dedup by name unless -All
                if (-not $All -and -not $Seen.Add($EntryName)) { continue }

                $Obj = [PSCustomObject]@{
                    PSTypeName  = 'AITriad.IntellectualLineage'
                    Name        = $EntryName
                    L1Category  = if ($L1Label) { $L1Label } else { $NodeCat }
                    L2Category  = $L2Label
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
        if ($HasSubcat)   { $Terms += "Subcategory='$Subcategory'" }
        if ($Terms.Count -gt 0) {
            Write-Warning "No lineage entries matched: $($Terms -join ', ')"
        } else {
            Write-Warning 'No intellectual lineage data found in taxonomy.'
        }
        return
    }

    $Results | Sort-Object Name
}
