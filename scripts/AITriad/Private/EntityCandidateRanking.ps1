# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Advisory existing-entity candidates for Invoke-EntityExtraction (t/4075; TL ruling p/360#571,
# SO e/280#2, TL e/280#3). Name-only cosine cannot tell a duplicate from a distinct sibling
# (Claude 3.5 Sonnet vs 3.7 Sonnet scores 0.987), so a match is NEVER a link: each new proposal is
# minted, and its nearest existing entities are listed for a human to confirm through the
# entity-merge path (Import-Entity `merged_into`). Pure functions only; no IO.

function Split-EntityNameVersionToken {
    <#
    .SYNOPSIS
        Splits a name into its version tokens and the rest, both lowercased, in order.
    .DESCRIPTION
        A version token is a number or dotted number with an optional v/V prefix and an optional
        single trailing letter (4, 3.5, 4.1, v2, 4o, 70b), or a Roman numeral up to XXXIX
        (VI, VII). Everything else is a rest token. Separators are anything outside [a-z0-9.].
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param([AllowEmptyString()][string]$Name)
    $versions = [System.Collections.Generic.List[string]]::new()
    $rest = [System.Collections.Generic.List[string]]::new()
    foreach ($raw in ($Name.ToLowerInvariant() -split '[^a-z0-9.]+')) {
        $tok = $raw.Trim('.')
        if ($tok -eq '') { continue }
        if ($tok -match '^v?\d+(\.\d+)*[a-z]?$' -or $tok -match '^x{0,3}(ix|iv|v?i{0,3})$') { $versions.Add($tok) }
        else { $rest.Add($tok) }
    }
    @{ Version = @($versions); Rest = @($rest) }
}

function Test-EntityVersionSibling {
    <#
    .SYNOPSIS
        True when two names differ ONLY by version tokens (Claude 3.5 Sonnet vs Claude 3.7 Sonnet,
        GPT-4 vs GPT-5, Article 3 vs Article 4, Title VI vs Title VII).
    .DESCRIPTION
        False means only "no version difference detected" - NOT "safe to link". Tier and variant
        siblings (Claude Sonnet 4 vs Claude Opus 4, gpt-4o vs gpt-4o-mini) differ in their non-version
        words and come back false (SO e/280#2 condition 1).
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param([AllowEmptyString()][string]$A, [AllowEmptyString()][string]$B)
    $sa = Split-EntityNameVersionToken -Name $A
    $sb = Split-EntityNameVersionToken -Name $B
    if (@($sa.Rest).Count -eq 0) { return $false }
    if ((@($sa.Rest) -join ' ') -cne (@($sb.Rest) -join ' ')) { return $false }
    return ((@($sa.Version) -join ' ') -cne (@($sb.Version) -join ' '))
}

function Get-EntityCandidateScoreSet {
    <#
    .SYNOPSIS
        Every existing entity whose name vector scores at or above the floor against the probe,
        sorted by similarity (descending) then entity id (ordinal), so the order is deterministic.
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param([double[]]$Probe, [hashtable]$Vectors, [hashtable]$NameById, [string]$ProposalName, [double]$Floor)
    $scored = foreach ($id in $Vectors.Keys) {
        $sim = Get-CosineSimilarity -A $Probe -B $Vectors[$id]
        if ($sim -lt $Floor) { continue }
        $name = if ($NameById.ContainsKey($id)) { [string]$NameById[$id] } else { '' }
        [PSCustomObject]@{
            EntityId       = [string]$id
            EntityName     = $name
            Similarity     = [math]::Round($sim, 4)
            VersionSibling = (Test-EntityVersionSibling -A $ProposalName -B $name)
        }
    }
    @($scored | Sort-Object -Property @{ Expression = 'Similarity'; Descending = $true }, @{ Expression = { $_.EntityId }; Descending = $false } -CaseSensitive)
}

function Select-EntityCandidateRanking {
    <#
    .SYNOPSIS
        Up to $K candidates that are NOT version siblings, plus every version sibling above the floor
        (flagged), in similarity order, each with a 1-based rank (SO e/280#2 condition 2).
    .DESCRIPTION
        Siblings are listed but never consume the K slots, so a family of high-scoring versions
        (Claude 3 / 3.5 / 3.7) cannot push a true duplicate out of the list the reviewer sees.
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param([object[]]$Scored, [int]$K = 3)
    $nonSibling = 0
    $rank = 0
    $out = foreach ($c in @($Scored)) {
        if (-not $c.VersionSibling) {
            if ($nonSibling -ge $K) { continue }
            $nonSibling++
        }
        $rank++
        $c | Add-Member -NotePropertyName Rank -NotePropertyValue $rank -PassThru
    }
    @($out)
}

function ConvertTo-EntityExtractionCandidateRow {
    <#
    .SYNOPSIS
        One log node's existing_entity_candidates[] as review rows for Get-EntityExtractionCandidates.
        A node without the field (schema < 1.3.0) yields nothing.
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param($Node)
    if ($null -eq $Node -or -not $Node.PSObject.Properties['existing_entity_candidates']) { return }
    $get = { param($o, [string]$n) if ($o.PSObject.Properties[$n]) { $o.$n } else { $null } }
    $nodeId = [string](& $get $Node 'node_id')
    $model = & $get $Node 'embedding_model'
    $at = & $get $Node 'processed_at'
    foreach ($c in @($Node.existing_entity_candidates)) {
        if ($null -eq $c) { continue }
        [PSCustomObject]@{
            PSTypeName     = 'AITriad.EntityExtractionCandidate'
            NodeId         = $nodeId
            CandidateId    = [string](& $get $c 'candidate_id')
            ProposalName   = [string](& $get $c 'proposal_name')
            EntityId       = [string](& $get $c 'entity_id')
            EntityName     = [string](& $get $c 'entity_name')
            Similarity     = [double](& $get $c 'similarity')
            Rank           = [int](& $get $c 'rank')
            VersionSibling = [bool](& $get $c 'version_sibling')
            EmbeddingModel = $model
            ProcessedAt    = $at
        }
    }
}
