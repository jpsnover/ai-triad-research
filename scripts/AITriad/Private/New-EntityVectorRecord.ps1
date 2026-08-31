# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Build the v2 EntityVectorRecord { name_vector, description_vector? } stored at
# entity_embeddings.json vectors[<id>] (lib/entities/entityVectors.ts, t/3121). Single
# constructor so both writers (Import-Entity, Update-EntityEmbeddings) emit an identical
# shape: description_vector is OMITTED (not null) when there is no description vector, per
# the contract ("Readers MUST tolerate its absence"). Dot-sourced — do NOT export.
function New-EntityVectorRecord {
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)]
        $NameVector,

        [Parameter()]
        $DescriptionVector = $null
    )
    Set-StrictMode -Version Latest
    $rec = [PSCustomObject]@{ name_vector = @($NameVector) }
    if ($null -ne $DescriptionVector) {
        Add-Member -InputObject $rec -MemberType NoteProperty -Name 'description_vector' -Value (@($DescriptionVector))
    }
    return $rec
}
