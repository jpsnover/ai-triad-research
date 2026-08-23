# Tag: edges (t/2945)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Both-arms GV for the Arm-1 edge-rationale-regression guard (t/2945, TL design e/120#19/#24).
    FIRE  = a write dropping rationale from an edge rationaled in the baseline -> Block throws /
            Warn emits a loud warning and reports the count.
    CLEAN = a normal add-only, rationale-preserving write -> passes SILENTLY, zero noise.
    Baseline is HEAD/committed (composite-keyed source|type|target). The injected-baseline arms
    are deterministic (no git); the git-backed context proves the HEAD-resolution path end-to-end.
    Edge objects are built in test scope and passed into InModuleScope (the guard is Private).
    Coverage note (CL.Investigate1 e/120#22): this PS-sink guard covers PS writers + the pipeline
    re-emit; the editor/server saves use the TS writeEdgesFile twin and are guarded separately.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

    function New-Edge {
        param([string]$Source, [string]$Type, [string]$Target, [string]$Rationale = $null)
        $o = [ordered]@{ source = $Source; type = $Type; target = $Target; confidence = 0.95; status = 'approved' }
        if ($null -ne $Rationale) { $o['rationale'] = $Rationale }
        [PSCustomObject]$o
    }
    function New-EdgesData {
        param([object[]]$Edges)
        [PSCustomObject]@{ _schema_version = '1.0.0'; edges = @($Edges) }
    }
}

Describe 'Test-EdgeRationaleRegression — Arm 1 both-arms (t/2945)' -Tag 'edges' {

    BeforeEach {
        $script:Baseline = @(
            (New-Edge 'acc-001' 'SUPPORTS'    'saf-002' 'because X reinforces Y'),
            (New-Edge 'acc-003' 'CONTRADICTS' 'skp-004' 'because Z conflicts with W')
        )
    }

    It 'FIRE (Warn): a write dropping rationale from a HEAD-rationaled edge warns and counts it' {
        $write = New-EdgesData @(
            (New-Edge 'acc-001' 'SUPPORTS'    'saf-002'),                          # rationale dropped
            (New-Edge 'acc-003' 'CONTRADICTS' 'skp-004' 'because Z conflicts with W')
        )
        InModuleScope AITriad -Parameters @{ W = $write; B = $script:Baseline } {
            param($W, $B)
            $n = Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -WarningVariable w -WarningAction SilentlyContinue
            $n | Should -Be 1
            ($w -join ' ') | Should -Match 'EDGE-RATIONALE REGRESSION'
        }
    }

    It 'FIRE (Block): the same write THROWS New-ActionableError and writes nothing' {
        $write = New-EdgesData @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002') )       # rationale dropped
        InModuleScope AITriad -Parameters @{ W = $write; B = $script:Baseline } {
            param($W, $B)
            { Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Block } | Should -Throw
        }
    }

    It 'CLEAN: a rationale-preserving add-only write passes SILENTLY with ZERO noise' {
        $write = New-EdgesData @(
            (New-Edge 'acc-001' 'SUPPORTS'    'saf-002' 'because X reinforces Y'),
            (New-Edge 'acc-003' 'CONTRADICTS' 'skp-004' 'because Z conflicts with W'),
            (New-Edge 'acc-005' 'WEAKENS'     'saf-006' 'a freshly discovered edge')   # new, rationaled
        )
        InModuleScope AITriad -Parameters @{ W = $write; B = $script:Baseline } {
            param($W, $B)
            $n = Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -WarningVariable w -WarningAction SilentlyContinue
            $n | Should -Be 0
            @($w).Count | Should -Be 0   # zero noise on a legit write (gate signal integrity)
        }
    }

    It 'CLEAN: a NEW edge with an empty rationale is not a regression (never had one in HEAD)' {
        $write = New-EdgesData @(
            (New-Edge 'acc-001' 'SUPPORTS'    'saf-002' 'because X reinforces Y'),
            (New-Edge 'acc-003' 'CONTRADICTS' 'skp-004' 'because Z conflicts with W'),
            (New-Edge 'acc-009' 'ASSUMES'     'saf-010' '')   # new edge, blank rationale — allowed
        )
        InModuleScope AITriad -Parameters @{ W = $write; B = $script:Baseline } {
            param($W, $B)
            Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn | Should -Be 0
        }
    }

    It 'Off mode is a no-op even on a real regression' {
        $write = New-EdgesData @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002') )
        InModuleScope AITriad -Parameters @{ W = $write; B = $script:Baseline } {
            param($W, $B)
            Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Off | Should -Be 0
        }
    }
}

Describe 'Test-EdgeRationaleRegression — HEAD baseline resolution (git-backed, real repo)' -Tag 'edges' {

    It 'resolves the baseline from HEAD and fires on a same-file rationale strip; clean on add-only' {
        $repo = Join-Path $TestDrive 'datarepo'
        $tax  = Join-Path $repo 'taxonomy/Origin'
        New-Item -ItemType Directory -Path $tax -Force | Out-Null
        $edgesPath = Join-Path $tax 'edges.json'

        $committed = New-EdgesData @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002' 'committed rationale') )
        $strip     = New-EdgesData @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002') )
        $ok        = New-EdgesData @(
            (New-Edge 'acc-001' 'SUPPORTS' 'saf-002' 'committed rationale'),
            (New-Edge 'acc-007' 'WEAKENS'  'saf-008' 'new')
        )

        InModuleScope AITriad -Parameters @{ Committed = $committed; Strip = $strip; Ok = $ok; EdgesPath = $edgesPath; Repo = $repo } {
            param($Committed, $Strip, $Ok, $EdgesPath, $Repo)
            Write-EdgesFile -EdgesData $Committed -Path $EdgesPath   # no HEAD yet -> guard fail-open no-op
            Push-Location $Repo
            try {
                git init -q 2>$null
                git config user.email 't@t' 2>$null; git config user.name 't' 2>$null
                git add -A 2>$null; git commit -q -m 'baseline' 2>$null
            } finally { Pop-Location }

            # Baseline resolved from HEAD: a same-file strip regresses.
            Test-EdgeRationaleRegression -EdgesData $Strip -Path $EdgesPath -Mode Warn -WarningAction SilentlyContinue | Should -Be 1
            # Add-only preserving write is clean against the same HEAD.
            Test-EdgeRationaleRegression -EdgesData $Ok -Path $EdgesPath -Mode Warn | Should -Be 0
        }
    }
}
