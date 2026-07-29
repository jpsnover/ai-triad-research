# Tag: taxonomy (t/1946)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Test-TaxonomyIntegrity -Repair edges-write regression (t/1946).
.DESCRIPTION
    The -Repair dangling-edge path was the 12th missed inline edges.json writer.
    Before t/1946 it wrote the file with `ConvertTo-Json -Depth 20 | Set-Content
    -NoNewline` — fully-pretty (contract rules 2-3 violated) AND no trailing
    newline (rule 9 violated). This test drives the repair path with a dangling
    edge present and asserts the rewritten file honours the hybrid byte contract:
    trailing LF present (no -NoNewline regression), LF-only, no BOM, compact
    per-edge line.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-TaxonomyIntegrity -Repair edges write (t/1946)' -Tag 'taxonomy' {

    It 'rewrites edges.json via Write-EdgesFile — hybrid format, trailing newline, no -NoNewline regression' {
        InModuleScope AITriad {
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "tti-repair-$(Get-Random)"
            New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
            try {
                # POV file with two valid nodes.
                @{
                    nodes = @(
                        @{ id = 'acc-beliefs-001'; pov = 'accelerationist'; label = 'A'; category = 'Beliefs'; parent_id = $null }
                        @{ id = 'acc-beliefs-002'; pov = 'accelerationist'; label = 'B'; category = 'Beliefs'; parent_id = $null }
                    )
                } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $TempDir 'accelerationist.json')

                # Minimal registry so strict-mode $Registry is assigned.
                @{ policies = @() } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $TempDir 'policy_actions.json')

                # edges.json seeded in the OLD fully-pretty format: one valid edge +
                # one dangling (target node does not exist). Ordered keys make the
                # expected compact edge deterministic.
                @{
                    _schema_version = '1.0.0'
                    last_modified   = '2026-01-01'
                    edge_types      = @('SUPPORTS')
                    edges = @(
                        [ordered]@{ source = 'acc-beliefs-001'; target = 'acc-beliefs-002'; type = 'SUPPORTS'; confidence = 0.9 }
                        [ordered]@{ source = 'acc-beliefs-001'; target = 'ghost-node-999';  type = 'SUPPORTS'; confidence = 0.5 }
                    )
                } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $TempDir 'edges.json')

                Mock Get-TaxonomyDir { $TempDir }

                Test-TaxonomyIntegrity -Repair | Out-Null

                $EdgesFile = Join-Path $TempDir 'edges.json'
                $Bytes = [System.IO.File]::ReadAllBytes($EdgesFile)

                # Rule 9 — exactly one trailing newline. This is the -NoNewline regression the fix removes.
                $Bytes[$Bytes.Length - 1] | Should -Be 10 -Because 'the repaired edges.json must end with a trailing LF'
                $Bytes[$Bytes.Length - 2] | Should -Not -Be 10 -Because 'exactly one trailing newline'

                # Rule 8 — LF-only.
                @($Bytes | Where-Object { $_ -eq 13 }).Count | Should -Be 0 -Because 'no CR bytes allowed'

                # Rule 10 — no BOM.
                ($Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF) | Should -BeFalse -Because 'UTF-8 no-BOM'

                $Text = [System.IO.File]::ReadAllText($EdgesFile)
                # Hybrid — top-level pretty, edges compacted one per line at 4-space indent.
                $Text | Should -Match '"edges": \['
                $Text | Should -Match '(?m)^    \{"source":"acc-beliefs-001","target":"acc-beliefs-002","type":"SUPPORTS","confidence":0\.9\}'
                # Dangling edge stripped.
                $Text | Should -Not -Match 'ghost-node-999'
                @(($Text | ConvertFrom-Json).edges).Count | Should -Be 1 -Because 'only the valid edge survives repair'
            }
            finally {
                Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
