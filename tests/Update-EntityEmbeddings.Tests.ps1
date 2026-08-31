# Tag: unit (t/3121 D)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Seed an entities.json with the given records (each a hashtable of entity fields).
    function New-EntitiesFile {
        param([string]$FilePath, [object[]]$Entities)
        $store = [ordered]@{
            _schema_version = '1.0.0'
            entities        = @($Entities)
            entity_count    = @($Entities).Count
            last_modified   = '2026-08-31'
        }
        $store | ConvertTo-Json -Depth 8 | Set-Content -Path $FilePath -Encoding utf8
    }

    function New-Ent {
        param([hashtable]$Over = @{})
        $base = @{ id = 'ent-001'; name = 'GPT-4'; aliases = @(); entity_type = 'artifact'
                   dolce_category = 'non-agentive-functional-artifact'; description = 'A model that generates text.'; status = 'approved' }
        foreach ($k in $Over.Keys) { $base[$k] = $Over[$k] }
        return $base
    }
}

Describe 'Update-EntityEmbeddings — v2 backfill (t/3121 D)' -Tag 'unit' {

    BeforeEach {
        Mock -ModuleName AITriad Get-TextEmbedding {
            $m = @{}
            foreach ($id in $Ids) {
                $fill = if ($id -like '*#desc') { 0.2 } else { 0.1 }
                $m[$id] = @(1..384 | ForEach-Object { $fill })
            }
            return $m
        }
    }

    It 'Embeds all approved entities to the v2 shape and reports counts' {
        $ent = Join-Path $TestDrive 'd-ent.json'
        $emb = Join-Path $TestDrive 'd-emb.json'
        New-EntitiesFile -FilePath $ent -Entities @(
            (New-Ent @{ id = 'ent-001'; name = 'GPT-4'; aliases = @('GPT4') }),
            (New-Ent @{ id = 'ent-002'; name = 'Claude' })
        )
        $r = Update-EntityEmbeddings -Path $ent -EmbeddingsPath $emb
        $r.TotalApproved | Should -Be 2
        $r.Embedded      | Should -Be 2
        $r.Skipped       | Should -Be 0

        $store = Get-Content -Raw -Path $emb | ConvertFrom-Json
        $store._schema_version | Should -Be '2.0.0'
        @($store.vectors.'ent-001'.name_vector).Count        | Should -Be 384
        @($store.vectors.'ent-001'.description_vector).Count | Should -Be 384
        @($store.vectors.'ent-002'.name_vector).Count        | Should -Be 384
        $store._src_hashes.'ent-001' | Should -Match '^[0-9a-f]{64}$'
        $store._src_hashes.'ent-002' | Should -Match '^[0-9a-f]{64}$'
    }

    It 'Embeds only approved entities (proposed/deprecated get no vector)' {
        $ent = Join-Path $TestDrive 'd-onlyapproved-ent.json'
        $emb = Join-Path $TestDrive 'd-onlyapproved-emb.json'
        New-EntitiesFile -FilePath $ent -Entities @(
            (New-Ent @{ id = 'ent-001'; status = 'approved' }),
            (New-Ent @{ id = 'ent-002'; status = 'proposed' }),
            (New-Ent @{ id = 'ent-003'; status = 'deprecated' })
        )
        $r = Update-EntityEmbeddings -Path $ent -EmbeddingsPath $emb
        $r.TotalApproved | Should -Be 1
        $r.Embedded      | Should -Be 1
        $store = Get-Content -Raw -Path $emb | ConvertFrom-Json
        $store.vectors.PSObject.Properties['ent-001'] | Should -Not -BeNullOrEmpty
        $store.vectors.PSObject.Properties['ent-002'] | Should -BeNullOrEmpty
        $store.vectors.PSObject.Properties['ent-003'] | Should -BeNullOrEmpty
    }

    It 'Omits description_vector for an approved entity with no description' {
        $ent = Join-Path $TestDrive 'd-nodesc-ent.json'
        $emb = Join-Path $TestDrive 'd-nodesc-emb.json'
        New-EntitiesFile -FilePath $ent -Entities @((New-Ent @{ description = '' }))
        Update-EntityEmbeddings -Path $ent -EmbeddingsPath $emb | Out-Null
        $rec = (Get-Content -Raw -Path $emb | ConvertFrom-Json).vectors.'ent-001'
        @($rec.name_vector).Count | Should -Be 384
        $rec.PSObject.Properties['description_vector'] | Should -BeNullOrEmpty
    }

    It 'Batches all needing-embed entities into ONE Get-TextEmbedding call' {
        $ent = Join-Path $TestDrive 'd-batch-ent.json'
        $emb = Join-Path $TestDrive 'd-batch-emb.json'
        New-EntitiesFile -FilePath $ent -Entities @(
            (New-Ent @{ id = 'ent-001' }),
            (New-Ent @{ id = 'ent-002' })
        )
        Update-EntityEmbeddings -Path $ent -EmbeddingsPath $emb | Out-Null
        Should -Invoke -ModuleName AITriad Get-TextEmbedding -Times 1 -Exactly -ParameterFilter {
            ($Ids -contains 'ent-001#name') -and ($Ids -contains 'ent-002#name')
        }
    }

    It 'Is idempotent — a second run with no change embeds nothing (skip via _src_hash)' {
        $ent = Join-Path $TestDrive 'd-idem-ent.json'
        $emb = Join-Path $TestDrive 'd-idem-emb.json'
        New-EntitiesFile -FilePath $ent -Entities @((New-Ent @{ id = 'ent-001' }), (New-Ent @{ id = 'ent-002' }))
        $r1 = Update-EntityEmbeddings -Path $ent -EmbeddingsPath $emb
        $r2 = Update-EntityEmbeddings -Path $ent -EmbeddingsPath $emb
        $r1.Embedded | Should -Be 2
        $r2.Embedded | Should -Be 0
        $r2.Skipped  | Should -Be 2
        Should -Invoke -ModuleName AITriad Get-TextEmbedding -Times 1 -Exactly   # only the first run embedded
    }

    It '-Force re-embeds even when the source is unchanged' {
        $ent = Join-Path $TestDrive 'd-force-ent.json'
        $emb = Join-Path $TestDrive 'd-force-emb.json'
        New-EntitiesFile -FilePath $ent -Entities @((New-Ent @{ id = 'ent-001' }))
        Update-EntityEmbeddings -Path $ent -EmbeddingsPath $emb | Out-Null
        $r2 = Update-EntityEmbeddings -Path $ent -EmbeddingsPath $emb -Force
        $r2.Embedded | Should -Be 1
        Should -Invoke -ModuleName AITriad Get-TextEmbedding -Times 2 -Exactly
    }

    It 'Re-embeds only the entity whose source changed' {
        $ent = Join-Path $TestDrive 'd-change-ent.json'
        $emb = Join-Path $TestDrive 'd-change-emb.json'
        New-EntitiesFile -FilePath $ent -Entities @((New-Ent @{ id = 'ent-001' }), (New-Ent @{ id = 'ent-002'; name = 'Claude' }))
        Update-EntityEmbeddings -Path $ent -EmbeddingsPath $emb | Out-Null
        # Change ent-002's description only.
        New-EntitiesFile -FilePath $ent -Entities @((New-Ent @{ id = 'ent-001' }), (New-Ent @{ id = 'ent-002'; name = 'Claude'; description = 'A different model entirely.' }))
        $r2 = Update-EntityEmbeddings -Path $ent -EmbeddingsPath $emb
        $r2.Embedded | Should -Be 1   # only ent-002
        $r2.Skipped  | Should -Be 1
    }

    It '-WhatIf writes nothing and does not embed' {
        $ent = Join-Path $TestDrive 'd-whatif-ent.json'
        $emb = Join-Path $TestDrive 'd-whatif-emb.json'
        New-EntitiesFile -FilePath $ent -Entities @((New-Ent @{ id = 'ent-001' }))
        $r = Update-EntityEmbeddings -Path $ent -EmbeddingsPath $emb -WhatIf
        $r.Embedded | Should -Be 0
        Test-Path $emb | Should -BeFalse
        Should -Invoke -ModuleName AITriad Get-TextEmbedding -Times 0 -Exactly
    }

    It 'Throws an ActionableError when entities.json is missing' {
        $ent = Join-Path $TestDrive 'does-not-exist.json'
        $emb = Join-Path $TestDrive 'd-missing-emb.json'
        { Update-EntityEmbeddings -Path $ent -EmbeddingsPath $emb } | Should -Throw -ExpectedMessage '*entities.json not found*'
    }
}

Describe 'Update-EntityEmbeddings — manifest export (t/3121 D)' -Tag 'unit' {
    It 'FunctionsToExport includes Update-EntityEmbeddings' {
        $manifestPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
        (Test-ModuleManifest -Path $manifestPath).ExportedFunctions.Keys | Should -Contain 'Update-EntityEmbeddings'
    }
    It 'Get-Command resolves the exported cmdlet' {
        Get-Command Update-EntityEmbeddings -Module AITriad | Should -Not -BeNullOrEmpty
    }
}
