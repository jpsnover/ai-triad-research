# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Post-processes AI-generated unmapped concepts by fuzzy-matching them against
# all taxonomy nodes (cross-POV). Concepts that match an existing node are
# converted to mapped key_points and removed from the unmapped list.

function Get-WordTokens {
    param([string]$Text)
    # Lowercase, strip punctuation, split on whitespace, drop stop-words
    $StopWords = [System.Collections.Generic.HashSet[string]]::new(
        [string[]]@('a','an','the','in','of','and','or','for','to','is','that','with','as','by','on','at','from','its','this','it'),
        [System.StringComparer]::OrdinalIgnoreCase
    )
    $Tokens = ($Text.ToLower() -replace '[^a-z0-9\s]', '' -split '\s+') | Where-Object { $_ -and -not $StopWords.Contains($_) }
    return [string[]]$Tokens
}

function Get-JaccardSimilarity {
    param([string[]]$A, [string[]]$B)
    if ($A.Count -eq 0 -or $B.Count -eq 0) { return 0.0 }
    $SetA = [System.Collections.Generic.HashSet[string]]::new([string[]]$A, [System.StringComparer]::OrdinalIgnoreCase)
    $SetB = [System.Collections.Generic.HashSet[string]]::new([string[]]$B, [System.StringComparer]::OrdinalIgnoreCase)
    $Intersection = [System.Collections.Generic.HashSet[string]]::new($SetA, [System.StringComparer]::OrdinalIgnoreCase)
    $Intersection.IntersectWith($SetB)
    $Union = [System.Collections.Generic.HashSet[string]]::new($SetA, [System.StringComparer]::OrdinalIgnoreCase)
    $Union.UnionWith($SetB)
    if ($Union.Count -eq 0) { return 0.0 }
    return [double]$Intersection.Count / [double]$Union.Count
}

function Resolve-UnmappedConcepts {
    <#
    .SYNOPSIS
        Fuzzy-matches unmapped concepts against all taxonomy nodes across all POVs.
    .DESCRIPTION
        For each unmapped concept, computes word-overlap (Jaccard) similarity of
        the suggested_label against every taxonomy node label. If the best match
        exceeds the threshold, the concept is resolved to that node.

        Returns a PSCustomObject with:
          - Resolved:  array of objects with concept + matched node info
          - Remaining: array of unmapped concepts that did not match
    .PARAMETER UnmappedConcepts
        Array of unmapped concept objects from a summary.
    .PARAMETER Threshold
        Minimum Jaccard similarity to consider a match (default 0.40).
    .PARAMETER TaxonomyData
        Optional taxonomy hashtable. If omitted, uses the module-scoped data.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$UnmappedConcepts,

        [double]$Threshold = 0.50,

        [hashtable]$TaxonomyData
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    if (-not $TaxonomyData) {
        $TaxonomyData = $script:TaxonomyData
    }

    if (-not $TaxonomyData -or $TaxonomyData.Count -eq 0) {
        Write-Warning "Resolve-UnmappedConcepts: no taxonomy data available — skipping resolution"
        return [PSCustomObject]@{ Resolved = @(); Remaining = $UnmappedConcepts }
    }

    # Build flat list of all nodes across all POVs
    $AllNodes = [System.Collections.Generic.List[PSObject]]::new()
    foreach ($PovKey in $TaxonomyData.Keys) {
        $Entry = $TaxonomyData[$PovKey]
        if ($Entry.nodes) { $Nodes = $Entry.nodes } else { $Nodes = @() }
        foreach ($Node in $Nodes) {
            if ($Node.PSObject.Properties['category']) { $NodeCat = $Node.category } else { $NodeCat = $null }
            $null = $AllNodes.Add([PSCustomObject]@{
                POV      = $PovKey
                Id       = $Node.id
                Label    = $Node.label
                Category = $NodeCat
                Tokens   = Get-WordTokens $Node.label
            })
        }
    }

    $Resolved  = [System.Collections.Generic.List[PSObject]]::new()
    $Remaining = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($Concept in $UnmappedConcepts) {
        $Props = $Concept.PSObject.Properties
        if ($Props['suggested_label']) { $ConceptLabel = $Concept.suggested_label } else { $ConceptLabel = '' }
        if (-not $ConceptLabel) {
            $null = $Remaining.Add($Concept)
            continue
        }

        $ConceptTokens = Get-WordTokens $ConceptLabel
        # Also tokenize the description for a secondary signal
        if ($Props['suggested_description']) { $DescTokens = Get-WordTokens $Concept.suggested_description } else { $DescTokens = @() }

        $BestScore = 0.0
        $BestNode  = $null

        foreach ($Node in $AllNodes) {
            # Primary: label-to-label Jaccard
            $LabelScore = Get-JaccardSimilarity $ConceptTokens $Node.Tokens

            # Secondary: concept-description vs node-label (weighted lower)
            if ($DescTokens.Count -gt 0) {
                $DescScore = (Get-JaccardSimilarity $DescTokens $Node.Tokens) * 0.3
            } else { $DescScore = 0.0 }

            $Combined = [Math]::Max($LabelScore, $LabelScore * 0.7 + $DescScore)

            if ($Combined -gt $BestScore) {
                $BestScore = $Combined
                $BestNode  = $Node
            }
        }

        if ($BestScore -ge $Threshold -and $BestNode) {
            $null = $Resolved.Add([PSCustomObject]@{
                ConceptLabel = $ConceptLabel
                MatchedNodeId    = $BestNode.Id
                MatchedNodeLabel = $BestNode.Label
                MatchedPOV       = $BestNode.POV
                MatchedCategory  = $BestNode.Category
                Score            = [Math]::Round($BestScore, 3)
                OriginalConcept  = $Concept
            })
        }
        else {
            $null = $Remaining.Add($Concept)
        }
    }

    return [PSCustomObject]@{
        Resolved  = @($Resolved)
        Remaining = @($Remaining)
    }
}
