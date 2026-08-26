# Tag: taxonomy
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Get-Situation — list/filter situations from situations.json. No live-data reads;
    every test builds a throwaway taxonomy/Origin via -RepoRoot.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

    function New-SituationsFixture {
        $root = Join-Path ([System.IO.Path]::GetTempPath()) "getsit-$([guid]::NewGuid().ToString('N').Substring(0,8))"
        $tax  = Join-Path $root 'taxonomy/Origin'
        New-Item -ItemType Directory -Path $tax -Force | Out-Null
        @{
            _schema_version = '1.0.0'; last_modified = '2026-01-01'
            nodes = @(
                @{ id = 'sit-001'; label = 'Alpha timeline'; description = 'A situation about existential risk timelines.'; disagreement_type = 'empirical'; linked_nodes = @('acc-beliefs-1', 'skp-beliefs-2') }
                @{ id = 'sit-002'; label = 'Beta gap';       description = 'A situation with no supporting evidence yet.'; linked_nodes = @() }
                @{ id = 'sit-003'; label = 'Gamma alignment'; description = 'A situation about technical alignment.'; linked_nodes = @('saf-beliefs-3') }
            )
        } | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $tax 'situations.json') -Encoding utf8
        return $root
    }
}

Describe 'Get-Situation' -Tag 'taxonomy' {

    It 'is exported from the module' {
        Get-Command -Module AITriad -Name 'Get-Situation' | Should -Not -BeNullOrEmpty
    }

    It 'returns all situations sorted by Id when no filter is given' {
        $root = New-SituationsFixture
        try {
            $r = @(Get-Situation -RepoRoot $root)
            $r.Count | Should -Be 3
            $r[0].Id | Should -Be 'sit-001'
            $r[2].Id | Should -Be 'sit-003'
            $r[0].PSObject.TypeNames | Should -Contain 'AITriad.Situation'
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'filters by -Id and reports per-POV evidence counts from linked_nodes (prefix-derived)' {
        $root = New-SituationsFixture
        try {
            $s = Get-Situation -Id 'sit-001' -RepoRoot $root
            @($s).Count      | Should -Be 1
            $s.LinkedNodeCount | Should -Be 2
            $s.AccEvidence   | Should -Be 1
            $s.SkpEvidence   | Should -Be 1
            $s.SafEvidence   | Should -Be 0
            $s.MachineLinked | Should -Be 0   # evidence_provenance absent pre-WSB-apply
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'wildcard -Id matches multiple' {
        $root = New-SituationsFixture
        try {
            @(Get-Situation -Id 'sit-00*' -RepoRoot $root).Count | Should -Be 3
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It '-LinkedNode finds every situation that links a given node' {
        $root = New-SituationsFixture
        try {
            $r = @(Get-Situation -LinkedNode 'acc-beliefs-1' -RepoRoot $root)
            $r.Count | Should -Be 1
            $r[0].Id | Should -Be 'sit-001'
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It '-WithLinks excludes situations with empty linked_nodes' {
        $root = New-SituationsFixture
        try {
            $ids = @(Get-Situation -WithLinks -RepoRoot $root).Id
            $ids | Should -Contain 'sit-001'
            $ids | Should -Contain 'sit-003'
            $ids | Should -Not -Contain 'sit-002'
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It '-Camp returns only situations with evidence for that POV (by prefix)' {
        $root = New-SituationsFixture
        try {
            $skp = @(Get-Situation -Camp skeptic -RepoRoot $root)
            $skp.Count | Should -Be 1
            $skp[0].Id | Should -Be 'sit-001'
            @(Get-Situation -Camp safetyist -RepoRoot $root)[0].Id | Should -Be 'sit-003'
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It '-Text and -Label match description/label (wildcards)' {
        $root = New-SituationsFixture
        try {
            @(Get-Situation -Text '*existential*' -RepoRoot $root)[0].Id | Should -Be 'sit-001'
            @(Get-Situation -Label '*alignment*'  -RepoRoot $root)[0].Id | Should -Be 'sit-003'
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'warns and returns nothing when no situation matches' {
        $root = New-SituationsFixture
        try {
            $r = Get-Situation -Id 'sit-999' -RepoRoot $root -WarningAction SilentlyContinue
            $r | Should -BeNullOrEmpty
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'reports a failure and returns nothing when situations.json is missing' {
        $root = Join-Path ([System.IO.Path]::GetTempPath()) "getsit-none-$([guid]::NewGuid().ToString('N').Substring(0,8))"
        New-Item -ItemType Directory -Path (Join-Path $root 'taxonomy/Origin') -Force | Out-Null
        try {
            $r = Get-Situation -RepoRoot $root 6>$null 2>$null
            $r | Should -BeNullOrEmpty
        } finally { Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue }
    }
}
