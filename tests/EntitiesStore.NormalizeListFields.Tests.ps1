# Tag: unit (t/1969)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Writer-side list-field normalization for entities.json (t/1969).
.DESCRIPTION
    entities.json had drifted to store `aliases`/`source_refs` as array | null | bare
    string, though the Entity type (lib/entities/types.ts) declares both `string[]` —
    a shape-vs-type lie that crashed the entity browser / t/1898 mention flow. The
    server now coerces at the read boundary (t/1964); this is the writer half:
    Write-EntityStoreAtomic normalizes every entity record before ConvertTo-Json so the
    stored shape stops drifting. These tests write mixed shapes through the real
    chokepoint and assert the RAW JSON never emits null / a bare string for those
    fields, and that the embeddings envelope (vectors, no `entities`) is untouched.
    Pure PS, keyless — always runs.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'EntitiesStore write-side list-field normalization (t/1969)' -Tag 'unit' {

    It 'serializes aliases/source_refs as arrays — never null, never a bare string' {
        InModuleScope AITriad {
            $path = Join-Path $TestDrive 'entities.json'
            $store = [PSCustomObject]@{
                _schema  = 'v1'
                entities = @(
                    [PSCustomObject]@{ id = 'ent-001'; name = 'Null';   aliases = $null;         source_refs = $null }
                    [PSCustomObject]@{ id = 'ent-002'; name = 'Bare';   aliases = 'solo';         source_refs = 'doc-1' }
                    [PSCustomObject]@{ id = 'ent-003'; name = 'Single'; aliases = @('x');         source_refs = @('doc-1') }
                    [PSCustomObject]@{ id = 'ent-004'; name = 'Multi';  aliases = @('x', 'y');    source_refs = @('doc-1', 'doc-2') }
                    [PSCustomObject]@{ id = 'ent-005'; name = 'NoAliasField';               source_refs = @('doc-3') }
                )
            }

            Write-EntityStoreAtomic -Store $store -Path $path
            $raw = Get-Content -Raw -Path $path

            # AC: raw JSON has NO null and NO bare-string value for these fields.
            $raw | Should -Not -Match '"aliases"\s*:\s*null'
            $raw | Should -Not -Match '"source_refs"\s*:\s*null'
            $raw | Should -Not -Match '"aliases"\s*:\s*"'       -Because 'a bare-string value opens with a quote; an array opens with ['
            $raw | Should -Not -Match '"source_refs"\s*:\s*"'

            # AC: [] for empty, ["x"] for single, wrapped for bare.
            $raw | Should -Match '"aliases"\s*:\s*\[\s*\]'          -Because 'ent-001 null and ent-005 missing → []'
            $raw | Should -Match '"aliases"\s*:\s*\[\s*"solo"\s*\]' -Because 'ent-002 bare string → one-element array'

            # Round-trip: contents preserved as arrays.
            $parsed = ($raw | ConvertFrom-Json).entities
            @(($parsed | Where-Object { $_.id -eq 'ent-001' }).aliases).Count     | Should -Be 0
            @(($parsed | Where-Object { $_.id -eq 'ent-002' }).aliases)           | Should -Be @('solo')
            @(($parsed | Where-Object { $_.id -eq 'ent-002' }).source_refs)       | Should -Be @('doc-1')
            @(($parsed | Where-Object { $_.id -eq 'ent-004' }).aliases)           | Should -Be @('x', 'y')
            @(($parsed | Where-Object { $_.id -eq 'ent-005' }).aliases).Count     | Should -Be 0 -Because 'a record missing aliases gets [] (contract-required field ensured present)'
        }
    }

    It 'leaves the embeddings envelope (vectors, no entities) untouched' {
        InModuleScope AITriad {
            $path = Join-Path $TestDrive 'entity_embeddings.json'
            $store = [PSCustomObject]@{
                _schema = 'v1'
                vectors = [PSCustomObject]@{ 'ent-001' = @(0.1, 0.2, 0.3) }
            }
            { Write-EntityStoreAtomic -Store $store -Path $path } | Should -Not -Throw
            $parsed = Get-Content -Raw -Path $path | ConvertFrom-Json
            @($parsed.vectors.'ent-001') | Should -Be @(0.1, 0.2, 0.3) -Because 'the entities-envelope gate must not touch a vectors write'
        }
    }
}
