# Tag: taxonomy (t/4035)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    t/4035 (t/4004 surviving vector): Invoke-ProposalApply MERGE deletes the merged-away nodes, and their
    graph_attributes.policy_actions with them. Without a recount, each dropped id's member_count stays one
    too high (and a policy referenced only by a merged-away node becomes an orphan still claiming a member).
    The fix calls the shared Invoke-NodePolicyRegistration hook after the write.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
    . (Join-Path $PSScriptRoot 'PolicyPovFixture.ps1')

    function Node([string]$Id, [string[]]$PolicyIds) {
        $acts = @($PolicyIds | ForEach-Object { [ordered]@{ action = "action for $_"; framing = 'f'; policy_id = $_ } })
        [ordered]@{ id = $Id; category = 'Beliefs'; label = $Id; graph_attributes = [ordered]@{ policy_actions = $acts } }
    }
    function Pol([string]$Id, [int]$Count) {
        [ordered]@{ id = $Id; action = "action for $Id"; source_povs = @('skeptic'); member_count = $Count; status = 'active' }
    }
    function New-MergeFixture([object[]]$Nodes, [object[]]$Policies) {
        $Dir = Join-Path ([System.IO.Path]::GetTempPath()) "proposal-recount-$(Get-Random)"
        New-Item -ItemType Directory -Path $Dir -Force | Out-Null
        [ordered]@{ _schema_version = '1.0.0'; last_modified = '2026-01-01'; nodes = @($Nodes) } |
            ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $Dir 'skeptic.json')
        [ordered]@{ _schema_version = '1.0.0'; _doc = 'x'; policy_count = @($Policies).Count; policies = @($Policies) } |
            ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $Dir 'policy_actions.json')
        Add-PolicyPovFillers -Dir $Dir
        return $Dir
    }
    function MergeProposal([string]$Survivor, [string[]]$MergeIds) {
        @{ action = 'MERGE'; pov = 'skeptic'; surviving_node_id = $Survivor; merge_node_ids = @($MergeIds); label = $null; description = $null } |
            ConvertTo-Json | ConvertFrom-Json
    }
    function Count-Of([string]$Dir, [string]$PolicyId) {
        @((Get-Content -Raw (Join-Path $Dir 'policy_actions.json') | ConvertFrom-Json).policies | Where-Object id -eq $PolicyId)[0].member_count
    }
    function Node-Ids([string]$Dir) { @((Get-Content -Raw (Join-Path $Dir 'skeptic.json') | ConvertFrom-Json).nodes.id) }
}

Describe 'Invoke-ProposalApply MERGE recounts the merged-away nodes'' policy ids (t/4035)' -Tag 'taxonomy' {

    AfterEach { if ($script:Dir) { Remove-Item $script:Dir -Recurse -Force -ErrorAction SilentlyContinue } }

    It 'brings each dropped id''s member_count down to a fresh scan and leaves an unrelated stale count alone' {
        # Survivor holds pol-001; the merged-away node holds pol-001 (shared) and pol-002 (only there).
        # pol-003 is unrelated and deliberately stale (9) -- a scoped recount must not touch it.
        $script:Dir = New-MergeFixture -Nodes @(
            (Node 'skp-beliefs-001' @('pol-001'))
            (Node 'skp-beliefs-002' @('pol-001', 'pol-002'))
            (Node 'skp-beliefs-003' @('pol-003'))
        ) -Policies @((Pol 'pol-001' 2), (Pol 'pol-002' 1), (Pol 'pol-003' 9))

        $result = InModuleScope AITriad -Parameters @{ Dir = $script:Dir; P = (MergeProposal 'skp-beliefs-001' @('skp-beliefs-001', 'skp-beliefs-002')) } {
            param($Dir, $P)
            Mock Get-TaxonomyDir { $Dir }
            Invoke-ProposalApply -Proposal $P -WarningAction SilentlyContinue 6>$null
        }
        $result.Success | Should -BeTrue
        Node-Ids $script:Dir | Should -Not -Contain 'skp-beliefs-002'

        Count-Of $script:Dir 'pol-001' | Should -Be 1   # was 2: the merged-away node's reference is gone
        Count-Of $script:Dir 'pol-002' | Should -Be 0   # was 1: referenced only by the merged-away node
        Count-Of $script:Dir 'pol-003' | Should -Be 9   # unrelated stale count: untouched

        # And the recounted ids agree with an independent fresh scan of the written files.
        $scan = InModuleScope AITriad -Parameters @{ Dir = $script:Dir } { param($Dir) Get-PolicyReferenceScan -TaxDir $Dir }
        foreach ($id in 'pol-001', 'pol-002') {
            $fresh = if ($scan.Referenced.ContainsKey($id)) { @($scan.Referenced[$id]).Count } else { 0 }
            Count-Of $script:Dir $id | Should -Be $fresh
        }
    }

    It 'when registration is refused (e.g. BLOCK-tier registry uncommitted), the MERGE still lands and the gap is WARNed' {
        $script:Dir = New-MergeFixture -Nodes @(
            (Node 'skp-beliefs-001' @('pol-001'))
            (Node 'skp-beliefs-002' @('pol-002'))
        ) -Policies @((Pol 'pol-001' 1), (Pol 'pol-002' 1))

        $out = InModuleScope AITriad -Parameters @{ Dir = $script:Dir; P = (MergeProposal 'skp-beliefs-001' @('skp-beliefs-001', 'skp-beliefs-002')) } {
            param($Dir, $P)
            Mock Get-TaxonomyDir { $Dir }
            Mock Update-PolicyRegistry { throw 'policy_actions.json is BLOCK-tier and has uncommitted changes' }
            $warns = $null
            $r = Invoke-ProposalApply -Proposal $P -WarningVariable warns -WarningAction SilentlyContinue 6>$null
            [pscustomobject]@{ Result = $r; Warns = @($warns) }
        }
        $out.Result.Success | Should -BeTrue                                  # the taxonomy write is NOT undone
        Node-Ids $script:Dir | Should -Not -Contain 'skp-beliefs-002'
        $regWarn = @($out.Warns | Where-Object { "$_" -match 'Invoke-ProposalApply: policy registration failed' })
        $regWarn.Count | Should -Be 1
        "$($regWarn[0])" | Should -Match 'skp-beliefs-002'                       # names the nodes left unrecounted
        Count-Of $script:Dir 'pol-002' | Should -Be 1                             # registry untouched by the refusal
    }

    It 'a MERGE whose merged-away nodes hold no policy ids never touches the registry' {
        $script:Dir = New-MergeFixture -Nodes @(
            (Node 'skp-beliefs-001' @('pol-001'))
            (Node 'skp-beliefs-002' @())
        ) -Policies @((Pol 'pol-001' 1))

        InModuleScope AITriad -Parameters @{ Dir = $script:Dir; P = (MergeProposal 'skp-beliefs-001' @('skp-beliefs-001', 'skp-beliefs-002')) } {
            param($Dir, $P)
            Mock Get-TaxonomyDir { $Dir }
            Mock Update-PolicyRegistry { }
            $r = Invoke-ProposalApply -Proposal $P -WarningAction SilentlyContinue 6>$null
            $r.Success | Should -BeTrue
            Should -Invoke Update-PolicyRegistry -Times 0 -Exactly
        }
    }
}
