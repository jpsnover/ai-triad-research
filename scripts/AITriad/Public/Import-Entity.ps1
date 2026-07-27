# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Import-Entity {
    <#
    .SYNOPSIS
        Curation write path for entity records (ent-*) — machine-proposes / human-disposes
        (t/1804, mirrors Import-Organization). Batch-capped at ~20 proposals (design §4).
    .DESCRIPTION
        Upserts a batch of proposed/approved/deprecated entity records into entities.json,
        minting never-reused ent-NNN ids for new records via New-EntityId. Records are only
        ever added, updated, tombstoned (`merged_into`), or `deprecated` — NEVER hard-deleted.
        That is the invariant the monotonic id allocator depends on (design §3, TL t/1804#2 Q3).

        Person exception (owner decision, design §4/§9.3): a `person` record cannot be
        `approved` without a human-authored `description` — approving one with an empty
        description throws an ActionableError (no LLM ever drafts a person description).

        Approved records get one all-MiniLM-L6-v2 embedding (name + genus-differentia line)
        written to a SEPARATE entity_embeddings.json via the existing Get-TextEmbedding path
        (Shared Utility Rule). Only `approved` entities carry vectors (design §3).

        The Entity shape is the contract in lib/entities/types.ts — not restated here; a
        parity test guards drift (TL t/1804#2 Q1).
    .PARAMETER Proposal
        1-20 proposal records (hashtable or PSCustomObject). New records require `name`,
        `entity_type`, `dolce_category`; optional `description`, `aliases`, `source_refs`,
        `external_refs`, `discovered_by`, `confidence`, `status` (default 'proposed'), `id`
        (to update an existing record), `merged_into` (to tombstone/merge into a canonical id).
    .PARAMETER Path
        Override entities.json path (fixtures/tests). Defaults to Get-EntitiesFilePath.
    .PARAMETER EmbeddingsPath
        Override entity_embeddings.json path (fixtures/tests). Defaults to Get-EntityEmbeddingsFilePath.
    .PARAMETER SkipEmbedding
        Do not compute/write embeddings for approved records (tests / offline curation).
    .EXAMPLE
        Import-Entity -Proposal @(@{ name = 'GPT-4'; entity_type = 'artifact'; dolce_category = 'non-agentive-functional-artifact'; description = 'A model that ...' })
    .LINK
        Get-Entity
    .LINK
        Import-Organization
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory, Position = 0)]
        [ValidateCount(1, 20)]
        [object[]]$Proposal,

        [string]$Path,

        [string]$EmbeddingsPath,

        [switch]$SkipEmbedding
    )

    Set-StrictMode -Version Latest

    $entPath = if ($Path) { $Path } else { Get-EntitiesFilePath }
    $embPath = if ($EmbeddingsPath) { $EmbeddingsPath } else { Get-EntityEmbeddingsFilePath }

    $store = Get-EntitiesStore -Path $entPath -Force -InitIfMissing
    $existing = [System.Collections.Generic.List[object]]::new()
    if ($store.PSObject.Properties['entities']) {
        foreach ($e in @($store.entities)) { $existing.Add($e) }
    }

    # Embeddings store loaded lazily only if an approval needs a vector.
    $embStore = $null
    $embDirty = $false
    $now = (Get-Date).ToString('yyyy-MM-dd')

    # Small helpers over the working list (match/replace/append; never remove).
    $findIndex = {
        param($id)
        for ($i = 0; $i -lt $existing.Count; $i++) {
            if ($existing[$i].PSObject.Properties['id'] -and [string]$existing[$i].id -eq $id) { return $i }
        }
        return -1
    }
    $prop = {
        param($obj, $name, $default)
        if ($obj -is [hashtable]) { if ($obj.ContainsKey($name)) { return $obj[$name] } else { return $default } }
        if ($obj.PSObject.Properties[$name]) { return $obj.$name } else { return $default }
    }

    $results = [System.Collections.Generic.List[object]]::new()

    foreach ($p in $Proposal) {
        $propId      = [string](& $prop $p 'id' '')
        $name        = [string](& $prop $p 'name' '')
        $entityType  = [string](& $prop $p 'entity_type' '')
        $dolce       = [string](& $prop $p 'dolce_category' '')
        $description = [string](& $prop $p 'description' '')
        $status      = [string](& $prop $p 'status' 'proposed')
        $mergedInto  = [string](& $prop $p 'merged_into' '')

        $idx = if ($propId) { & $findIndex $propId } else { -1 }
        $isUpdate = ($idx -ge 0)

        # For updates, resolve the effective type against the existing record so the
        # person gate can't be dodged by omitting entity_type on an approval update.
        if ($isUpdate -and -not $entityType -and $existing[$idx].PSObject.Properties['entity_type']) {
            $entityType = [string]$existing[$idx].entity_type
        }
        if ($isUpdate -and -not $description -and $existing[$idx].PSObject.Properties['description']) {
            $description = [string]$existing[$idx].description
        }

        # Person-approval gate (design §4/§9.3): no approval without a human description.
        if ($entityType -eq 'person' -and $status -eq 'approved' -and [string]::IsNullOrWhiteSpace($description)) {
            throw (New-ActionableError -PassThru `
                -Goal 'Approve a person entity' `
                -Problem "Person entity '$(if ($propId) { $propId } else { $name })' cannot be approved without a human-authored description" `
                -Location 'Import-Entity' `
                -NextSteps @(
                    'Author a genus-differentia description ("A person who ...") for the record',
                    'The LLM never drafts person descriptions — a human writes every one (design §4)',
                    'Re-run Import-Entity with the description populated'
                ))
        }

        if ($isUpdate) {
            $rec = $existing[$idx]
            $newId = [string]$rec.id
        } else {
            if (-not $name -or -not $entityType -or -not $dolce) {
                throw (New-ActionableError -PassThru `
                    -Goal 'Create an entity record' `
                    -Problem 'A new proposal requires name, entity_type, and dolce_category' `
                    -Location 'Import-Entity' `
                    -NextSteps @('Add the missing field(s) to the proposal record'))
            }
            # Mint against the WORKING list so ids stay monotonic + collision-free within
            # this batch (each append feeds the next mint's max).
            $newId = @(New-EntityId -Store ([PSCustomObject]@{ entities = @($existing) }))[0]
            $rec = [PSCustomObject]@{
                id            = $newId
                name          = $name
                aliases       = @()
                entity_type   = $entityType
                dolce_category = $dolce
                description   = $description
                external_refs = @()
                source_refs   = @()
                status        = $status
                created_at    = $now
                last_modified = $now
            }
        }

        # Apply mutable fields (shape-matched to the Entity contract; optionals only when present).
        $rec.name          = if ($name) { $name } else { $rec.name }
        $rec.entity_type   = if ($entityType) { $entityType } else { $rec.entity_type }
        if ($dolce) { $rec.dolce_category = $dolce }
        $rec.description   = $description
        $rec.status        = $status
        $rec.last_modified = $now

        foreach ($fld in @(
            @{ k = 'aliases';       d = @() },
            @{ k = 'source_refs';   d = @() },
            @{ k = 'external_refs'; d = @() },
            @{ k = 'discovered_by'; d = $null },
            @{ k = 'confidence';    d = $null }
        )) {
            $v = & $prop $p $fld.k '__ABSENT__'
            if ($v -ne '__ABSENT__') {
                if ($rec.PSObject.Properties[$fld.k]) { $rec.$($fld.k) = $v }
                else { Add-Member -InputObject $rec -MemberType NoteProperty -Name $fld.k -Value $v }
            }
        }

        # Merge: set the tombstone pointer, then PATH-COMPRESS (design §7) — rewrite any
        # X.merged_into = thisId to the canonical target in the same pass so stored chains
        # never form. The defensive walk in Get-Entity remains as the safety net.
        if ($mergedInto) {
            if ($rec.PSObject.Properties['merged_into']) { $rec.merged_into = $mergedInto }
            else { Add-Member -InputObject $rec -MemberType NoteProperty -Name 'merged_into' -Value $mergedInto }
            foreach ($other in $existing) {
                if ($other.PSObject.Properties['merged_into'] -and $null -ne $other.merged_into -and [string]$other.merged_into -eq $newId) {
                    $other.merged_into = $mergedInto
                }
            }
        }

        if ($isUpdate) { $existing[$idx] = $rec } else { [void]$existing.Add($rec) }

        # Approved records carry exactly one vector (design §3). Proposed/deprecated do not.
        $embedded = $false
        if ($status -eq 'approved' -and -not $SkipEmbedding) {
            if ($null -eq $embStore) {
                $embStore = if (Test-Path $embPath) { Get-Content -Raw -Path $embPath -Encoding utf8 | ConvertFrom-Json } else { New-EmptyEntityEmbeddingsStore }
            }
            $text = if ($description) { "$name`n$description" } else { $name }
            $vecMap = Get-TextEmbedding -Texts @($text) -Ids @($newId)
            if ($vecMap -and $vecMap.ContainsKey($newId)) {
                if (-not $embStore.PSObject.Properties['vectors']) {
                    Add-Member -InputObject $embStore -MemberType NoteProperty -Name 'vectors' -Value ([PSCustomObject]@{})
                }
                if ($embStore.vectors.PSObject.Properties[$newId]) { $embStore.vectors.$newId = @($vecMap[$newId]) }
                else { Add-Member -InputObject $embStore.vectors -MemberType NoteProperty -Name $newId -Value (@($vecMap[$newId])) }
                $embDirty = $true
                $embedded = $true
            }
        }

        $results.Add([PSCustomObject]@{
            Id       = $newId
            Name     = $rec.name
            Status   = $status
            Action   = if ($isUpdate) { 'updated' } else { 'created' }
            Embedded = $embedded
        })
    }

    # Refresh envelope counters.
    if ($store.PSObject.Properties['entities']) { $store.entities = @($existing) }
    else { Add-Member -InputObject $store -MemberType NoteProperty -Name 'entities' -Value (@($existing)) }
    if ($store.PSObject.Properties['entity_count']) { $store.entity_count = $existing.Count }
    else { Add-Member -InputObject $store -MemberType NoteProperty -Name 'entity_count' -Value ($existing.Count) }
    if ($store.PSObject.Properties['last_modified']) { $store.last_modified = $now }
    else { Add-Member -InputObject $store -MemberType NoteProperty -Name 'last_modified' -Value $now }

    if (-not $PSCmdlet.ShouldProcess($entPath, "Upsert $($Proposal.Count) entity record(s)")) {
        return @($results)
    }

    Write-EntityStoreAtomic -Store $store -Path $entPath
    if ($embDirty) {
        if ($embStore.PSObject.Properties['last_modified']) { $embStore.last_modified = $now }
        Write-EntityStoreAtomic -Store $embStore -Path $embPath
    }
    Clear-EntitiesCache

    return @($results)
}
