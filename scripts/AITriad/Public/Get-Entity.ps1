# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-Entity {
    <#
    .SYNOPSIS
        Resolve an entity record (ent-*) from entities.json, following merge tombstones
        to the canonical record (t/1804, design §7).
    .DESCRIPTION
        Reads the entity store and returns the record for an `ent-*` id. If the requested
        record is a merge tombstone (`merged_into` set), the walk follows the pointer chain
        to the canonical record and stamps `redirected_from` with the requested id — so a
        caller can update its own selection rather than showing a record it did not ask for.

        The walk mirrors the server resolveMergedInto (taxonomy-editor/src/server/routes/
        entity.ts, t/1786): a cycle-detection set and a shared depth cap. A cycle or an
        exceeded cap is a DATA DEFECT and throws (not a silent 404); a genuinely absent id
        returns nothing.

        ent-* ONLY (TL t/1804#2 Q2). Cross-kind resolution (node / situation / policy /
        organization / term) is the server's unified getEntity resolver, not this per-store
        cmdlet — pass an org-*/pol-* id and it is rejected.
    .PARAMETER Id
        The entity id to resolve (must match ^ent-\d+$).
    .PARAMETER Path
        Override entities.json path (fixtures/tests). Defaults to Get-EntitiesFilePath.
    .EXAMPLE
        Get-Entity -Id ent-001
    .EXAMPLE
        'ent-002' | Get-Entity   # follows merged_into to the canonical record
    .LINK
        Import-Entity
    .LINK
        Get-Organization
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory, Position = 0, ValueFromPipeline, ValueFromPipelineByPropertyName)]
        [ValidatePattern('^ent-\d+$')]
        [string]$Id,

        [string]$Path
    )

    begin {
        Set-StrictMode -Version Latest
        $entPath = if ($Path) { $Path } else { Get-EntitiesFilePath }
        $store = Get-EntitiesStore -Path $entPath

        # id -> raw record map for the whole store (feeds the merge walk).
        $byId = @{}
        if ($store.PSObject.Properties['entities']) {
            foreach ($e in @($store.entities)) {
                if ($e.PSObject.Properties['id']) { $byId[[string]$e.id] = $e }
            }
        }
    }

    process {
        if (-not $byId.ContainsKey($Id)) {
            Write-Verbose "No entity found for id '$Id'."
            return
        }

        # Resolve-EntityMergedInto throws on a cycle / exceeded depth cap (data defect).
        $canonical = Resolve-EntityMergedInto -StartId $Id -ById $byId
        if ($null -eq $canonical) {
            # Tombstone points at an id that is absent from the store -> not_found.
            Write-Verbose "Entity '$Id' resolves to a merged_into target that is not present."
            return
        }

        # Emit a shallow copy so the redirect stamp never mutates the cached store
        # record (and never leaks across pipeline iterations).
        $out = $canonical | Select-Object *
        $canonicalId = [string]$canonical.id
        if ($canonicalId -ne $Id) {
            # A tombstone was followed — surface the redirect (EntityDetailBase.redirected_from).
            Add-Member -InputObject $out -MemberType NoteProperty -Name 'redirected_from' -Value $Id -Force
        }
        return $out
    }
}
