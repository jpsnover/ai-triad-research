# Tag: enrichment (t/1550)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Covers Invoke-AphorismBatch + New-NodeAphorism / Set-NodeAphorism helpers (t/1550).
.DESCRIPTION
    Verifies the filter matrix (pillar, deprecated, empty, up-to-date, -Id,
    -Force), the write-back to graph_attributes.aphorism, and the fail-open
    contract of the write-path helpers. All AI calls are mocked.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    $script:FixtureDir = Join-Path ([System.IO.Path]::GetTempPath()) "aphorism-t1550-$(Get-Random)"
    $null = New-Item -ItemType Directory -Path $script:FixtureDir -Force

    # Synthetic 3-file POV set with a mix of node types so the filters have
    # something to reject: one live node, one deprecated, one pillar, one short.
    $mkNode = {
        param($id, $cat, $label, $desc, $graphAttrs = $null)
        $n = [ordered]@{
            id = $id; category = $cat; label = $label; description = $desc
            parent_id = $null; children = @(); situation_refs = @()
        }
        if ($graphAttrs) { $n.graph_attributes = $graphAttrs }
        [PSCustomObject]$n
    }

    $accData = [PSCustomObject]@{
        _schema_version = '1.0.0'; _doc = 'test'; pov = 'accelerationist'
        color_hex = '#27AE60'; last_modified = '2026-07-12'
        nodes = @(
            (& $mkNode 'acc-desires-001' 'Desires' 'Abundance' 'A Desire within accelerationist discourse that abundance follows compute — investment yields human flourishing.')
            (& $mkNode 'acc-beliefs-002' 'Beliefs' 'Pillar' 'A thematic pillar grouping child beliefs about markets and momentum.')
            (& $mkNode 'acc-beliefs-003' 'Beliefs' 'Deprecated' '[DEPRECATED] Old belief text superseded.')
            (& $mkNode 'acc-beliefs-004' 'Beliefs' 'HasAphorism' 'A Belief within accelerationist discourse that the universe was always going to compute — history is momentum.' ([PSCustomObject]@{ aphorism = 'The universe was always going to compute.' }))
        )
    }
    $safData = [PSCustomObject]@{
        _schema_version = '1.0.0'; _doc = 'test'; pov = 'safetyist'
        color_hex = '#E74C3C'; last_modified = '2026-07-12'
        nodes = @(
            (& $mkNode 'saf-beliefs-001' 'Beliefs' 'Alignment' 'A Belief within safetyist discourse that the alignment problem is unsolved — deployment without alignment invites harm.')
            (& $mkNode 'saf-desires-002' 'Desires' 'Short' 'too short')  # fails 20-char minimum
        )
    }
    $skpData = [PSCustomObject]@{
        _schema_version = '1.0.0'; _doc = 'test'; pov = 'skeptic'
        color_hex = '#F39C12'; last_modified = '2026-07-12'
        nodes = @(
            (& $mkNode 'skp-beliefs-001' 'Beliefs' 'Hype' 'A Belief within skeptic discourse that AI hype is a business model — capabilities are marketed, not measured.')
        )
    }
    $accData | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $script:FixtureDir 'accelerationist.json') -Encoding UTF8
    $safData | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $script:FixtureDir 'safetyist.json') -Encoding UTF8
    $skpData | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $script:FixtureDir 'skeptic.json') -Encoding UTF8
}

AfterAll {
    if ($script:FixtureDir -and (Test-Path $script:FixtureDir)) {
        Remove-Item -Recurse -Force -Path $script:FixtureDir -ErrorAction SilentlyContinue
    }
}

Describe 'Invoke-AphorismBatch filters (t/1550)' -Tag 'enrichment' {

    It 'Processes eligible nodes only; skips pillar, deprecated, short, up-to-date' {
        InModuleScope AITriad -Parameters @{ FD = $script:FixtureDir } {
            param($FD)
            Mock Get-Prompt -MockWith { 'RENDERED PROMPT' }
            Mock Invoke-AIByUsage -MockWith {
                [PSCustomObject]@{ Text = 'Mock aphorism.'; Backend = 'stub'; Model = 'stub' }
            }

            $r = Invoke-AphorismBatch -TaxonomyPath $FD -Concurrency 1 6>$null

            # Eligible: acc-desires-001, saf-beliefs-001, skp-beliefs-001 = 3
            # Skipped: pillar (acc-beliefs-002), deprecated (acc-beliefs-003),
            #          up-to-date (acc-beliefs-004), too-short (saf-desires-002) = 4
            $r.Generated | Should -Be 3
            $r.Skipped   | Should -Be 4
            $r.Failed    | Should -Be 0
        }
    }

    It '-Id restricts processing to specific node(s)' {
        InModuleScope AITriad -Parameters @{ FD = $script:FixtureDir } {
            param($FD)
            Mock Get-Prompt -MockWith { 'RENDERED' }
            Mock Invoke-AIByUsage -MockWith {
                [PSCustomObject]@{ Text = 'Solo aphorism.'; Backend = 'stub'; Model = 'stub' }
            }

            # -Force bypasses the aphorism written by the prior test in this fixture.
            $r = Invoke-AphorismBatch -TaxonomyPath $FD -Id 'saf-beliefs-001' -Force -Concurrency 1 6>$null

            $r.Generated | Should -Be 1
            # All other nodes counted under one of the skip buckets
        }
    }

    It '-Force regenerates even when aphorism already exists' {
        InModuleScope AITriad -Parameters @{ FD = $script:FixtureDir } {
            param($FD)
            Mock Get-Prompt -MockWith { 'RENDERED' }
            Mock Invoke-AIByUsage -MockWith {
                [PSCustomObject]@{ Text = 'Regenerated.'; Backend = 'stub'; Model = 'stub' }
            }

            $r = Invoke-AphorismBatch -TaxonomyPath $FD -Id 'acc-beliefs-004' -Force -Concurrency 1 6>$null

            $r.Generated | Should -Be 1
        }
    }

    It 'Writes aphorism to graph_attributes.aphorism and preserves other graph_attributes' {
        # Isolated per-test copy so we can inspect the written file without
        # cross-test pollution.
        InModuleScope AITriad {
            $isolated = Join-Path ([System.IO.Path]::GetTempPath()) "aphorism-t1550-write-$(Get-Random)"
            $null = New-Item -ItemType Directory -Path $isolated -Force
            try {
                $data = [PSCustomObject]@{
                    _schema_version = '1.0.0'; _doc = 'x'; pov = 'skeptic'
                    color_hex = '#F39C12'; last_modified = '2026-07-12'
                    nodes = @(
                        [PSCustomObject]@{
                            id = 'skp-beliefs-100'; category = 'Beliefs'; label = 'x'
                            description = 'A Belief within skeptic discourse that structural incentives shape AI-hype cycles — capital chases narrative, not capability.'
                            parent_id = $null; children = @(); situation_refs = @()
                            graph_attributes = [PSCustomObject]@{ steelman_vulnerability = 'preserved' }
                        }
                    )
                }
                foreach ($f in @('accelerationist.json', 'safetyist.json', 'skeptic.json')) {
                    if ($f -eq 'skeptic.json') {
                        $data | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $isolated $f) -Encoding UTF8
                    } else {
                        # empty POV file so the loop doesn't warn
                        [PSCustomObject]@{
                            _schema_version = '1.0.0'; _doc = 'x'; pov = ($f -replace '.json','')
                            color_hex = '#000000'; last_modified = '2026-07-12'; nodes = @()
                        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $isolated $f) -Encoding UTF8
                    }
                }

                Mock Get-Prompt -MockWith { 'RENDERED' }
                Mock Invoke-AIByUsage -MockWith {
                    [PSCustomObject]@{ Text = 'Follow the money, not the model.'; Backend = 'stub'; Model = 'stub' }
                }

                $null = Invoke-AphorismBatch -TaxonomyPath $isolated -Concurrency 1 6>$null

                $written = Get-Content (Join-Path $isolated 'skeptic.json') -Raw | ConvertFrom-Json
                $node = $written.nodes[0]
                $node.graph_attributes.aphorism              | Should -Be 'Follow the money, not the model.'
                $node.graph_attributes.steelman_vulnerability | Should -Be 'preserved' -Because 'existing graph_attributes must survive the write'
            } finally {
                Remove-Item -Recurse -Force -Path $isolated -ErrorAction SilentlyContinue
            }
        }
    }
}

Describe 'New-NodeAphorism / Set-NodeAphorism write-path helpers (t/1550)' -Tag 'enrichment' {

    It 'New-NodeAphorism returns the trimmed aphorism on success' {
        InModuleScope AITriad {
            Mock Get-Prompt -MockWith { 'RENDERED' }
            Mock Invoke-AIByUsage -MockWith {
                [PSCustomObject]@{ Text = '"Quoted aphorism."'; Backend = 'stub'; Model = 'stub' }
            }
            $node = [PSCustomObject]@{
                id = 'acc-beliefs-999'; label = 'x'; category = 'Beliefs'
                description = 'A Belief within accelerationist discourse that the universe rewards computation and momentum.'
            }
            $r = New-NodeAphorism -Node $node -Pov 'accelerationist'
            $r | Should -Be 'Quoted aphorism.'
        }
    }

    It 'New-NodeAphorism returns $null (fail-open) when the AI call throws' {
        InModuleScope AITriad {
            Mock Get-Prompt -MockWith { 'RENDERED' }
            Mock Invoke-AIByUsage -MockWith { throw 'API down' }
            $node = [PSCustomObject]@{
                id = 'saf-beliefs-999'; label = 'x'; category = 'Beliefs'
                description = 'A Belief within safetyist discourse that alignment failures compound at scale.'
            }
            $r = New-NodeAphorism -Node $node -Pov 'safetyist' -WarningAction SilentlyContinue
            $r | Should -BeNullOrEmpty -Because 'fail-open contract — enrichment never blocks the underlying write'
        }
    }

    It 'New-NodeAphorism skips situations (sit-* / cc-* out of v1 scope)' {
        InModuleScope AITriad {
            Mock Invoke-AIByUsage -MockWith { throw 'should not be called' }
            $node = [PSCustomObject]@{
                id = 'sit-001'; label = 'x'; category = 'Beliefs'
                description = 'A Belief within a situation that should be skipped by v1 scope rules.'
            }
            $r = New-NodeAphorism -Node $node -Pov 'situations'
            $r | Should -BeNullOrEmpty
        }
    }

    It 'New-NodeAphorism skips pillars and deprecated nodes' {
        InModuleScope AITriad {
            Mock Invoke-AIByUsage -MockWith { throw 'should not be called' }
            $pillar = [PSCustomObject]@{
                id = 'acc-beliefs-010'; label = 'x'; category = 'Beliefs'
                description = 'A thematic pillar grouping child beliefs.'
            }
            $deprecated = [PSCustomObject]@{
                id = 'acc-beliefs-011'; label = 'x'; category = 'Beliefs'
                description = '[DEPRECATED] Old text still long enough to pass the length check but excluded by prefix.'
            }
            New-NodeAphorism -Node $pillar     -Pov 'accelerationist' | Should -BeNullOrEmpty
            New-NodeAphorism -Node $deprecated -Pov 'accelerationist' | Should -BeNullOrEmpty
        }
    }

    It 'Set-NodeAphorism writes to graph_attributes.aphorism when generation succeeds' {
        InModuleScope AITriad {
            Mock Get-Prompt -MockWith { 'RENDERED' }
            Mock Invoke-AIByUsage -MockWith {
                [PSCustomObject]@{ Text = 'Ship it, own it.'; Backend = 'stub'; Model = 'stub' }
            }
            $node = [PSCustomObject]@{
                id = 'acc-intentions-001'; label = 'x'; category = 'Intentions'
                description = 'An Intention within accelerationist discourse that shipping fast beats waiting for perfect governance.'
            }
            Set-NodeAphorism -Node $node -Pov 'accelerationist'
            $node.graph_attributes.aphorism | Should -Be 'Ship it, own it.'
        }
    }

    It 'Set-NodeAphorism leaves node untouched when generation fails (fail-open)' {
        InModuleScope AITriad {
            Mock Get-Prompt -MockWith { 'RENDERED' }
            Mock Invoke-AIByUsage -MockWith { throw 'timeout' }
            $node = [PSCustomObject]@{
                id = 'saf-intentions-001'; label = 'x'; category = 'Intentions'
                description = 'An Intention within safetyist discourse that pause-and-audit precedes deploy at scale.'
            }
            Set-NodeAphorism -Node $node -Pov 'safetyist' -WarningAction SilentlyContinue
            $node.PSObject.Properties['graph_attributes'] | Should -BeNullOrEmpty
        }
    }
}
