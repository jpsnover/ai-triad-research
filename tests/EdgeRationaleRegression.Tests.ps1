# Tag: edges (t/2945)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    GV suite for the Arm-1 edge-rationale-regression guard (t/2945; Block flip t/2947).
    FIRE  = a write dropping rationale from an edge rationaled in the baseline -> Block throws /
            Warn warns and reports the count.
    CLEAN = a rationale-preserving write -> passes SILENTLY, zero noise.
    Plus: fail-OPEN on odd-shaped input, HEAD-baseline caching (incl. dead-lookup distinction),
    default -> Block (the flip), and POSITIVE observability (baseline resolved + payload scanned;
    emptied-array vs missing-key split). Baseline is HEAD/committed (composite-keyed).
    Edge objects are built in test scope and passed into InModuleScope (the guard is Private).
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
    # t/2955: a RAW [hashtable] edge (NOT cast to PSCustomObject). A hashtable's PSObject.Properties
    # are Count/Keys/Values, so a naive `$e.PSObject.Properties['source']` finds nothing and the edge
    # was silently skipped by the guard. -Rationale omitted => the field is absent (a genuine wipe).
    function New-HashEdge {
        param([string]$Source, [string]$Type, [string]$Target, [string]$Rationale)
        $h = @{ source = $Source; type = $Type; target = $Target; confidence = 0.95; status = 'approved' }
        if ($PSBoundParameters.ContainsKey('Rationale')) { $h['rationale'] = $Rationale }
        $h
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
            (New-Edge 'acc-001' 'SUPPORTS'    'saf-002'),
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
        $write = New-EdgesData @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002') )
        InModuleScope AITriad -Parameters @{ W = $write; B = $script:Baseline } {
            param($W, $B)
            { Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Block } | Should -Throw
        }
    }

    It 'CLEAN: a rationale-preserving add-only write passes SILENTLY with ZERO noise' {
        $write = New-EdgesData @(
            (New-Edge 'acc-001' 'SUPPORTS'    'saf-002' 'because X reinforces Y'),
            (New-Edge 'acc-003' 'CONTRADICTS' 'skp-004' 'because Z conflicts with W'),
            (New-Edge 'acc-005' 'WEAKENS'     'saf-006' 'a freshly discovered edge')
        )
        InModuleScope AITriad -Parameters @{ W = $write; B = $script:Baseline } {
            param($W, $B)
            $n = Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -WarningVariable w -WarningAction SilentlyContinue
            $n | Should -Be 0
            @($w).Count | Should -Be 0
        }
    }

    It 'CLEAN: a NEW edge with an empty rationale is not a regression (never had one in HEAD)' {
        $write = New-EdgesData @(
            (New-Edge 'acc-001' 'SUPPORTS'    'saf-002' 'because X reinforces Y'),
            (New-Edge 'acc-003' 'CONTRADICTS' 'skp-004' 'because Z conflicts with W'),
            (New-Edge 'acc-009' 'ASSUMES'     'saf-010' '')
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

    It 'FAIL-OPEN: an edges-less document returns 0 and does NOT throw — even with a rationaled baseline, even in Block mode' {
        $noEdgesObj  = [PSCustomObject]@{ nodes = @() }
        $noEdgesHash = @{ nodes = @() }
        InModuleScope AITriad -Parameters @{ O = $noEdgesObj; H = $noEdgesHash; B = $script:Baseline } {
            param($O, $H, $B)
            { Test-EdgeRationaleRegression -EdgesData $O -BaselineEdges $B -Mode Warn }  | Should -Not -Throw
            { Test-EdgeRationaleRegression -EdgesData $H -BaselineEdges $B -Mode Warn }  | Should -Not -Throw
            { Test-EdgeRationaleRegression -EdgesData $O -BaselineEdges $B -Mode Block } | Should -Not -Throw
            Test-EdgeRationaleRegression -EdgesData $O -BaselineEdges $B -Mode Warn | Should -Be 0
            Test-EdgeRationaleRegression -EdgesData $H -BaselineEdges $B -Mode Warn | Should -Be 0
        }
    }
}

Describe 'Test-EdgeRationaleRegression — Block flip + positive observability (t/2947)' -Tag 'edges' {

    BeforeEach {
        $script:Baseline = @(
            (New-Edge 'acc-001' 'SUPPORTS'    'saf-002' 'because X reinforces Y'),
            (New-Edge 'acc-003' 'CONTRADICTS' 'skp-004' 'because Z conflicts with W')
        )
    }

    It 'DEFAULT mode is now Block (the flip): a regression throws with no -Mode and env unset' {
        $write = New-EdgesData @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002') )
        InModuleScope AITriad -Parameters @{ W = $write; B = $script:Baseline } {
            param($W, $B)
            $prev = [Environment]::GetEnvironmentVariable('AI_TRIAD_EDGE_RATIONALE_GATE')
            [Environment]::SetEnvironmentVariable('AI_TRIAD_EDGE_RATIONALE_GATE', $null)
            try {
                { Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B } | Should -Throw          # default = Block
                # env override still wins: Warn downgrades to a warning
                Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -WarningAction SilentlyContinue | Should -Be 1
            } finally {
                [Environment]::SetEnvironmentVariable('AI_TRIAD_EDGE_RATIONALE_GATE', $prev)
            }
        }
    }

    It 'DEFAULT Block: a rationale-preserving write passes (0, no throw) with no -Mode' {
        $write = New-EdgesData @(
            (New-Edge 'acc-001' 'SUPPORTS'    'saf-002' 'because X reinforces Y'),
            (New-Edge 'acc-003' 'CONTRADICTS' 'skp-004' 'because Z conflicts with W')
        )
        InModuleScope AITriad -Parameters @{ W = $write; B = $script:Baseline } {
            param($W, $B)
            $prev = [Environment]::GetEnvironmentVariable('AI_TRIAD_EDGE_RATIONALE_GATE')
            [Environment]::SetEnvironmentVariable('AI_TRIAD_EDGE_RATIONALE_GATE', $null)
            try { { Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B } | Should -Not -Throw }
            finally { [Environment]::SetEnvironmentVariable('AI_TRIAD_EDGE_RATIONALE_GATE', $prev) }
        }
    }

    It 'POSITIVE observability: emits "HEAD baseline resolved — N" and "payload scanned — checked N"' {
        $write = New-EdgesData @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002' 'because X reinforces Y') )
        InModuleScope AITriad -Parameters @{ W = $write; B = $script:Baseline } {
            param($W, $B)
            $v = (Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -Verbose 4>&1) | Out-String
            $v | Should -Match 'HEAD baseline resolved — 2 rationaled key'
            $v | Should -Match 'payload scanned — checked 1 edge'
        }
    }

    It 'MESSAGE SPLIT: a missing edges KEY and an emptied edges array emit DISTINCT, non-overlapping text (CL (c) precondition)' {
        $missingKey = [PSCustomObject]@{ nodes = @() }
        $emptyArray = [PSCustomObject]@{ edges = @() }
        InModuleScope AITriad -Parameters @{ MK = $missingKey; EA = $emptyArray; B = $script:Baseline } {
            param($MK, $EA, $B)
            $vMiss  = (Test-EdgeRationaleRegression -EdgesData $MK -BaselineEdges $B -Mode Warn -Verbose 4>&1) | Out-String
            $vEmpty = (Test-EdgeRationaleRegression -EdgesData $EA -BaselineEdges $B -Mode Warn -Verbose 4>&1) | Out-String
            # Missing key: reports "no edges KEY"; NOT a payload scan.
            $vMiss  | Should -Match 'no edges KEY'
            $vMiss  | Should -Not -Match 'payload scanned'
            # Emptied array: reports a payload scan (checked 0); NOT "no edges KEY".
            $vEmpty | Should -Match 'payload scanned — checked 0 edge'
            $vEmpty | Should -Not -Match 'no edges KEY'
        }
    }
}

Describe 'Test-EdgeRationaleRegression — edge SHAPE coverage: hashtable edges are checked, not skipped (t/2955)' -Tag 'edges' {

    BeforeEach {
        $script:Baseline = @(
            (New-Edge 'acc-001' 'SUPPORTS'    'saf-002' 'because X reinforces Y'),
            (New-Edge 'acc-003' 'CONTRADICTS' 'skp-004' 'because Z conflicts with W')
        )
    }

    It 'FIRE: a rationale wipe delivered as a hashtable edge in a PSCustomObject doc THROWS in Block (was silently skipped)' {
        $write = New-EdgesData @( (New-HashEdge 'acc-001' 'SUPPORTS' 'saf-002') )   # hashtable edge, rationale absent
        InModuleScope AITriad -Parameters @{ W = $write; B = $script:Baseline } {
            param($W, $B)
            { Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Block } | Should -Throw
            Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -WarningAction SilentlyContinue | Should -Be 1
        }
    }

    It 'FIRE: a rationale wipe delivered as a hashtable edge in a HASHTABLE doc THROWS in Block' {
        $write = @{ _schema_version = '1.0.0'; edges = @( (New-HashEdge 'acc-001' 'SUPPORTS' 'saf-002') ) }  # doc AND edge are hashtables
        InModuleScope AITriad -Parameters @{ W = $write; B = $script:Baseline } {
            param($W, $B)
            { Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Block } | Should -Throw
            Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -WarningAction SilentlyContinue | Should -Be 1
        }
    }

    It 'CONTROL: the same wipe as a PSCustomObject edge also throws (parity across shapes)' {
        $write = New-EdgesData @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002') )
        InModuleScope AITriad -Parameters @{ W = $write; B = $script:Baseline } {
            param($W, $B)
            { Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Block } | Should -Throw
        }
    }

    It 'CLEAN: a rationale-PRESERVING hashtable edge passes SILENTLY with zero noise (both-arms clean case)' {
        $write = New-EdgesData @( (New-HashEdge 'acc-001' 'SUPPORTS' 'saf-002' 'because X reinforces Y') )
        InModuleScope AITriad -Parameters @{ W = $write; B = $script:Baseline } {
            param($W, $B)
            $n = Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -WarningVariable w -WarningAction SilentlyContinue
            $n | Should -Be 0
            @($w).Count | Should -Be 0
        }
    }

    It 'SKIPPED counter is accurate: a well-formed hashtable edge is CHECKED (checked 1, skipped 0), not skipped for its container type' {
        $write = New-EdgesData @( (New-HashEdge 'acc-001' 'SUPPORTS' 'saf-002' 'because X reinforces Y') )
        InModuleScope AITriad -Parameters @{ W = $write; B = $script:Baseline } {
            param($W, $B)
            $v = (Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -Verbose 4>&1) | Out-String
            $v | Should -Match 'payload scanned — checked 1 edge\(s\), skipped 0'
        }
    }

    It 'SKIPPED counter still counts a genuinely malformed edge (missing key fields), regardless of container type' {
        $write = New-EdgesData @( (New-HashEdge 'acc-001' 'SUPPORTS' 'saf-002' 'keep me'), @{ confidence = 0.5 } )  # 2nd edge lacks source/type/target
        InModuleScope AITriad -Parameters @{ W = $write; B = $script:Baseline } {
            param($W, $B)
            $v = (Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -Verbose 4>&1) | Out-String
            $v | Should -Match 'payload scanned — checked 1 edge\(s\), skipped 1'
        }
    }

    It 'BASELINE shape: a hashtable baseline edge is honored too (its rationale protects the key)' {
        $hashBaseline = @( (New-HashEdge 'acc-001' 'SUPPORTS' 'saf-002' 'committed rationale') )
        $write        = New-EdgesData @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002') )   # drops it
        InModuleScope AITriad -Parameters @{ W = $write; B = $hashBaseline } {
            param($W, $B)
            Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -WarningAction SilentlyContinue | Should -Be 1
        }
    }
}

Describe 'Test-EdgeRationaleRegression — HEAD baseline resolution + caching (git-backed, real repo)' -Tag 'edges' {

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
            Write-EdgesFile -EdgesData $Committed -Path $EdgesPath
            Push-Location $Repo
            try { git init -q 2>$null; git config user.email 't@t' 2>$null; git config user.name 't' 2>$null; git add -A 2>$null; git commit -q -m 'baseline' 2>$null } finally { Pop-Location }
            Test-EdgeRationaleRegression -EdgesData $Strip -Path $EdgesPath -Mode Warn -WarningAction SilentlyContinue | Should -Be 1
            Test-EdgeRationaleRegression -EdgesData $Ok -Path $EdgesPath -Mode Warn | Should -Be 0
        }
    }

    It 'caches the HEAD baseline per (path @ HEAD); the second call reports its cache hit' {
        $repo = Join-Path $TestDrive 'cacherepo'
        $tax  = Join-Path $repo 'taxonomy/Origin'
        New-Item -ItemType Directory -Path $tax -Force | Out-Null
        $edgesPath = Join-Path $tax 'edges.json'
        $committed = New-EdgesData @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002' 'committed rationale') )
        $strip     = New-EdgesData @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002') )
        InModuleScope AITriad -Parameters @{ Committed = $committed; Strip = $strip; EdgesPath = $edgesPath; Repo = $repo } {
            param($Committed, $Strip, $EdgesPath, $Repo)
            Write-EdgesFile -EdgesData $Committed -Path $EdgesPath
            Push-Location $Repo
            try { git init -q 2>$null; git config user.email 't@t' 2>$null; git config user.name 't' 2>$null; git add -A 2>$null; git commit -q -m b 2>$null } finally { Pop-Location }
            $script:EdgeHeadBaselineCache = @{}
            Test-EdgeRationaleRegression -EdgesData $Strip -Path $EdgesPath -Mode Warn -WarningAction SilentlyContinue | Should -Be 1
            @($script:EdgeHeadBaselineCache.Keys).Count | Should -BeGreaterThan 0
            $v = (Test-EdgeRationaleRegression -EdgesData $Strip -Path $EdgesPath -Mode Warn -Verbose -WarningAction SilentlyContinue 4>&1) | Out-String
            $v | Should -Match 'cache hit — 1 committed baseline edge'   # resolved baseline, not dead-lookup
        }
    }

    It 't/2953: a committed-but-EMPTY edges array baseline fails open with its OWN distinguishable verbose on the FIRST (uncached) resolution' {
        $repo = Join-Path $TestDrive 'emptybaselinerepo'
        $tax  = Join-Path $repo 'taxonomy/Origin'
        New-Item -ItemType Directory -Path $tax -Force | Out-Null
        $edgesPath = Join-Path $tax 'edges.json'
        $committed = New-EdgesData @()                                        # committed { "edges": [] }
        $write     = New-EdgesData @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002' 'new edge') )
        InModuleScope AITriad -Parameters @{ Committed = $committed; Write = $write; EdgesPath = $edgesPath; Repo = $repo } {
            param($Committed, $Write, $EdgesPath, $Repo)
            Write-EdgesFile -EdgesData $Committed -Path $EdgesPath
            Push-Location $Repo
            try { git init -q 2>$null; git config user.email 't@t' 2>$null; git config user.name 't' 2>$null; git add -A 2>$null; git commit -q -m empty 2>$null } finally { Pop-Location }
            $script:EdgeHeadBaselineCache = @{}
            # FIRST (uncached) resolution: returns 0 (fail-open) AND emits ≥1 verbose naming the empty shape.
            $v = (Test-EdgeRationaleRegression -EdgesData $Write -Path $EdgesPath -Mode Warn -Verbose 4>&1) | Out-String
            (Test-EdgeRationaleRegression -EdgesData $Write -Path $EdgesPath -Mode Block) | Should -Be 0   # fails OPEN, no throw
            $v | Should -Match 'EMPTY edges array'
            # Distinct from the other fail-open strings (not conflatable by a payload-scan classifier).
            $v | Should -Not -Match 'has no edges array'
            $v | Should -Not -Match 'not found in the repo'
            $v | Should -Not -Match 'payload scanned'
        }
    }

    It 'S-1: a DEAD-lookup (edges.json not committed) reports a DISTINCT cache-hit message on call 2' {
        $repo = Join-Path $TestDrive 'deadrepo'
        $tax  = Join-Path $repo 'taxonomy/Origin'
        New-Item -ItemType Directory -Path $tax -Force | Out-Null
        $edgesPath = Join-Path $tax 'edges.json'
        $strip     = New-EdgesData @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002') )
        InModuleScope AITriad -Parameters @{ Strip = $strip; EdgesPath = $edgesPath; Repo = $repo; Tax = $tax } {
            param($Strip, $EdgesPath, $Repo, $Tax)
            # Commit SOMETHING so HEAD exists, but leave edges.json uncommitted -> HEAD:edges.json is absent.
            Set-Content -Path (Join-Path $Repo 'readme.txt') -Value 'x' -Encoding utf8
            Write-EdgesFile -EdgesData $Strip -Path $EdgesPath   # on-disk only, never committed
            Push-Location $Repo
            try { git init -q 2>$null; git config user.email 't@t' 2>$null; git config user.name 't' 2>$null; git add readme.txt 2>$null; git commit -q -m init 2>$null } finally { Pop-Location }
            $script:EdgeHeadBaselineCache = @{}
            Test-EdgeRationaleRegression -EdgesData $Strip -Path $EdgesPath -Mode Warn | Should -Be 0   # no baseline -> fail-open
            $v = (Test-EdgeRationaleRegression -EdgesData $Strip -Path $EdgesPath -Mode Warn -Verbose 4>&1) | Out-String
            $v | Should -Match 'cache hit — NO committed baseline \(dead-lookup\)'
        }
    }
}

Describe 'Test-EdgeRationaleRegression — hadRationale map memoization (t/2951)' -Tag 'edges' {

    It 'memoizes the derived map under path@HEAD-sha: call 2 reports a map cache hit and still fires' {
        $repo = Join-Path $TestDrive 'maprepo'
        $tax  = Join-Path $repo 'taxonomy/Origin'
        New-Item -ItemType Directory -Path $tax -Force | Out-Null
        $edgesPath = Join-Path $tax 'edges.json'
        $committed = New-EdgesData @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002' 'committed rationale') )
        $strip     = New-EdgesData @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002') )
        InModuleScope AITriad -Parameters @{ Committed = $committed; Strip = $strip; EdgesPath = $edgesPath; Repo = $repo } {
            param($Committed, $Strip, $EdgesPath, $Repo)
            Write-EdgesFile -EdgesData $Committed -Path $EdgesPath
            Push-Location $Repo
            try { git init -q 2>$null; git config user.email 't@t' 2>$null; git config user.name 't' 2>$null; git add -A 2>$null; git commit -q -m b 2>$null } finally { Pop-Location }
            $script:EdgeHeadBaselineCache = @{}
            $script:EdgeHadRationaleCache = @{}
            # Call 1: builds the map (cold) — reports the resolved baseline, NOT a map cache hit.
            $v1 = (Test-EdgeRationaleRegression -EdgesData $Strip -Path $EdgesPath -Mode Warn -Verbose -WarningAction SilentlyContinue 4>&1) | Out-String
            $v1 | Should -Match 'HEAD baseline resolved — 1 rationaled key'
            $v1 | Should -Not -Match 'map cache hit'
            @($script:EdgeHadRationaleCache.Keys).Count | Should -BeGreaterThan 0
            # Call 2: same path@HEAD -> the memoized map is reused, and the verdict is unchanged.
            $n2 = Test-EdgeRationaleRegression -EdgesData $Strip -Path $EdgesPath -Mode Warn -Verbose -WarningVariable w -WarningAction SilentlyContinue -InformationAction SilentlyContinue
            $v2 = (Test-EdgeRationaleRegression -EdgesData $Strip -Path $EdgesPath -Mode Warn -Verbose -WarningAction SilentlyContinue 4>&1) | Out-String
            $n2 | Should -Be 1                                  # still fires — memoization changes cost, not verdict
            $v2 | Should -Match 'hadRationale map cache hit — 1 rationaled key'
        }
    }

    It 'does NOT memoize an INJECTED baseline: the map cache stays empty and never reports a hit' {
        $baseline = @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002' 'because X reinforces Y') )
        $strip    = New-EdgesData @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002') )
        InModuleScope AITriad -Parameters @{ B = $baseline; W = $strip } {
            param($B, $W)
            $script:EdgeHadRationaleCache = @{}
            $v = (Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -Verbose -WarningAction SilentlyContinue 4>&1) | Out-String
            (Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -WarningAction SilentlyContinue) | Should -Be 1
            $v | Should -Not -Match 'map cache hit'
            @($script:EdgeHadRationaleCache.Keys).Count | Should -Be 0   # injected baselines have no cache identity
        }
    }
}

Describe 'Test-EdgeRationaleRegression — per-element null/fault resilience in the payload scan (t/2951)' -Tag 'edges' {

    BeforeEach {
        $script:Baseline = @(
            (New-Edge 'acc-001' 'SUPPORTS'    'saf-002' 'because X reinforces Y'),
            (New-Edge 'acc-003' 'CONTRADICTS' 'skp-004' 'because Z conflicts with W')
        )
    }

    It 'a $null element does NOT whole-file fail-open: the surviving edges are still evaluated and a real regression is still detected' {
        # A $null between two real edges — one of which strips a HEAD-rationaled edge. Before t/2951
        # the $null tripped the whole-body catch and the guard returned 0 (silent fail-open) for the
        # entire file, missing the wipe. Now the $null is skipped individually and the wipe still fires.
        $write = New-EdgesData @(
            (New-Edge 'acc-001' 'SUPPORTS'    'saf-002'),                                 # strips rationale (regression)
            $null,                                                                          # malformed element
            (New-Edge 'acc-003' 'CONTRADICTS' 'skp-004' 'because Z conflicts with W')      # preserved
        )
        InModuleScope AITriad -Parameters @{ W = $write; B = $script:Baseline } {
            param($W, $B)
            Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -WarningAction SilentlyContinue | Should -Be 1
            { Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Block } | Should -Throw
        }
    }

    It 'surfaces the null-skip count in the payload-scanned line, distinct from the missing-key-fields skip' {
        $write = New-EdgesData @(
            (New-Edge 'acc-001' 'SUPPORTS' 'saf-002' 'because X reinforces Y'),           # checked
            $null                                                                          # null-skipped
        )
        InModuleScope AITriad -Parameters @{ W = $write; B = $script:Baseline } {
            param($W, $B)
            $v = (Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -Verbose -WarningAction SilentlyContinue 4>&1) | Out-String
            $v | Should -Match 'payload scanned — checked 1 edge\(s\), skipped 0 \(missing key fields\)'
            $v | Should -Match '1 null element'
        }
    }

    It 'ZERO new noise on the all-valid path: no null/faulted clause when there are none' {
        $write = New-EdgesData @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002' 'because X reinforces Y') )
        InModuleScope AITriad -Parameters @{ W = $write; B = $script:Baseline } {
            param($W, $B)
            $v = (Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -Verbose -WarningAction SilentlyContinue 4>&1) | Out-String
            $v | Should -Match 'payload scanned — checked 1 edge'
            $v | Should -Not -Match 'null element'
            $v | Should -Not -Match 'faulted element'
        }
    }
}

Describe 'Test-EdgeRationaleRegression — twin-aware edge identity (t/2956)' -Tag 'edges' {

    BeforeAll {
        # An edge with discovered_at + optional model, for building twin (shared-near-key) cases.
        function New-TwinEdge {
            param([string]$Source, [string]$Type, [string]$Target, [string]$DiscoveredAt, [string]$Model, [string]$Rationale)
            $o = [ordered]@{ source = $Source; type = $Type; target = $Target; confidence = 0.85; status = 'approved'; discovered_at = $DiscoveredAt }
            if ($PSBoundParameters.ContainsKey('Model'))     { $o['model'] = $Model }
            if ($PSBoundParameters.ContainsKey('Rationale')) { $o['rationale'] = $Rationale }
            [pscustomobject]$o
        }
        # CL directive (t/2956#4): load the SHARED fixture by PATH — do not transcribe it. Reading the
        # exact bytes the TS suite reads is what makes drift detectable; a copied fixture defeats it.
        $script:TwinFixturePath = Join-Path $PSScriptRoot '..' 'research' 'comp-linguist' 'analyses' 't2444-rationale-restore' 'twin-fixture.json'
    }

    # --- Real near-key defect: the current bare-near-key guard FALSE-POSITIVES on an innocent twin
    #     (never had rationale) written empty on a key another twin rationaled → a spurious Block.
    #     Twin-aware identity attributes per specific edge, so the innocent twin is not flagged. ---
    It 'does NOT false-flag an innocent twin (never had rationale) written empty on a rationaled twin key' {
        $baseline = @(
            (New-TwinEdge 'acc-beliefs-051' 'SUPPORTS' 'acc-desires-001' '2026-04-06' 'gemini-2.5-flash' 'twin A carried this'),
            (New-TwinEdge 'acc-beliefs-051' 'SUPPORTS' 'acc-desires-001' '2026-06-11' 'llm_proposed')   # twin B: never had one
        )
        $write = New-EdgesData @(
            (New-TwinEdge 'acc-beliefs-051' 'SUPPORTS' 'acc-desires-001' '2026-04-06' 'gemini-2.5-flash' 'twin A carried this'),  # kept
            (New-TwinEdge 'acc-beliefs-051' 'SUPPORTS' 'acc-desires-001' '2026-06-11' 'llm_proposed')                             # empty, legitimately
        )
        InModuleScope AITriad -Parameters @{ W = $write; B = $baseline } {
            param($W, $B)
            Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -WarningAction SilentlyContinue | Should -Be 0
            { Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Block } | Should -Not -Throw
        }
    }

    It 'detects a drop on the rationaled twin PRECISELY (count 1, not 2) while its innocent twin is written empty' {
        $baseline = @(
            (New-TwinEdge 'acc-beliefs-051' 'SUPPORTS' 'acc-desires-001' '2026-04-06' 'gemini-2.5-flash' 'twin A carried this'),
            (New-TwinEdge 'acc-beliefs-051' 'SUPPORTS' 'acc-desires-001' '2026-06-11' 'llm_proposed')   # never had one
        )
        $write = New-EdgesData @(
            (New-TwinEdge 'acc-beliefs-051' 'SUPPORTS' 'acc-desires-001' '2026-04-06' 'gemini-2.5-flash'),  # DROP (twin A stripped)
            (New-TwinEdge 'acc-beliefs-051' 'SUPPORTS' 'acc-desires-001' '2026-06-11' 'llm_proposed')       # empty, never had one
        )
        InModuleScope AITriad -Parameters @{ W = $write; B = $baseline } {
            param($W, $B)
            Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -WarningAction SilentlyContinue | Should -Be 1
            { Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Block } | Should -Throw
        }
    }

    It 'AC#3: INDISTINGUISHABLE twins (same key AND discovered_at AND model) -> refuse-and-log, fail-open, NO throw, distinguishable verbose' {
        $baseline = @(
            (New-TwinEdge 'acc-beliefs-069' 'SUPPORTS' 'acc-intentions-054' '2026-04-06' 'gemini-2.5-flash' 'twin A rationale'),
            (New-TwinEdge 'acc-beliefs-069' 'SUPPORTS' 'acc-intentions-054' '2026-04-06' 'gemini-2.5-flash' 'twin B rationale')  # same discriminator
        )
        $write = New-EdgesData @(
            (New-TwinEdge 'acc-beliefs-069' 'SUPPORTS' 'acc-intentions-054' '2026-04-06' 'gemini-2.5-flash'),   # both stripped
            (New-TwinEdge 'acc-beliefs-069' 'SUPPORTS' 'acc-intentions-054' '2026-04-06' 'gemini-2.5-flash')
        )
        InModuleScope AITriad -Parameters @{ W = $write; B = $baseline } {
            param($W, $B)
            $v = (Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -Verbose -WarningAction SilentlyContinue 4>&1) | Out-String
            (Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Block) | Should -Be 0   # fail-OPEN, never throws
            $v | Should -Match 'INDISTINGUISHABLE'
            $v | Should -Match 'refuse-and-log'
        }
    }

    It 'mixed: an indistinguishable twin key is skipped + surfaced in the payload scan while other keys are still guarded' {
        $baseline = @(
            (New-Edge 'acc-001' 'SUPPORTS' 'saf-002' 'guarded singleton'),
            (New-TwinEdge 'x-1' 'SUPPORTS' 'y-1' '2026-01-01' 'm' 'twin A'),
            (New-TwinEdge 'x-1' 'SUPPORTS' 'y-1' '2026-01-01' 'm' 'twin B')   # indistinguishable
        )
        $write = New-EdgesData @(
            (New-Edge 'acc-001' 'SUPPORTS' 'saf-002' 'guarded singleton'),    # kept
            (New-TwinEdge 'x-1' 'SUPPORTS' 'y-1' '2026-01-01' 'm'),           # stripped
            (New-TwinEdge 'x-1' 'SUPPORTS' 'y-1' '2026-01-01' 'm')            # stripped
        )
        InModuleScope AITriad -Parameters @{ W = $write; B = $baseline } {
            param($W, $B)
            $v = (Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -Verbose -WarningAction SilentlyContinue 4>&1) | Out-String
            Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -WarningAction SilentlyContinue | Should -Be 0
            $v | Should -Match 'Skipped 2 edge\(s\) on indistinguishable twin key'
        }
    }

    # --- Non-empty predicate conformance with the TS hasRationale (CL t/2956#4; twin-independent) ---
    It 'CONFORMANCE: rationale of "" or whitespace counts as ABSENT (a drop), matching the TS hasRationale' {
        $baseline = @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002' 'because X reinforces Y') )
        $emptyStr = New-EdgesData @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002' '') )
        $wsOnly   = New-EdgesData @( (New-Edge 'acc-001' 'SUPPORTS' 'saf-002' '   ') )
        InModuleScope AITriad -Parameters @{ E = $emptyStr; Wsp = $wsOnly; B = $baseline } {
            param($E, $Wsp, $B)
            Test-EdgeRationaleRegression -EdgesData $E   -BaselineEdges $B -Mode Warn -WarningAction SilentlyContinue | Should -Be 1
            Test-EdgeRationaleRegression -EdgesData $Wsp -BaselineEdges $B -Mode Warn -WarningAction SilentlyContinue | Should -Be 1
            { Test-EdgeRationaleRegression -EdgesData $E -BaselineEdges $B -Mode Block } | Should -Throw
        }
    }

    It 'CLEAN (AC#5): distinguishable twins that each KEEP their own rationale pass silently, zero noise' {
        $baseline = @(
            (New-TwinEdge 'acc-beliefs-051' 'SUPPORTS' 'acc-desires-001' '2026-04-06' 'gemini-2.5-flash' 'twin A rationale'),
            (New-TwinEdge 'acc-beliefs-051' 'SUPPORTS' 'acc-desires-001' '2026-06-11' 'llm_proposed'      'twin B rationale')
        )
        $write = New-EdgesData @(
            (New-TwinEdge 'acc-beliefs-051' 'SUPPORTS' 'acc-desires-001' '2026-04-06' 'gemini-2.5-flash' 'twin A rationale'),
            (New-TwinEdge 'acc-beliefs-051' 'SUPPORTS' 'acc-desires-001' '2026-06-11' 'llm_proposed'      'twin B rationale')
        )
        InModuleScope AITriad -Parameters @{ W = $write; B = $baseline } {
            param($W, $B)
            $n = Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -WarningVariable w -WarningAction SilentlyContinue
            $n | Should -Be 0
            @($w).Count | Should -Be 0
        }
    }

    # --- Conformance against the SHARED fixture (loaded by path), so the PS model provably matches
    #     the TS mergeEdgesPreservingRationale model rather than drifting. ---
    It 'FIXTURE case_a (observed): distinguishable twins, both stripped on save -> both drops detected' {
        $fx = Get-Content -Raw -LiteralPath $script:TwinFixturePath | ConvertFrom-Json
        $baseline = @($fx.case_a_distinguishable.on_disk.edges)
        $write    = [pscustomobject]@{ _schema_version = '1.0.0'; edges = @($fx.case_a_distinguishable.save_payload.edges) }
        InModuleScope AITriad -Parameters @{ W = $write; B = $baseline } {
            param($W, $B)
            Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -WarningAction SilentlyContinue | Should -Be 2
            { Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Block } | Should -Throw
        }
    }

    It 'FIXTURE case_b (constructed): indistinguishable twins -> refuse-and-log, fail-open, NO throw' {
        $fx = Get-Content -Raw -LiteralPath $script:TwinFixturePath | ConvertFrom-Json
        $baseline = @($fx.case_b_indistinguishable.on_disk.edges)
        $write    = [pscustomobject]@{ _schema_version = '1.0.0'; edges = @($fx.case_b_indistinguishable.save_payload.edges) }
        InModuleScope AITriad -Parameters @{ W = $write; B = $baseline } {
            param($W, $B)
            $v = (Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Warn -Verbose -WarningAction SilentlyContinue 4>&1) | Out-String
            (Test-EdgeRationaleRegression -EdgesData $W -BaselineEdges $B -Mode Block) | Should -Be 0   # fail-open, never throws
            $v | Should -Match 'INDISTINGUISHABLE'
        }
    }
}
