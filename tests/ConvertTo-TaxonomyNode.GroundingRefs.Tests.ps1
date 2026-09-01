# Tag: unit (t/3197)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    t/3197: ConvertTo-TaxonomyNode must project the G1 grounding refs (concept_refs / entity_refs,
    t/3157) onto the typed [TaxonomyNode] so `Get-Tax | Where-Object { $_.ConceptRefs.Count }` and
    `... EntityRefs.Count` surface grounded nodes instead of silently returning zero rows.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
}

Describe 'ConvertTo-TaxonomyNode grounding refs (t/3197)' -Tag 'unit' {

    It 'projects concept_refs and entity_refs from a POV node onto the typed object' {
        InModuleScope AITriad {
            $raw = [pscustomobject]@{
                id            = 'acc-beliefs-001'
                label         = 'Test node'
                description   = 'desc'
                category      = 'Beliefs'
                parent_id     = $null
                children      = @()
                concept_refs  = @(
                    [pscustomobject]@{ ref = 'term:oversight'; surface = 'oversight'; method = 'surface'; link_confidence = 1.0; status = 'linked' }
                    [pscustomobject]@{ ref = 'term:alignment'; surface = 'alignment'; method = 'embedding'; link_confidence = 0.61; status = 'proposed' }
                )
                entity_refs   = @(
                    [pscustomobject]@{ ref = 'ent-001'; surface = 'Apollo Project'; method = 'exact'; link_confidence = 1.0; match_level = 'exact'; status = 'linked' }
                )
            }

            $node = ConvertTo-TaxonomyNode -PovKey 'accelerationist' -Node $raw

            @($node.ConceptRefs).Count | Should -Be 2
            @($node.EntityRefs).Count  | Should -Be 1
            $node.ConceptRefs[0].ref   | Should -Be 'term:oversight'
            $node.ConceptRefs[1].status | Should -Be 'proposed'
            $node.EntityRefs[0].ref    | Should -Be 'ent-001'
            $node.EntityRefs[0].match_level | Should -Be 'exact'
        }
    }

    It 'defaults ConceptRefs/EntityRefs to empty arrays on an ungrounded POV node (so .Count filters correctly)' {
        InModuleScope AITriad {
            $raw = [pscustomobject]@{
                id = 'acc-beliefs-002'; label = 'Ungrounded'; description = 'd'; category = 'Beliefs'; parent_id = $null; children = @()
            }
            $node = ConvertTo-TaxonomyNode -PovKey 'accelerationist' -Node $raw

            # The AC's filter is `Where-Object { $_.ConceptRefs.Count }`; a [PSObject[]] class
            # property left ungrounded reads as $null, and $null.Count is 0 — so the filter yields
            # 0 and drops the node, exactly as intended (never a false positive).
            $node.ConceptRefs.Count | Should -Be 0
            $node.EntityRefs.Count  | Should -Be 0
        }
    }

    It 'a Where-Object filter on .ConceptRefs.Count selects only grounded nodes (the AC)' {
        InModuleScope AITriad {
            $grounded = ConvertTo-TaxonomyNode -PovKey 'accelerationist' -Node ([pscustomobject]@{
                    id = 'acc-1'; label = 'g'; description = 'd'; category = 'Beliefs'; parent_id = $null; children = @()
                    concept_refs = @([pscustomobject]@{ ref = 'term:x'; status = 'linked' })
                })
            $bare = ConvertTo-TaxonomyNode -PovKey 'accelerationist' -Node ([pscustomobject]@{
                    id = 'acc-2'; label = 'b'; description = 'd'; category = 'Beliefs'; parent_id = $null; children = @()
                })
            $selected = @($grounded, $bare) | Where-Object { $_.ConceptRefs.Count }
            @($selected).Count | Should -Be 1
            $selected.Id | Should -Be 'acc-1'
        }
    }
}
