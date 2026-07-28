# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-EntityReport {
    <#
    .SYNOPSIS
        Entity ontology maintenance reports (t/1806 §7): near-duplicates,
        provenance orphans, dictionary-collision candidates, and merge-chain defects.
    .DESCRIPTION
        Four independent report sections over entities.json / entity_embeddings.json:

        near-duplicate: all-pairs cosine similarity over entity_embeddings.json
        vectors (approved entities only carry a vector — design §3), flagged at or
        above -NearDuplicateThreshold.

        provenance-orphan: entities with an empty (or absent) source_refs array.
        Labeled explicitly in the output — this is NOT the same thing as a
        mention-orphan (an entity nothing in the corpus currently references);
        that check is Phase 2.

        dictionary-candidate: entities whose normalized name or alias EXACTLY
        collides with a dictionary term (colloquial_term or a standardized term's
        canonical_form). Exact/alias match only — no cosine, unlike near-duplicate.

        merge-chain: walks every merge tombstone (entities with `merged_into` set)
        through Resolve-EntityMergedInto (the same walk Get-Entity uses) and
        surfaces defects: cycles, exceeded-depth chains (both THROW there — caught
        here and reported instead of propagating), and dangling merged_into
        pointers (a target id absent from the store — resolves to $null, not a
        throw).
    .PARAMETER Report
        Which section(s) to compute. Default 'all' (all four).
    .PARAMETER NearDuplicateThreshold
        Minimum cosine similarity to flag a pair as a near-duplicate. Default 0.60.
    .PARAMETER EntitiesPath
        Override entities.json path (fixtures/tests). Defaults to Get-EntitiesFilePath.
    .PARAMETER EmbeddingsPath
        Override entity_embeddings.json path (fixtures/tests). Defaults to
        Get-EntityEmbeddingsFilePath.
    .PARAMETER DictionaryRoot
        Override the dictionary/ directory (fixtures/tests). Defaults to
        Join-Path (Get-DataRoot) 'dictionary'.
    .EXAMPLE
        Get-EntityReport
    .EXAMPLE
        Get-EntityReport -Report near-duplicate -NearDuplicateThreshold 0.75
    .LINK
        Show-AITriadHelp
    .LINK
        Get-Entity
    .LINK
        Import-Entity
    .LINK
        Invoke-EntityExtraction
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter()]
        [ValidateSet('near-duplicate', 'provenance-orphan', 'dictionary-candidate', 'merge-chain', 'all')]
        [string]$Report = 'all',

        [Parameter()]
        [ValidateRange(0.0, 1.0)]
        [double]$NearDuplicateThreshold = 0.60,

        [Parameter()]
        [string]$EntitiesPath,

        [Parameter()]
        [string]$EmbeddingsPath,

        [Parameter()]
        [string]$DictionaryRoot
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $EntPath = if ($EntitiesPath) { $EntitiesPath } else { Get-EntitiesFilePath }
    $EmbPath = if ($EmbeddingsPath) { $EmbeddingsPath } else { Get-EntityEmbeddingsFilePath }
    $DictRoot = if ($DictionaryRoot) { $DictionaryRoot } else { Join-Path (Get-DataRoot) 'dictionary' }

    $Store = Get-EntitiesStore -Path $EntPath -InitIfMissing
    $Entities = if ($Store.PSObject.Properties['entities']) { @($Store.entities) } else { @() }
    $ById = @{}
    foreach ($e in $Entities) {
        if ($e.PSObject.Properties['id']) { $ById[[string]$e.id] = $e }
    }

    $Normalize = { param($s) (([string]$s).Trim().ToLowerInvariant() -replace '\s+', ' ') }
    $WantAll = ($Report -eq 'all')

    $Result = [PSCustomObject]@{
        NearDuplicate       = $null
        ProvenanceOrphan    = $null
        DictionaryCandidate = $null
        MergeChainDefects   = $null
    }

    # ── near-duplicate ──────────────────────────────────────────────────────────────
    if ($WantAll -or $Report -eq 'near-duplicate') {
        $Vectors = @{}
        if (Test-Path $EmbPath) {
            $EmbStore = Get-Content -Raw -Path $EmbPath -Encoding utf8 | ConvertFrom-Json
            if ($EmbStore.PSObject.Properties['vectors']) {
                foreach ($prop in $EmbStore.vectors.PSObject.Properties) {
                    $Vectors[$prop.Name] = [double[]]@($prop.Value)
                }
            }
        }
        $Ids = @($Vectors.Keys | Sort-Object)
        $Pairs = [System.Collections.Generic.List[PSObject]]::new()
        for ($i = 0; $i -lt $Ids.Count; $i++) {
            for ($j = $i + 1; $j -lt $Ids.Count; $j++) {
                $sim = Get-CosineSimilarity -A $Vectors[$Ids[$i]] -B $Vectors[$Ids[$j]]
                if ($sim -ge $NearDuplicateThreshold) {
                    $nameA = if ($ById.ContainsKey($Ids[$i])) { [string]$ById[$Ids[$i]].name } else { $Ids[$i] }
                    $nameB = if ($ById.ContainsKey($Ids[$j])) { [string]$ById[$Ids[$j]].name } else { $Ids[$j] }
                    $Pairs.Add([PSCustomObject]@{
                        EntityIdA  = $Ids[$i]
                        NameA      = $nameA
                        EntityIdB  = $Ids[$j]
                        NameB      = $nameB
                        Similarity = [math]::Round($sim, 4)
                    })
                }
            }
        }
        $Result.NearDuplicate = [PSCustomObject]@{
            Threshold = $NearDuplicateThreshold
            Pairs     = @($Pairs | Sort-Object -Property Similarity -Descending)
        }
    }

    # ── provenance-orphan ────────────────────────────────────────────────────────────
    if ($WantAll -or $Report -eq 'provenance-orphan') {
        $Orphans = [System.Collections.Generic.List[PSObject]]::new()
        foreach ($e in $Entities) {
            $refs = if ($e.PSObject.Properties['source_refs']) { @($e.source_refs) } else { @() }
            if (@($refs | Where-Object { $_ }).Count -eq 0) {
                $Orphans.Add([PSCustomObject]@{
                    Id     = [string]$e.id
                    Name   = if ($e.PSObject.Properties['name']) { [string]$e.name } else { '' }
                    Status = if ($e.PSObject.Properties['status']) { [string]$e.status } else { '' }
                })
            }
        }
        $Result.ProvenanceOrphan = [PSCustomObject]@{
            Label   = 'provenance-orphan (empty source_refs) — NOT mention-orphan; true mention-orphan lands Phase 2.'
            Entities = @($Orphans)
        }
    }

    # ── dictionary-candidate ─────────────────────────────────────────────────────────
    if ($WantAll -or $Report -eq 'dictionary-candidate') {
        $DictIndex = @{}   # normalized term -> PSCustomObject{ Term; Kind }
        foreach ($SubDir in @('standardized', 'colloquial')) {
            $D = Join-Path $DictRoot $SubDir
            if (-not (Test-Path $D)) { continue }
            foreach ($F in Get-ChildItem -Path $D -Filter '*.json' -ErrorAction SilentlyContinue) {
                try {
                    $Term = Get-Content -Raw -Path $F.FullName | ConvertFrom-Json
                    if ($SubDir -eq 'standardized' -and $Term.PSObject.Properties['canonical_form'] -and $Term.canonical_form) {
                        $n = & $Normalize $Term.canonical_form
                        if (-not $DictIndex.ContainsKey($n)) {
                            $DictIndex[$n] = [PSCustomObject]@{ Term = [string]$Term.canonical_form; Kind = 'standardized' }
                        }
                    } elseif ($SubDir -eq 'colloquial' -and $Term.PSObject.Properties['colloquial_term'] -and $Term.colloquial_term) {
                        $n = & $Normalize $Term.colloquial_term
                        if (-not $DictIndex.ContainsKey($n)) {
                            $DictIndex[$n] = [PSCustomObject]@{ Term = [string]$Term.colloquial_term; Kind = 'colloquial' }
                        }
                    }
                } catch { Write-Verbose "Get-EntityReport: failed to parse $($F.Name) — $($_.Exception.Message)" }
            }
        }

        $Candidates = [System.Collections.Generic.List[PSObject]]::new()
        foreach ($e in $Entities) {
            $name = if ($e.PSObject.Properties['name']) { [string]$e.name } else { '' }
            $aliases = if ($e.PSObject.Properties['aliases']) { @($e.aliases) } else { @() }
            $checkTerms = @($name) + @($aliases)
            foreach ($t in $checkTerms) {
                $n = & $Normalize $t
                if ($DictIndex.ContainsKey($n)) {
                    $Candidates.Add([PSCustomObject]@{
                        Id           = [string]$e.id
                        Name         = $name
                        MatchedTerm  = $DictIndex[$n].Term
                        MatchedKind  = $DictIndex[$n].Kind
                    })
                    break
                }
            }
        }
        $Result.DictionaryCandidate = @($Candidates)
    }

    # ── merge-chain defects ──────────────────────────────────────────────────────────
    if ($WantAll -or $Report -eq 'merge-chain') {
        $Defects = [System.Collections.Generic.List[PSObject]]::new()
        foreach ($e in $Entities) {
            if (-not $e.PSObject.Properties['merged_into'] -or [string]::IsNullOrWhiteSpace([string]$e.merged_into)) { continue }
            $startId = [string]$e.id
            try {
                $canonical = Resolve-EntityMergedInto -StartId $startId -ById $ById
                if ($null -eq $canonical) {
                    $Defects.Add([PSCustomObject]@{
                        Id         = $startId
                        DefectType = 'dangling'
                        Target     = [string]$e.merged_into
                        Message    = "merged_into target '$($e.merged_into)' is not present in the store"
                    })
                }
            } catch {
                $msg = $_.Exception.Message
                $type = if ($msg -match 'cycle') { 'cycle' } elseif ($msg -match 'depth cap') { 'depth-exceeded' } else { 'unknown' }
                $Defects.Add([PSCustomObject]@{
                    Id         = $startId
                    DefectType = $type
                    Target     = [string]$e.merged_into
                    Message    = $msg
                })
            }
        }
        $Result.MergeChainDefects = @($Defects)
    }

    return $Result
}
