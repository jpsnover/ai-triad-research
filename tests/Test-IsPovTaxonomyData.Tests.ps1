# Tag: taxonomy (t/1834)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests the taxonomy-node shape gate (Test-IsPovTaxonomyData) and the
    ConvertTo-TaxonomyNode strict-mode id/label guard.
.DESCRIPTION
    Regression coverage for t/1834: sidecar/log files in taxonomy/Origin that
    expose a top-level 'nodes[]' of a non-POV shape (notably
    entity_extraction_log.json, whose nodes are keyed by 'node_id') were being
    registered as fake POVs, crashing Get-Tax when ConvertTo-TaxonomyNode read
    $Node.id under Set-StrictMode. These tests are data-repo independent so they
    run in CI.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-IsPovTaxonomyData shape gate' -Tag 'taxonomy' {

    It 'Accepts a real POV file (nodes[].id present)' {
        InModuleScope AITriad {
            $j = '{"nodes":[{"id":"acc-desires-001","label":"L","description":"D"}]}' | ConvertFrom-Json
            Test-IsPovTaxonomyData $j | Should -BeTrue
        }
    }

    It 'Rejects entity_extraction_log shape (nodes[].node_id, no id) — t/1834' {
        InModuleScope AITriad {
            $j = '{"node_count":1,"nodes":[{"node_id":"acc-beliefs-003","model":"claude-sonnet-4-6"}]}' | ConvertFrom-Json
            Test-IsPovTaxonomyData $j | Should -BeFalse -Because 'a sidecar log must not be treated as a POV file'
        }
    }

    It 'Accepts an empty nodes[] (unusual but harmless — preserves prior behavior)' {
        InModuleScope AITriad {
            Test-IsPovTaxonomyData ('{"nodes":[]}' | ConvertFrom-Json) | Should -BeTrue
        }
    }

    It 'Rejects a file with no nodes property' {
        InModuleScope AITriad {
            Test-IsPovTaxonomyData ('{"cruxes":[]}' | ConvertFrom-Json) | Should -BeFalse
        }
    }

    It 'Rejects $null input' {
        InModuleScope AITriad {
            Test-IsPovTaxonomyData $null | Should -BeFalse
        }
    }
}

Describe 'ConvertTo-TaxonomyNode strict-mode id/label guard' -Tag 'taxonomy' {

    It 'Does not throw on an id-less node and yields empty Id/Label — t/1834' {
        InModuleScope AITriad {
            Set-StrictMode -Version Latest
            $node = '{"node_id":"acc-beliefs-003","model":"claude-sonnet-4-6"}' | ConvertFrom-Json
            # A throw here (a bare $Node.id would raise PropertyNotFoundException under
            # strict mode) fails the test — that is the regression guard.
            $obj = ConvertTo-TaxonomyNode -PovKey 'accelerationist' -Node $node
            $obj.Id    | Should -BeNullOrEmpty
            $obj.Label | Should -BeNullOrEmpty
        }
    }

    It 'Still maps id/label when present' {
        InModuleScope AITriad {
            $node = '{"id":"acc-desires-001","label":"Accelerate","description":"D"}' | ConvertFrom-Json
            $obj = ConvertTo-TaxonomyNode -PovKey 'accelerationist' -Node $node
            $obj.Id    | Should -Be 'acc-desires-001'
            $obj.Label | Should -Be 'Accelerate'
        }
    }
}
