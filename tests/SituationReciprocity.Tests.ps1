# Tag: taxonomy (t/2979)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Situation <-> POV reciprocity (t/2979): the Test-TaxonomyIntegrity Check 10 WARN-first guard
    (both asymmetry classes) + the Repair-SituationReciprocity reconciliation backfill (union both
    directions, existing-endpoint only, idempotent, dry-run-first). No spend, no live-data writes —
    every test builds a throwaway taxonomy dir.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

    # Build a throwaway taxonomy/Origin with the given situation + POV nodes. $Sits/$Acc/$Saf/$Skp
    # are arrays of [ordered] node hashtables. Returns the repo root (parent of taxonomy/Origin).
    function New-ReciprocityFixture {
        param($Sits = @(), $Acc = @(), $Saf = @(), $Skp = @())
        $root = Join-Path ([System.IO.Path]::GetTempPath()) "recip-$([guid]::NewGuid().ToString('N').Substring(0,8))"
        $tax  = Join-Path $root 'taxonomy/Origin'
        New-Item -ItemType Directory -Path $tax -Force | Out-Null
        @{ _schema_version = '1.0.0'; last_modified = '2026-01-01'; nodes = @($Sits) } | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $tax 'situations.json') -Encoding utf8
        @{ _schema_version = '1.0.0'; pov = 'accelerationist'; last_modified = '2026-01-01'; nodes = @($Acc) } | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $tax 'accelerationist.json') -Encoding utf8
        @{ _schema_version = '1.0.0'; pov = 'safetyist'; last_modified = '2026-01-01'; nodes = @($Saf) } | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $tax 'safetyist.json') -Encoding utf8
        @{ _schema_version = '1.0.0'; pov = 'skeptic'; last_modified = '2026-01-01'; nodes = @($Skp) } | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $tax 'skeptic.json') -Encoding utf8
        # Minimal registry so Test-TaxonomyIntegrity's report ($Registry.policies.Count) has a value
        # (it reads policy_actions.json; the real data dir always has one).
        @{ policies = @() } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $tax 'policy_actions.json') -Encoding utf8
        return $root
    }
    function New-SitNode  { param($Id, $Linked = @()) [ordered]@{ id = $Id; label = $Id; linked_nodes = @($Linked) } }
    function New-PovNode  { param($Id, $Refs = @())   [ordered]@{ id = $Id; category = 'Beliefs'; label = $Id; situation_refs = @($Refs) } }
}

Describe 'Test-TaxonomyIntegrity — situation reciprocity guard (t/2979, warn-first)' -Tag 'taxonomy' {

    It 'FIRE: reports BOTH asymmetry classes (forward-only + reverse-only) as a Warning' {
        $root = New-ReciprocityFixture `
            -Sits @( (New-SitNode 'sit-001' @('acc-b-1')), (New-SitNode 'sit-002' @()) ) `
            -Acc  @( (New-PovNode 'acc-b-1' @()) ) `
            -Skp  @( (New-PovNode 'skp-b-1' @('sit-002')) )
        try {
            InModuleScope AITriad -Parameters @{ Root = $root } {
                param($Root)
                Mock Get-TaxonomyDir { Join-Path $Root 'taxonomy/Origin' }
                $r = Test-TaxonomyIntegrity -PassThru 6>$null
                $recip = @($r.Details | Where-Object { $_.Check -eq 'SituationReciprocity' })
                @($recip).Count | Should -Be 1
                $recip[0].Severity | Should -Be 'Warning'
                $recip[0].Count    | Should -Be 2   # 1 forward-only + 1 reverse-only
                $recip[0].Detail   | Should -Match 'forward-only'
                $recip[0].Detail   | Should -Match 'reverse-only'
            }
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'CLEAN: a fully-reciprocal pair produces NO SituationReciprocity issue' {
        $root = New-ReciprocityFixture `
            -Sits @( (New-SitNode 'sit-001' @('acc-b-1')) ) `
            -Acc  @( (New-PovNode 'acc-b-1' @('sit-001')) )
        try {
            InModuleScope AITriad -Parameters @{ Root = $root } {
                param($Root)
                Mock Get-TaxonomyDir { Join-Path $Root 'taxonomy/Origin' }
                $r = Test-TaxonomyIntegrity -PassThru 6>$null
                @($r.Details | Where-Object { $_.Check -eq 'SituationReciprocity' }) | Should -BeNullOrEmpty
            }
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'a dangling situation_ref is NOT a reciprocity asymmetry (that is Check 8)' {
        $root = New-ReciprocityFixture `
            -Skp @( (New-PovNode 'skp-b-1' @('sit-999')) )   # sit-999 does not exist
        try {
            InModuleScope AITriad -Parameters @{ Root = $root } {
                param($Root)
                Mock Get-TaxonomyDir { Join-Path $Root 'taxonomy/Origin' }
                $r = Test-TaxonomyIntegrity -PassThru 6>$null
                @($r.Details | Where-Object { $_.Check -eq 'SituationReciprocity' }) | Should -BeNullOrEmpty
            }
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

Describe 'Repair-SituationReciprocity — reconciliation backfill (t/2979)' -Tag 'taxonomy' {

    It 'is exported from the module' {
        Get-Command -Module AITriad -Name 'Repair-SituationReciprocity' | Should -Not -BeNullOrEmpty
    }

    It 'REVERSE-only: projects situation_refs -> linked_nodes (recovers the invisible situation)' {
        $root = New-ReciprocityFixture `
            -Sits @( (New-SitNode 'sit-002' @()) ) `
            -Skp  @( (New-PovNode 'skp-b-1' @('sit-002')) )
        try {
            $sum = Repair-SituationReciprocity -RepoRoot $root 6>$null
            $sum.ReverseAdded | Should -Be 1
            $sum.ForwardAdded | Should -Be 0
            $sit = (Get-Content -Raw -Path (Join-Path $root 'taxonomy/Origin/situations.json') | ConvertFrom-Json).nodes[0]
            @($sit.linked_nodes) | Should -Contain 'skp-b-1'
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'FORWARD-only: projects linked_nodes -> situation_refs' {
        $root = New-ReciprocityFixture `
            -Sits @( (New-SitNode 'sit-001' @('acc-b-1')) ) `
            -Acc  @( (New-PovNode 'acc-b-1' @()) )
        try {
            $sum = Repair-SituationReciprocity -RepoRoot $root 6>$null
            $sum.ForwardAdded | Should -Be 1
            $sum.ReverseAdded | Should -Be 0
            $node = (Get-Content -Raw -Path (Join-Path $root 'taxonomy/Origin/accelerationist.json') | ConvertFrom-Json).nodes[0]
            @($node.situation_refs) | Should -Contain 'sit-001'
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'is IDEMPOTENT: a second run reconciles nothing' {
        $root = New-ReciprocityFixture `
            -Sits @( (New-SitNode 'sit-002' @()) ) `
            -Skp  @( (New-PovNode 'skp-b-1' @('sit-002')) )
        try {
            $null = Repair-SituationReciprocity -RepoRoot $root 6>$null
            $again = Repair-SituationReciprocity -RepoRoot $root 6>$null
            $again.ForwardAdded | Should -Be 0
            $again.ReverseAdded | Should -Be 0
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'does NOT reconcile a dangling ref into existence (leaves it for Test-TaxonomyIntegrity -Repair)' {
        $root = New-ReciprocityFixture `
            -Sits @( (New-SitNode 'sit-001' @('acc-999')) ) `
            -Skp  @( (New-PovNode 'skp-b-1' @('sit-999')) )
        try {
            $sum = Repair-SituationReciprocity -RepoRoot $root 6>$null
            $sum.ForwardAdded | Should -Be 0
            $sum.ReverseAdded | Should -Be 0
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'DRY RUN: reports the reconciliation but writes NOTHING' {
        $root = New-ReciprocityFixture `
            -Sits @( (New-SitNode 'sit-002' @()) ) `
            -Skp  @( (New-PovNode 'skp-b-1' @('sit-002')) )
        try {
            $before = Get-Content -Raw -Path (Join-Path $root 'taxonomy/Origin/situations.json')
            $sum = Repair-SituationReciprocity -RepoRoot $root -DryRun 6>$null
            $sum.DryRun       | Should -BeTrue
            $sum.ReverseAdded | Should -Be 1
            @($sum.FilesWritten).Count | Should -Be 0
            (Get-Content -Raw -Path (Join-Path $root 'taxonomy/Origin/situations.json')) | Should -Be $before
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }
}
