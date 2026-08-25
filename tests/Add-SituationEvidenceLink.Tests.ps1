# Tag: taxonomy (t/3015)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    WS-B Stage 2 (t/3015): Add-SituationEvidenceLink — guarded commit of embedding-proposed
    situation->POV evidence links, provenance-stamped and purgeable. No spend, no live-data writes;
    every test builds a throwaway taxonomy dir + proposal.json.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

    function New-WsbFixture {
        param($Sits = @(), $Acc = @(), $Saf = @(), $Skp = @())
        $root = Join-Path ([System.IO.Path]::GetTempPath()) "wsb-$([guid]::NewGuid().ToString('N').Substring(0,8))"
        $tax  = Join-Path $root 'taxonomy/Origin'
        New-Item -ItemType Directory -Path $tax -Force | Out-Null
        @{ _schema_version = '1.0.0'; last_modified = '2026-01-01'; nodes = @($Sits) } | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $tax 'situations.json') -Encoding utf8
        @{ _schema_version = '1.0.0'; pov = 'accelerationist'; last_modified = '2026-01-01'; nodes = @($Acc) } | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $tax 'accelerationist.json') -Encoding utf8
        @{ _schema_version = '1.0.0'; pov = 'safetyist'; last_modified = '2026-01-01'; nodes = @($Saf) } | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $tax 'safetyist.json') -Encoding utf8
        @{ _schema_version = '1.0.0'; pov = 'skeptic'; last_modified = '2026-01-01'; nodes = @($Skp) } | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $tax 'skeptic.json') -Encoding utf8
        @{ policies = @() } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $tax 'policy_actions.json') -Encoding utf8
        return $root
    }
    function New-Proposal {
        param($Root, $Links)
        $p = Join-Path $Root 'proposal.json'
        # Force an array even for a single element so ConvertFrom-Json yields a list.
        , @($Links) | ConvertTo-Json -Depth 10 -AsArray | Set-Content -Path $p -Encoding utf8
        return $p
    }
    function New-SitNode { param($Id, $Linked = @()) [ordered]@{ id = $Id; label = $Id; description = "sit $Id"; linked_nodes = @($Linked) } }
    function New-PovNode { param($Id, $Refs = @())   [ordered]@{ id = $Id; category = 'Beliefs'; label = $Id; situation_refs = @($Refs) } }
    function New-Link    { param($Sit, $Camp, $Node, $Score = 0.5, $Rank = 1) [ordered]@{ situation_id = $Sit; camp = $Camp; node_id = $Node; score = $Score; rank = $Rank } }

    function Get-Sit  { param($Root, $Id) (Get-Content -Raw -Path (Join-Path $Root 'taxonomy/Origin/situations.json') | ConvertFrom-Json).nodes | Where-Object { $_.id -eq $Id } }
    function Get-Pov  { param($Root, $Camp, $Id) (Get-Content -Raw -Path (Join-Path $Root "taxonomy/Origin/$Camp.json") | ConvertFrom-Json).nodes | Where-Object { $_.id -eq $Id } }
}

Describe 'Add-SituationEvidenceLink — apply (t/3015)' -Tag 'taxonomy' {

    It 'is exported from the module' {
        Get-Command -Module AITriad -Name 'Add-SituationEvidenceLink' | Should -Not -BeNullOrEmpty
    }

    It 'writes BOTH directions and stamps provenance keyed by node_id on the situation' {
        $root = New-WsbFixture -Sits @( (New-SitNode 'sit-001') ) -Acc @( (New-PovNode 'acc-beliefs-001') )
        $prop = New-Proposal $root @( (New-Link 'sit-001' 'acc' 'acc-beliefs-001' 0.66 1) )
        try {
            $sum = Add-SituationEvidenceLink -ProposalPath $prop -RepoRoot $root -BatchId 'wsb-1' 6>$null
            $sum.LinksAdded | Should -Be 1
            $sit = Get-Sit $root 'sit-001'
            @($sit.linked_nodes) | Should -Contain 'acc-beliefs-001'
            $node = Get-Pov $root 'accelerationist' 'acc-beliefs-001'
            @($node.situation_refs) | Should -Contain 'sit-001'
            $prov = $sit.evidence_provenance.'acc-beliefs-001'
            $prov.origin   | Should -Be 'machine'
            $prov.method   | Should -Be 'embedding-cosine-topN'
            $prov.model    | Should -Be 'all-MiniLM-L6-v2'
            $prov.score    | Should -Be 0.66
            $prov.rank     | Should -Be 1
            $prov.batch_id | Should -Be 'wsb-1'
            $prov.generated_at | Should -Not -BeNullOrEmpty
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'DRY RUN: previews counts but writes NOTHING' {
        $root = New-WsbFixture -Sits @( (New-SitNode 'sit-001') ) -Acc @( (New-PovNode 'acc-beliefs-001') )
        $prop = New-Proposal $root @( (New-Link 'sit-001' 'acc' 'acc-beliefs-001') )
        try {
            $before = Get-Content -Raw -Path (Join-Path $root 'taxonomy/Origin/situations.json')
            $sum = Add-SituationEvidenceLink -ProposalPath $prop -RepoRoot $root -DryRun 6>$null
            $sum.DryRun | Should -BeTrue
            $sum.LinksAdded | Should -Be 1
            @($sum.FilesWritten).Count | Should -Be 0
            (Get-Content -Raw -Path (Join-Path $root 'taxonomy/Origin/situations.json')) | Should -Be $before
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'is IDEMPOTENT: a re-run adds nothing and leaves the file byte-identical' {
        $root = New-WsbFixture -Sits @( (New-SitNode 'sit-001') ) -Acc @( (New-PovNode 'acc-beliefs-001') )
        $prop = New-Proposal $root @( (New-Link 'sit-001' 'acc' 'acc-beliefs-001') )
        try {
            $null = Add-SituationEvidenceLink -ProposalPath $prop -RepoRoot $root 6>$null
            $after1 = Get-Content -Raw -Path (Join-Path $root 'taxonomy/Origin/situations.json')
            $sum2 = Add-SituationEvidenceLink -ProposalPath $prop -RepoRoot $root 6>$null
            $sum2.LinksAdded      | Should -Be 0
            $sum2.SkippedExisting | Should -Be 1
            (Get-Content -Raw -Path (Join-Path $root 'taxonomy/Origin/situations.json')) | Should -Be $after1
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'COLLISION GUARD: never overwrites/duplicates/stamps an authored link' {
        # sit-001 already links acc-beliefs-001 (authored, no provenance); proposal re-proposes it.
        $root = New-WsbFixture `
            -Sits @( (New-SitNode 'sit-001' @('acc-beliefs-001')) ) `
            -Acc  @( (New-PovNode 'acc-beliefs-001' @('sit-001')) )
        $prop = New-Proposal $root @( (New-Link 'sit-001' 'acc' 'acc-beliefs-001') )
        try {
            $sum = Add-SituationEvidenceLink -ProposalPath $prop -RepoRoot $root 6>$null
            $sum.LinksAdded      | Should -Be 0
            $sum.SkippedAuthored | Should -Be 1
            $sit = Get-Sit $root 'sit-001'
            @(@($sit.linked_nodes) | Where-Object { $_ -eq 'acc-beliefs-001' }).Count | Should -Be 1   # not duplicated
            # authored link left un-stamped
            ($sit.PSObject.Properties['evidence_provenance']) | Should -BeNullOrEmpty
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'skips a dangling endpoint (non-existent situation or node), writing nothing' {
        $root = New-WsbFixture -Sits @( (New-SitNode 'sit-001') ) -Acc @( (New-PovNode 'acc-beliefs-001') )
        $prop = New-Proposal $root @(
            (New-Link 'sit-999' 'acc' 'acc-beliefs-001'),   # dangling situation
            (New-Link 'sit-001' 'acc' 'acc-nope-000')        # dangling node
        )
        try {
            $sum = Add-SituationEvidenceLink -ProposalPath $prop -RepoRoot $root 6>$null
            $sum.LinksAdded      | Should -Be 0
            $sum.SkippedDangling | Should -Be 2
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

Describe 'Add-SituationEvidenceLink — purge round-trip (t/3015)' -Tag 'taxonomy' {

    It 'PURGE restores the pre-WSB data state and never touches authored links' {
        # sit-001 has an AUTHORED link to acc-beliefs-001; the batch adds a MACHINE link to acc-beliefs-002.
        $root = New-WsbFixture `
            -Sits @( (New-SitNode 'sit-001' @('acc-beliefs-001')) ) `
            -Acc  @( (New-PovNode 'acc-beliefs-001' @('sit-001')), (New-PovNode 'acc-beliefs-002') )
        $prop = New-Proposal $root @( (New-Link 'sit-001' 'acc' 'acc-beliefs-002' 0.7 1) )
        try {
            # snapshot pre-WSB data (parsed)
            $preSitLinked = @((Get-Sit $root 'sit-001').linked_nodes | Sort-Object)
            $preNodeRefs  = @((Get-Pov $root 'accelerationist' 'acc-beliefs-002').situation_refs)

            $add = Add-SituationEvidenceLink -ProposalPath $prop -RepoRoot $root -BatchId 'wsb-1' 6>$null
            $add.LinksAdded | Should -Be 1

            $purge = Add-SituationEvidenceLink -Purge -BatchId 'wsb-1' -RepoRoot $root 6>$null
            $purge.LinksPurged | Should -Be 1

            $sit = Get-Sit $root 'sit-001'
            @($sit.linked_nodes | Sort-Object) | Should -Be $preSitLinked          # machine link gone, authored kept
            @($sit.linked_nodes) | Should -Contain 'acc-beliefs-001'               # authored survives
            ($sit.PSObject.Properties['evidence_provenance']) | Should -BeNullOrEmpty   # emptied map dropped
            $node2 = Get-Pov $root 'accelerationist' 'acc-beliefs-002'
            @($node2.situation_refs) | Should -Be $preNodeRefs                      # reverse ref removed
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'PURGE is batch-scoped: a different batch id removes nothing' {
        $root = New-WsbFixture -Sits @( (New-SitNode 'sit-001') ) -Acc @( (New-PovNode 'acc-beliefs-001') )
        $prop = New-Proposal $root @( (New-Link 'sit-001' 'acc' 'acc-beliefs-001') )
        try {
            $null = Add-SituationEvidenceLink -ProposalPath $prop -RepoRoot $root -BatchId 'wsb-1' 6>$null
            $purge = Add-SituationEvidenceLink -Purge -BatchId 'wsb-2' -RepoRoot $root 6>$null
            $purge.LinksPurged | Should -Be 0
            (Get-Sit $root 'sit-001').evidence_provenance.'acc-beliefs-001'.batch_id | Should -Be 'wsb-1'
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }
}
