# Tag: taxonomy (t/2748)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Approve-TaxonomyProposal StrictMode target_node_id guard regression (t/2748).
.DESCRIPTION
    The preview loop (Show-Proposal) read $P.target_node_id without a
    PSObject.Properties guard, unlike its sibling optional fields. Under
    Set-StrictMode -Version Latest a hand-authored NEW proposal that omits
    target_node_id threw "The property 'target_node_id' cannot be found on this
    object", aborting the whole approve run. AI-generated proposals always include
    the field, so only hand-authored ones (e.g. a CL-drafted NEW node) hit it.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Approve-TaxonomyProposal target_node_id guard (t/2748)' -Tag 'taxonomy' {

    BeforeEach {
        $script:PropFile = Join-Path ([System.IO.Path]::GetTempPath()) "atp-$(New-Guid).json"
    }

    AfterEach {
        Remove-Item -Path $script:PropFile -Force -ErrorAction SilentlyContinue
    }

    It 'previews a NEW proposal that omits target_node_id without throwing (DryRun)' {
        # Hand-authored NEW proposal — no target_node_id, no status (pending).
        @{
            proposals = @(
                [ordered]@{
                    action       = 'NEW'
                    suggested_id = 'acc-beliefs-999'
                    pov          = 'accelerationist'
                    category     = 'Beliefs'
                    label        = 'Test New Node'
                    description  = 'A hand-authored proposal with no target_node_id.'
                    rationale    = 'regression fixture for t/2748'
                }
            )
        } | ConvertTo-Json -Depth 10 | Set-Content -Path $script:PropFile -Encoding UTF8

        { Approve-TaxonomyProposal -Path $script:PropFile -ApproveAll -DryRun 6>$null } |
            Should -Not -Throw -Because 'a missing target_node_id must be guarded, not crash the preview loop'
    }

    It 'still previews a proposal that DOES carry target_node_id (no regression)' {
        @{
            proposals = @(
                [ordered]@{
                    action         = 'RELABEL'
                    suggested_id   = 'acc-beliefs-001'
                    pov            = 'accelerationist'
                    category       = 'Beliefs'
                    label          = 'Renamed Node'
                    target_node_id = 'acc-beliefs-001'
                    description    = 'Has a target_node_id.'
                    rationale      = 'control'
                }
            )
        } | ConvertTo-Json -Depth 10 | Set-Content -Path $script:PropFile -Encoding UTF8

        { Approve-TaxonomyProposal -Path $script:PropFile -ApproveAll -DryRun 6>$null } | Should -Not -Throw
    }
}
