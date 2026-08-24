# Tag: taxonomy (t/2974)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Coercion-free edges.json read primitive (t/2974): ConvertFrom-EdgesJson / Read-EdgesFile.
    PS 7.4 ConvertFrom-Json coerces a full-ISO discovered_at to [datetime]; ConvertTo-Json then
    drops trailing-zero milliseconds (.440Z -> .44Z) on the whole-file write-back, silently
    mutating untargeted rows. These lock: (1) timestamps stay verbatim [string] through the read;
    (2) a read -> Write-EdgesFile round-trip is byte-identical for trailing-zero ms; (3) the
    index-aligned string restore does NOT drift when only a LATER-index edge has a trailing zero.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
}

Describe 'ConvertFrom-EdgesJson — coercion-free parse (t/2974)' -Tag 'taxonomy' {

    It 'keeps a full-ISO discovered_at as a verbatim [string], NOT a coerced [datetime]' {
        InModuleScope AITriad {
            $json = '{"edges":[{"source":"a","type":"SUPPORTS","target":"b","discovered_at":"2026-08-20T18:55:33.440Z"}]}'
            $o = ConvertFrom-EdgesJson -Json $json
            $da = $o.edges[0].discovered_at
            $da | Should -BeOfType [string]
            $da | Should -Be '2026-08-20T18:55:33.440Z'   # trailing zero intact
        }
    }

    It 'preserves a no-fractional timestamp verbatim (does not gain .000)' {
        InModuleScope AITriad {
            $o = ConvertFrom-EdgesJson -Json '{"edges":[{"source":"a","type":"SUPPORTS","target":"b","discovered_at":"2026-06-19T10:00:21Z"}]}'
            $o.edges[0].discovered_at | Should -BeOfType [string]
            $o.edges[0].discovered_at | Should -Be '2026-06-19T10:00:21Z'
        }
    }

    It 'restores a top-level datetime field (last_modified with a time component) to a string' {
        InModuleScope AITriad {
            $o = ConvertFrom-EdgesJson -Json '{"last_modified":"2026-07-29T00:00:00Z","edges":[]}'
            $o.last_modified | Should -BeOfType [string]
            $o.last_modified | Should -Be '2026-07-29T00:00:00Z'
        }
    }

    It 'leaves a date-only string untouched and keeps number/bool/null types' {
        InModuleScope AITriad {
            $json = '{"last_modified":"2026-08-24","edges":[{"source":"a","type":"SUPPORTS","target":"b","confidence":0.85,"weight":1,"bidirectional":false,"strength":null,"discovered_at":"2026-04-06"}]}'
            $o = ConvertFrom-EdgesJson -Json $json
            $o.last_modified               | Should -Be '2026-08-24'
            $o.edges[0].discovered_at      | Should -Be '2026-04-06'   # date-only never coerced
            $o.edges[0].confidence         | Should -BeOfType [double]
            $o.edges[0].weight             | Should -BeOfType [long]
            $o.edges[0].bidirectional      | Should -BeOfType [bool]
            $o.edges[0].strength           | Should -BeNullOrEmpty
        }
    }
}

Describe 'ConvertFrom-EdgesJson -> Write-EdgesFile round-trip byte contract (t/2974)' -Tag 'taxonomy' {

    It 'round-trips trailing-zero milliseconds BYTE-IDENTICALLY (.440Z / .830Z), not .44Z / .83Z' {
        $OutPath = Join-Path ([System.IO.Path]::GetTempPath()) "cfe-rt-$(Get-Random).json"
        try {
            $json = '{"_schema_version":"1.0.0","last_modified":"2026-08-24","edges":[' +
                '{"source":"acc-beliefs-122","type":"SUPPORTS","target":"acc-beliefs-003","confidence":0.9,"rationale":"r","status":"approved","discovered_at":"2026-08-20T18:55:33.440Z","model":"debate-reflection"},' +
                '{"source":"skp-beliefs-303","type":"TENSION_WITH","target":"skp-beliefs-239","confidence":0.9,"rationale":"r","status":"approved","discovered_at":"2026-08-20T21:05:39.830Z","model":"debate-reflection"}]}'
            InModuleScope AITriad -Parameters @{ Json = $json; OutPath = $OutPath } {
                param($Json, $OutPath)
                $data = ConvertFrom-EdgesJson -Json $Json
                Write-EdgesFile -EdgesData $data -Path $OutPath
            }
            $text = [System.IO.File]::ReadAllText($OutPath)
            $text | Should -Match '"discovered_at":"2026-08-20T18:55:33\.440Z"'
            $text | Should -Match '"discovered_at":"2026-08-20T21:05:39\.830Z"'
            $text | Should -Not -Match '\.44Z'
            $text | Should -Not -Match '\.83Z'
        }
        finally { if (Test-Path -LiteralPath $OutPath) { Remove-Item -LiteralPath $OutPath -Force } }
    }

    It 'INDEX PARITY (TL t/2974#2): the string restore does NOT drift when only a LATER-index edge has a trailing zero' {
        $OutPath = Join-Path ([System.IO.Path]::GetTempPath()) "cfe-idx-$(Get-Random).json"
        try {
            # edge[0] has NO discovered_at; edge[1] has a NON-trailing-zero ms; edge[2] is the ONLY
            # trailing-zero (.440Z). If the JsonDocument/ConvertFrom-Json index alignment drifted,
            # the .440Z would land on the wrong edge — this proves it lands on edge[2] and nowhere else.
            $json = '{"_schema_version":"1.0.0","edges":[' +
                '{"source":"n0","type":"SUPPORTS","target":"t0","rationale":"no discovered_at here"},' +
                '{"source":"n1","type":"SUPPORTS","target":"t1","discovered_at":"2026-06-19T10:00:21.441Z"},' +
                '{"source":"n2","type":"SUPPORTS","target":"t2","discovered_at":"2026-08-20T18:55:33.440Z"}]}'
            # NOTE: re-read the written file with the COERCION-FREE reader — a plain ConvertFrom-Json
            # here would re-coerce discovered_at to [datetime] and defeat a byte-exact assertion.
            $reread = InModuleScope AITriad -Parameters @{ Json = $json; OutPath = $OutPath } {
                param($Json, $OutPath)
                $data = ConvertFrom-EdgesJson -Json $Json
                Write-EdgesFile -EdgesData $data -Path $OutPath
                ConvertFrom-EdgesJson -Json ([System.IO.File]::ReadAllText($OutPath))
            }
            $text = [System.IO.File]::ReadAllText($OutPath)
            # Byte-exact in the written file — no coercion artifacts (7-digit round-trip / trimmed zero).
            $text | Should -Match '"2026-06-19T10:00:21\.441Z"'
            $text | Should -Match '"2026-08-20T18:55:33\.440Z"'
            $text | Should -Not -Match '\.4410000Z'
            $text | Should -Not -Match '\.4400000Z'
            $text | Should -Not -Match '\.44Z'
            # Structural no-drift: each value landed on the RIGHT edge, none drifted onto edge[0].
            @($reread.edges).Count | Should -Be 3
            $reread.edges[0].source | Should -Be 'n0'
            $reread.edges[0].PSObject.Properties['discovered_at'] | Should -BeNullOrEmpty
            $reread.edges[1].discovered_at | Should -Be '2026-06-19T10:00:21.441Z'
            $reread.edges[2].discovered_at | Should -Be '2026-08-20T18:55:33.440Z'
        }
        finally { if (Test-Path -LiteralPath $OutPath) { Remove-Item -LiteralPath $OutPath -Force } }
    }
}
