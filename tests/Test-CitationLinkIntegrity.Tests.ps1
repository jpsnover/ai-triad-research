# Tag: config (t/3598)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Test-CitationLinkIntegrity — advisory referential-integrity gate (t/3598).
    Both arms proven per leg (CL-locked predicate): a real dead link / dangling source /
    stale hash / wrong key count FAILS; a clean corpus PASSES. Pure over committed files.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force

    function script:WriteJson($path, $obj) {
        $dir = Split-Path $path -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        Set-Content -LiteralPath $path -Value ($obj | ConvertTo-Json -Depth 12) -Encoding utf8NoBOM
    }

    # Build an isolated fixture data tree. $Opts overrides let each scenario inject a defect.
    function script:New-CliFixture {
        param([hashtable]$Opts = @{})
        $fx  = Join-Path ([System.IO.Path]::GetTempPath()) ("cli-" + [guid]::NewGuid().ToString('N'))
        $tax = Join-Path $fx 'taxonomy'
        $sum = Join-Path $fx 'summaries'
        $src = Join-Path $fx 'sources'
        New-Item -ItemType Directory -Force -Path $tax, $sum, $src | Out-Null

        # Live nodes: 2 belief (acc-beliefs-010, saf-beliefs-201), 1 situation (sit-001)
        script:WriteJson (Join-Path $tax 'accelerationist.json') @{ pov='acc'; nodes=@(@{ id='acc-beliefs-010' }) }
        script:WriteJson (Join-Path $tax 'safetyist.json')       @{ pov='saf'; nodes=@(@{ id='saf-beliefs-201' }) }
        script:WriteJson (Join-Path $tax 'skeptic.json')         @{ pov='skp'; nodes=@() }
        script:WriteJson (Join-Path $tax 'situations.json')      @{ nodes=@(@{ id='sit-001' }) }

        # Clean summaries: all refs live; doc-beta uses a CHUNK-SUFFIXED doc_id (base resolves).
        script:WriteJson (Join-Path $sum 'doc-alpha.json') @{
            doc_id = 'src-alpha'
            pov_summaries = @{ saf = @{ key_points = @(@{ taxonomy_node_id='saf-beliefs-201'; verbatim='q1'; extraction_confidence=0.8 }) } }
            factual_claims = @(@{ claim='c1'; doc_position='p1'; evidence_criteria='strong'; extraction_confidence=0.7; linked_taxonomy_nodes=@('acc-beliefs-010','sit-001') })
        }
        script:WriteJson (Join-Path $sum 'doc-beta.json') @{
            doc_id = 'src-beta-2026-3'   # chunk -3 after year → only BASE src-beta-2026 dir exists → resolves via year-aware strip
            pov_summaries = @{ saf = @{ key_points = @(@{ taxonomy_node_id='saf-beliefs-201'; verbatim='q2'; extraction_confidence=0.6 }) } }
        }
        script:WriteJson (Join-Path $sum 'doc-gamma.json') @{
            doc_id = 'src-gamma-2026-1'  # chunk dir exists on its OWN → resolves as-is (no strip)
            pov_summaries = @{ saf = @{ key_points = @(@{ taxonomy_node_id='saf-beliefs-201'; verbatim='q3'; extraction_confidence=0.5 }) } }
        }
        # Optional defect: an extra summary with dead refs (leg-a fail arm)
        if ($Opts.ContainsKey('DeadRefs') -and $Opts.DeadRefs) {
            script:WriteJson (Join-Path $sum 'doc-dead.json') @{
                doc_id = 'src-alpha'
                pov_summaries = @{ skp = @{ key_points = @(@{ taxonomy_node_id='saf-dead-999'; verbatim='x' }) } }
                factual_claims = @(@{ claim='cx'; linked_taxonomy_nodes=@('sit-999') })
            }
        }
        # Optional defect: a summary whose source base does NOT resolve (leg-b dangle arm)
        if ($Opts.ContainsKey('DangleSource') -and $Opts.DangleSource) {
            script:WriteJson (Join-Path $sum 'doc-gone.json') @{
                doc_id = 'src-gone'
                pov_summaries = @{ saf = @{ key_points = @(@{ taxonomy_node_id='saf-beliefs-201'; verbatim='qz' }) } }
            }
        }

        # Source dirs: src-alpha + src-beta (base of src-beta-3) resolve; src-gone intentionally absent.
        script:WriteJson (Join-Path $src 'src-alpha/metadata.json')          @{ id='src-alpha';          title='Alpha' }
        script:WriteJson (Join-Path $src 'src-beta-2026/metadata.json')      @{ id='src-beta-2026';      title='Beta (base only)' }   # doc_id src-beta-2026-3 resolves here via strip
        script:WriteJson (Join-Path $src 'src-gamma-2026-1/metadata.json')   @{ id='src-gamma-2026-1';   title='Gamma (chunk dir exists)' } # doc_id src-gamma-2026-1 resolves as-is

        # Build the real source_index so the header inputHash is correct for leg (c).
        $idxPath = Join-Path $tax 'source_index.json'
        Build-NodeSourceIndex -SummariesDir $sum -TaxonomyDir $tax -OutputPath $idxPath | Out-Null

        [pscustomobject]@{ Fx=$fx; Tax=$tax; Sum=$sum; Src=$src; Index=$idxPath }
    }

    function script:RunCli($f) {
        Test-CitationLinkIntegrity -SummariesDir $f.Sum -TaxonomyDir $f.Tax -SourceIndexPath $f.Index -SourcesRoot $f.Src -WarningAction SilentlyContinue
    }
    function script:Leg($r, $leg) { $r.results | Where-Object { $_.leg -eq $leg } }

    $script:Fixtures = [System.Collections.Generic.List[string]]::new()
}

AfterAll {
    foreach ($p in $script:Fixtures) { if (Test-Path $p) { Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue } }
}

Describe 'Test-CitationLinkIntegrity (t/3598)' -Tag 'config' {

    It 'is exported and callable' {
        Get-Command Test-CitationLinkIntegrity -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
    }

    It 'CLEAN corpus PASSES all three legs (incl. chunk-suffixed source_id resolving to base)' {
        $f = script:New-CliFixture; $script:Fixtures.Add($f.Fx)
        $r = script:RunCli $f
        $r.pass | Should -BeTrue
        (script:Leg $r 'a').pass | Should -BeTrue
        (script:Leg $r 'b').pass | Should -BeTrue   # src-beta-3 → src-beta resolves
        (script:Leg $r 'c').pass | Should -BeTrue
    }

    It 'LEG A FAILS on a dead belief id AND a dead situation id (class-aware)' {
        $f = script:New-CliFixture @{ DeadRefs = $true }; $script:Fixtures.Add($f.Fx)
        $r = script:RunCli $f
        $a = script:Leg $r 'a'
        $a.pass | Should -BeFalse
        @($a.offenders.ref) | Should -Contain 'saf-dead-999'
        @($a.offenders.ref) | Should -Contain 'sit-999'
        ($a.offenders | Where-Object ref -eq 'sit-999').class | Should -Be 'situation'
        # legs b/c still pass (index rebuilt over this summary set)
        (script:Leg $r 'b').pass | Should -BeTrue
        (script:Leg $r 'c').pass | Should -BeTrue
    }

    It 'LEG B FAILS on a dangling source (base dir absent) but not on chunk-suffixed ones' {
        $f = script:New-CliFixture @{ DangleSource = $true }; $script:Fixtures.Add($f.Fx)
        $r = script:RunCli $f
        $b = script:Leg $r 'b'
        $b.pass | Should -BeFalse
        @($b.offenders.source_id) | Should -Contain 'src-gone'
        @($b.offenders.source_id) | Should -Not -Contain 'src-beta-2026-3'    # resolves via year-aware base strip
        @($b.offenders.source_id) | Should -Not -Contain 'src-gamma-2026-1'   # resolves as-is (chunk dir exists)
        @($b.offenders.source_id) | Should -Not -Contain 'src-alpha'
    }

    It 'LEG C FAILS (stale hash) when a summary changes after the index was built' {
        $f = script:New-CliFixture; $script:Fixtures.Add($f.Fx)
        # mutate a summary AFTER the index was built → stored inputHash != recomputed
        script:WriteJson (Join-Path $f.Sum 'doc-alpha.json') @{
            doc_id='src-alpha'; pov_summaries=@{ saf=@{ key_points=@(@{ taxonomy_node_id='saf-beliefs-201'; verbatim='MUTATED' }) } }
        }
        $r = script:RunCli $f
        $c = script:Leg $r 'c'
        $c.pass | Should -BeFalse
        @($c.offenders.kind) | Should -Contain 'stale-hash'
    }

    It 'LEG C FAILS (key count) when the index key count != live-node count' {
        $f = script:New-CliFixture; $script:Fixtures.Add($f.Fx)
        # drop a key from the built index so keyCount(1) != liveNodes(2)
        $ix = Get-Content -Raw -LiteralPath $f.Index | ConvertFrom-Json
        $ix.index.PSObject.Properties.Remove('acc-beliefs-010')
        Set-Content -LiteralPath $f.Index -Value ($ix | ConvertTo-Json -Depth 12) -Encoding utf8NoBOM
        $r = script:RunCli $f
        $c = script:Leg $r 'c'
        $c.pass | Should -BeFalse
        @($c.offenders.kind) | Should -Contain 'key-count'
    }

    It 'is advisory: never throws on offenders, and reports the blocking toggle state' {
        $f = script:New-CliFixture @{ DeadRefs = $true; DangleSource = $true }; $script:Fixtures.Add($f.Fx)
        { script:RunCli $f } | Should -Not -Throw
        (script:RunCli $f).blocking | Should -BeFalse   # stays advisory until SO/TL-GV flip
    }
}
