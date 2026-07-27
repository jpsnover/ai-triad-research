# Tag: unit (t/1804)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Minimal proposal factory.
    function New-Prop {
        param([hashtable]$Over = @{})
        $base = @{ name = 'GPT-4'; entity_type = 'artifact'; dolce_category = 'non-agentive-functional-artifact'; description = 'A model that generates text.' }
        foreach ($k in $Over.Keys) { $base[$k] = $Over[$k] }
        return $base
    }
}

Describe 'New-EntityId — monotonic, never-reused allocator (t/1804 §3)' -Tag 'unit' {

    It 'Mints ent-001 against an empty store' {
        InModuleScope AITriad {
            $store = [PSCustomObject]@{ entities = @() }
            @(New-EntityId -Store $store)[0] | Should -Be 'ent-001'
        }
    }

    It 'Does NOT recycle an id after the record is deprecated' {
        InModuleScope AITriad {
            $store = [PSCustomObject]@{ entities = @(
                [PSCustomObject]@{ id = 'ent-001'; status = 'deprecated' }
            ) }
            @(New-EntityId -Store $store)[0] | Should -Be 'ent-002'
        }
    }

    It 'Does NOT recycle an id after a merge tombstone (highest id wins even when merged away)' {
        InModuleScope AITriad {
            $store = [PSCustomObject]@{ entities = @(
                [PSCustomObject]@{ id = 'ent-001'; status = 'approved' }
                [PSCustomObject]@{ id = 'ent-002'; status = 'approved'; merged_into = 'ent-003' }
                [PSCustomObject]@{ id = 'ent-003'; status = 'approved' }
            ) }
            @(New-EntityId -Store $store)[0] | Should -Be 'ent-004'
        }
    }

    It 'Compares the PARSED INTEGER, not the string (999 -> 1000, not lexical)' {
        InModuleScope AITriad {
            $store = [PSCustomObject]@{ entities = @(
                [PSCustomObject]@{ id = 'ent-999' }
                [PSCustomObject]@{ id = 'ent-100' }
            ) }
            @(New-EntityId -Store $store)[0] | Should -Be 'ent-1000'
        }
    }

    It 'Continues past four digits without regressing (ent-1000 present -> ent-1001)' {
        InModuleScope AITriad {
            $store = [PSCustomObject]@{ entities = @(
                [PSCustomObject]@{ id = 'ent-1000' }
                [PSCustomObject]@{ id = 'ent-999' }
            ) }
            @(New-EntityId -Store $store)[0] | Should -Be 'ent-1001'
        }
    }

    It 'Mints a contiguous, collision-free batch off one high-water mark' {
        InModuleScope AITriad {
            $store = [PSCustomObject]@{ entities = @([PSCustomObject]@{ id = 'ent-005' }) }
            $ids = New-EntityId -Store $store -Count 3
            $ids | Should -Be @('ent-006', 'ent-007', 'ent-008')
        }
    }
}

Describe 'Import-Entity — curation write (t/1804 §4)' -Tag 'unit' {

    It 'Creates entities.json with the §3 envelope shape on first write' {
        $tmp = Join-Path $TestDrive 'entities-shape.json'
        Import-Entity -Proposal @((New-Prop)) -Path $tmp -SkipEmbedding | Out-Null
        $store = Get-Content -Raw -Path $tmp | ConvertFrom-Json
        $store._schema_version | Should -Be '1.0.0'
        $store.entity_count    | Should -Be 1
        @($store.entities).Count | Should -Be 1
        $store.entities[0].id  | Should -Be 'ent-001'
    }

    It 'Enforces the ~20/batch cap (21 proposals throws)' {
        $tmp = Join-Path $TestDrive 'entities-cap.json'
        $many = 1..21 | ForEach-Object { New-Prop @{ name = "Ent$_" } }
        { Import-Entity -Proposal $many -Path $tmp -SkipEmbedding } | Should -Throw
    }

    It 'Accepts exactly 20 proposals (cap boundary)' {
        $tmp = Join-Path $TestDrive 'entities-cap20.json'
        $twenty = 1..20 | ForEach-Object { New-Prop @{ name = "Ent$_" } }
        { Import-Entity -Proposal $twenty -Path $tmp -SkipEmbedding } | Should -Not -Throw
        (Get-Content -Raw -Path $tmp | ConvertFrom-Json).entity_count | Should -Be 20
    }

    It 'Rejects approving a PERSON record with no human description (§4/§9.3)' {
        $tmp = Join-Path $TestDrive 'entities-person.json'
        $p = @{ name = 'Jane Doe'; entity_type = 'person'; dolce_category = 'agentive-physical-object'; status = 'approved' }
        { Import-Entity -Proposal @($p) -Path $tmp -SkipEmbedding } | Should -Throw -ExpectedMessage '*description*'
    }

    It 'Allows approving a PERSON record WITH a human description' {
        $tmp = Join-Path $TestDrive 'entities-person-ok.json'
        $p = @{ name = 'Jane Doe'; entity_type = 'person'; dolce_category = 'agentive-physical-object'; status = 'approved'; description = 'A person who researches AI policy.' }
        { Import-Entity -Proposal @($p) -Path $tmp -SkipEmbedding } | Should -Not -Throw
        (Get-Content -Raw -Path $tmp | ConvertFrom-Json).entities[0].status | Should -Be 'approved'
    }

    It 'NEVER hard-deletes: deprecate + merge leave the record count monotonic (§3, TL Q3)' {
        $tmp = Join-Path $TestDrive 'entities-nodelete.json'
        Import-Entity -Proposal @((New-Prop @{ name = 'A' }), (New-Prop @{ name = 'B' })) -Path $tmp -SkipEmbedding | Out-Null
        (Get-Content -Raw -Path $tmp | ConvertFrom-Json).entity_count | Should -Be 2

        # Deprecate ent-001 — count must not drop.
        Import-Entity -Proposal @(@{ id = 'ent-001'; status = 'deprecated' }) -Path $tmp -SkipEmbedding | Out-Null
        (Get-Content -Raw -Path $tmp | ConvertFrom-Json).entity_count | Should -Be 2

        # Merge ent-002 into ent-001 — still 2, tombstone retained.
        Import-Entity -Proposal @(@{ id = 'ent-002'; merged_into = 'ent-001' }) -Path $tmp -SkipEmbedding | Out-Null
        $store = Get-Content -Raw -Path $tmp | ConvertFrom-Json
        $store.entity_count | Should -Be 2
        ($store.entities | Where-Object { $_.id -eq 'ent-002' }).merged_into | Should -Be 'ent-001'
    }

    It 'A new mint after deprecate/merge does not recycle (end-to-end allocator proof)' {
        $tmp = Join-Path $TestDrive 'entities-e2e.json'
        Import-Entity -Proposal @((New-Prop @{ name = 'A' })) -Path $tmp -SkipEmbedding | Out-Null   # ent-001
        Import-Entity -Proposal @(@{ id = 'ent-001'; status = 'deprecated' }) -Path $tmp -SkipEmbedding | Out-Null
        $r = Import-Entity -Proposal @((New-Prop @{ name = 'B' })) -Path $tmp -SkipEmbedding          # must be ent-002
        $r[0].Id | Should -Be 'ent-002'
    }
}

Describe 'Get-Entity — resolve + merge walk (t/1804 §7)' -Tag 'unit' {

    BeforeAll {
        $script:GePath = Join-Path $TestDrive 'entities-get.json'
        # ent-001 canonical, ent-002 tombstone -> ent-001.
        Import-Entity -Proposal @(
            (New-Prop @{ name = 'Canonical' }),
            (New-Prop @{ name = 'Dup' })
        ) -Path $script:GePath -SkipEmbedding | Out-Null
        Import-Entity -Proposal @(@{ id = 'ent-002'; merged_into = 'ent-001' }) -Path $script:GePath -SkipEmbedding | Out-Null
    }

    It 'Resolves a plain (non-merged) record' {
        (Get-Entity -Id 'ent-001' -Path $script:GePath).name | Should -Be 'Canonical'
    }

    It 'Follows a tombstone to the canonical record and stamps redirected_from' {
        $e = Get-Entity -Id 'ent-002' -Path $script:GePath
        $e.id              | Should -Be 'ent-001'
        $e.redirected_from | Should -Be 'ent-002'
    }

    It 'A plain record carries NO redirected_from' {
        $e = Get-Entity -Id 'ent-001' -Path $script:GePath
        $e.PSObject.Properties['redirected_from'] | Should -BeNullOrEmpty
    }

    It 'Returns nothing for an absent id' {
        Get-Entity -Id 'ent-999' -Path $script:GePath | Should -BeNullOrEmpty
    }

    It 'Rejects a non-ent id (ent-* only, TL Q2)' {
        { Get-Entity -Id 'org-001' -Path $script:GePath } | Should -Throw
    }
}

Describe 'Resolve-EntityMergedInto — cycle + depth cap mirror the server (t/1786)' -Tag 'unit' {

    It 'Throws on a merged_into cycle (data defect, not a silent 404)' {
        InModuleScope AITriad {
            $byId = @{
                'ent-A' = [PSCustomObject]@{ id = 'ent-A'; merged_into = 'ent-B' }
                'ent-B' = [PSCustomObject]@{ id = 'ent-B'; merged_into = 'ent-A' }
            }
            { Resolve-EntityMergedInto -StartId 'ent-A' -ById $byId } | Should -Throw -ExpectedMessage '*cycle*'
        }
    }

    It 'Throws when the chain exceeds the depth cap' {
        InModuleScope AITriad {
            $byId = @{
                'ent-001' = [PSCustomObject]@{ id = 'ent-001'; merged_into = 'ent-002' }
                'ent-002' = [PSCustomObject]@{ id = 'ent-002'; merged_into = 'ent-003' }
                'ent-003' = [PSCustomObject]@{ id = 'ent-003' }
            }
            { Resolve-EntityMergedInto -StartId 'ent-001' -ById $byId -MaxDepth 1 } | Should -Throw -ExpectedMessage '*depth cap*'
        }
    }

    It 'Returns null when the tombstone target is absent (not_found)' {
        InModuleScope AITriad {
            $byId = @{ 'ent-001' = [PSCustomObject]@{ id = 'ent-001'; merged_into = 'ent-404' } }
            Resolve-EntityMergedInto -StartId 'ent-001' -ById $byId | Should -BeNullOrEmpty
        }
    }

    It 'Uses the same cap as the server (16)' {
        InModuleScope AITriad {
            $script:EntityMergeMaxDepth | Should -Be 16
        }
    }
}

Describe 'Entity shape parity with lib/entities/types.ts (contract drift gate, TL Q1)' -Tag 'unit' {

    BeforeAll {
        # Parse the Entity interface field set from the FROZEN TS contract — tolerant of
        # formatting (leading ws, spacing around the colon) so a reformat does not false-red.
        $typesPath = Join-Path $PSScriptRoot '..' 'lib' 'entities' 'types.ts'
        $lines = Get-Content -Path $typesPath
        $start = ($lines | Select-String -Pattern 'export\s+interface\s+Entity\s*\{' | Select-Object -First 1).LineNumber
        $script:RequiredFields = [System.Collections.Generic.List[string]]::new()
        $script:OptionalFields = [System.Collections.Generic.List[string]]::new()
        for ($i = $start; $i -lt $lines.Count; $i++) {
            $line = $lines[$i]
            if ($line -match '^\s*\}') { break }
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)(\?)?\s*:') {
                if ($Matches[2]) { $script:OptionalFields.Add($Matches[1]) }
                else { $script:RequiredFields.Add($Matches[1]) }
            }
        }

        # A parity checker: record keys must contain every required field and introduce no
        # field outside the contract. Returns $true iff parity holds.
        function Test-EntityKeyParity {
            param([string[]]$RecordKeys, [string[]]$Required, [string[]]$Optional)
            $allowed = @($Required) + @($Optional)
            $missingRequired = @($Required | Where-Object { $_ -notin $RecordKeys })
            $forkedExtra     = @($RecordKeys | Where-Object { $_ -notin $allowed })
            return ($missingRequired.Count -eq 0 -and $forkedExtra.Count -eq 0)
        }
    }

    It 'Parsed the contract (required + optional fields both non-empty)' {
        $script:RequiredFields.Count | Should -BeGreaterThan 0
        $script:OptionalFields.Count | Should -BeGreaterThan 0
        # Spot-check known contract members so a broken parser is caught.
        $script:RequiredFields | Should -Contain 'id'
        $script:RequiredFields | Should -Contain 'status'
        $script:OptionalFields | Should -Contain 'merged_into'
    }

    It 'A record written by Import-Entity satisfies the contract (required present, no forked keys)' {
        $tmp = Join-Path $TestDrive 'entities-parity.json'
        Import-Entity -Proposal @((New-Prop)) -Path $tmp -SkipEmbedding | Out-Null
        $rec = (Get-Content -Raw -Path $tmp | ConvertFrom-Json).entities[0]
        $keys = @($rec.PSObject.Properties.Name)
        (Test-EntityKeyParity -RecordKeys $keys -Required $script:RequiredFields -Optional $script:OptionalFields) | Should -BeTrue
    }

    It 'Optional-field ABSENCE does not false-fail (merged_into/confidence absent is legal)' {
        # A minimal record carries no optional fields — parity must still hold.
        $keys = @($script:RequiredFields) + @('external_refs', 'source_refs')
        (Test-EntityKeyParity -RecordKeys $keys -Required $script:RequiredFields -Optional $script:OptionalFields) | Should -BeTrue
    }

    It 'GATE-VERIFY: a forked/extra key makes parity FAIL (the gate actually bites)' {
        $keysWithBogus = @($script:RequiredFields) + @('external_refs', 'source_refs', 'bogus_forked_field')
        (Test-EntityKeyParity -RecordKeys $keysWithBogus -Required $script:RequiredFields -Optional $script:OptionalFields) | Should -BeFalse
    }

    It 'GATE-VERIFY: a MISSING required key makes parity FAIL' {
        $keysMissingId = @($script:RequiredFields | Where-Object { $_ -ne 'id' }) + @('external_refs', 'source_refs')
        (Test-EntityKeyParity -RecordKeys $keysMissingId -Required $script:RequiredFields -Optional $script:OptionalFields) | Should -BeFalse
    }
}

Describe 'Entity cmdlets - manifest' -Tag 'unit' {
    It 'FunctionsToExport includes Get-Entity and Import-Entity' {
        $manifestPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
        $manifest = Test-ModuleManifest -Path $manifestPath
        $manifest.ExportedFunctions.Keys | Should -Contain 'Get-Entity'
        $manifest.ExportedFunctions.Keys | Should -Contain 'Import-Entity'
    }
}
