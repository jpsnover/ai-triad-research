# Tag: edges (t/2944)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Write-EdgesFile round-trip contract for `rationale_source` (t/2944 un-gated AC; the PS
    mirror of the TS serializeEdges round-trip test in #1432). The serialization SINK must
    PRESERVE the field — an edge that carries `rationale_source` survives write -> re-read
    unchanged, and one that lacks it stays absent (the sink never invents provenance; that's
    the writers' job, per research/comp-linguist/designs/edge-rationale-source-marker.md).
    This locks the sink's byte-preservation contract for the field landed in t/2943 / #1432.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
}

Describe 'Write-EdgesFile — rationale_source round-trip (t/2944)' -Tag 'edges' {

    It 'PRESERVES rationale_source on an edge that carries it (write -> re-read unchanged)' {
        $data = [pscustomobject]@{
            _schema_version = '1.0.0'
            edges = @(
                [pscustomobject]@{ source = 'acc-001'; type = 'SUPPORTS'; target = 'saf-002'; rationale = 'because X'; rationale_source = 'backfill' }
            )
        }
        $p = Join-Path $TestDrive 'edges-with-source.json'
        InModuleScope AITriad -Parameters @{ Data = $data; Path = $p } {
            param($Data, $Path)
            Write-EdgesFile -EdgesData $Data -Path $Path
            $rt = (Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json).edges[0]
            $rt.rationale_source | Should -Be 'backfill'
            $rt.rationale        | Should -Be 'because X'   # sibling field intact
        }
    }

    It 'does NOT invent rationale_source on an edge that lacks it (stays absent)' {
        $data = [pscustomobject]@{
            _schema_version = '1.0.0'
            edges = @(
                [pscustomobject]@{ source = 'acc-003'; type = 'WEAKENS'; target = 'saf-004'; rationale = 'because Y' }
            )
        }
        $p = Join-Path $TestDrive 'edges-no-source.json'
        InModuleScope AITriad -Parameters @{ Data = $data; Path = $p } {
            param($Data, $Path)
            Write-EdgesFile -EdgesData $Data -Path $Path
            $rt = (Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json).edges[0]
            $rt.PSObject.Properties['rationale_source'] | Should -BeNullOrEmpty
        }
    }

    It 'preserves a mix (one edge with, one without) independently in the same file' {
        $data = [pscustomobject]@{
            _schema_version = '1.0.0'
            edges = @(
                [pscustomobject]@{ source = 'acc-001'; type = 'SUPPORTS'; target = 'saf-002'; rationale = 'r1'; rationale_source = 'discovery' }
                [pscustomobject]@{ source = 'acc-003'; type = 'WEAKENS';  target = 'saf-004'; rationale = 'r2' }
            )
        }
        $p = Join-Path $TestDrive 'edges-mixed.json'
        InModuleScope AITriad -Parameters @{ Data = $data; Path = $p } {
            param($Data, $Path)
            Write-EdgesFile -EdgesData $Data -Path $Path
            $edges = @((Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json).edges)
            ($edges | Where-Object { $_.source -eq 'acc-001' }).rationale_source | Should -Be 'discovery'
            ($edges | Where-Object { $_.source -eq 'acc-003' })[0].PSObject.Properties['rationale_source'] | Should -BeNullOrEmpty
        }
    }
}
