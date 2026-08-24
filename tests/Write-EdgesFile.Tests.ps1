# Tag: taxonomy (t/1943)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    $FixtureDir   = Join-Path $PSScriptRoot 'fixtures' 'edges-format'
    $InputPath    = Join-Path $FixtureDir 'input.json'
    $ExpectedPath = Join-Path $FixtureDir 'expected.json'
}

Describe 'Write-EdgesFile (t/1943: edges.json byte contract)' -Tag 'taxonomy' {

    It 'Reproduces the golden fixture byte-for-byte' {
        $OutPath = Join-Path ([System.IO.Path]::GetTempPath()) "write-edges-$(Get-Random).json"
        try {
            $Data = Get-Content -Raw -LiteralPath $InputPath | ConvertFrom-Json
            InModuleScope AITriad -Parameters @{ Data = $Data; OutPath = $OutPath } {
                param($Data, $OutPath)
                Write-EdgesFile -EdgesData $Data -Path $OutPath
            }

            $ExpectedBytes = [System.IO.File]::ReadAllBytes($ExpectedPath)
            $ActualBytes   = [System.IO.File]::ReadAllBytes($OutPath)

            # Byte comparison — NOT -eq on parsed objects. The contract is byte-level.
            $ActualBytes.Length | Should -Be $ExpectedBytes.Length -Because 'output must be byte-identical to expected.json'

            $FirstDiff = -1
            for ($i = 0; $i -lt $ExpectedBytes.Length; $i++) {
                if ($ExpectedBytes[$i] -ne $ActualBytes[$i]) { $FirstDiff = $i; break }
            }
            $FirstDiff | Should -Be -1 -Because 'no byte may differ from the golden fixture'
        }
        finally {
            if (Test-Path -LiteralPath $OutPath) { Remove-Item -LiteralPath $OutPath -Force }
        }
    }

    It 'Emits LF-only line endings with no CR' {
        $OutPath = Join-Path ([System.IO.Path]::GetTempPath()) "write-edges-crlf-$(Get-Random).json"
        try {
            $Data = Get-Content -Raw -LiteralPath $InputPath | ConvertFrom-Json
            InModuleScope AITriad -Parameters @{ Data = $Data; OutPath = $OutPath } {
                param($Data, $OutPath)
                Write-EdgesFile -EdgesData $Data -Path $OutPath
            }
            $Bytes = [System.IO.File]::ReadAllBytes($OutPath)
            @($Bytes | Where-Object { $_ -eq 13 }).Count | Should -Be 0 -Because 'the file must contain no CR (0x0D) bytes'
        }
        finally {
            if (Test-Path -LiteralPath $OutPath) { Remove-Item -LiteralPath $OutPath -Force }
        }
    }

    It 'Ends with exactly one trailing newline and no BOM' {
        $OutPath = Join-Path ([System.IO.Path]::GetTempPath()) "write-edges-bom-$(Get-Random).json"
        try {
            $Data = Get-Content -Raw -LiteralPath $InputPath | ConvertFrom-Json
            InModuleScope AITriad -Parameters @{ Data = $Data; OutPath = $OutPath } {
                param($Data, $OutPath)
                Write-EdgesFile -EdgesData $Data -Path $OutPath
            }
            $Bytes = [System.IO.File]::ReadAllBytes($OutPath)
            # No UTF-8 BOM (EF BB BF)
            ($Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF) | Should -BeFalse -Because 'output must be UTF-8 no-BOM'
            # Exactly one trailing newline: last byte is LF, second-to-last is not LF
            $Bytes[$Bytes.Length - 1] | Should -Be 10 -Because 'file must end with a trailing LF'
            $Bytes[$Bytes.Length - 2] | Should -Not -Be 10 -Because 'file must end with exactly one trailing newline'
        }
        finally {
            if (Test-Path -LiteralPath $OutPath) { Remove-Item -LiteralPath $OutPath -Force }
        }
    }

    It 'Emits an empty edges array inline as "edges": []' {
        $OutPath = Join-Path ([System.IO.Path]::GetTempPath()) "write-edges-empty-$(Get-Random).json"
        try {
            $Data = [PSCustomObject][ordered]@{
                _schema_version = '1.0.0'
                last_modified   = '2026-07-29T00:00:00Z'
                edges           = @()
            }
            InModuleScope AITriad -Parameters @{ Data = $Data; OutPath = $OutPath } {
                param($Data, $OutPath)
                Write-EdgesFile -EdgesData $Data -Path $OutPath
            }
            $Text = [System.IO.File]::ReadAllText($OutPath)
            $Text | Should -Match '"edges": \[\]' -Because 'rule 4: an empty edges array is emitted inline'
        }
        finally {
            if (Test-Path -LiteralPath $OutPath) { Remove-Item -LiteralPath $OutPath -Force }
        }
    }
}

Describe 'Write-EdgesFile — rationale_source provenance survives round-trip (t/2950)' -Tag 'taxonomy' {
    # CL design edge-rationale-source-marker.md: edges carry an optional rationale_source with a
    # closed vocabulary (discovery|embedding-template|reflection|restore|backfill|human); absent =
    # legacy/unknown. Write-EdgesFile is structurally field-agnostic (ConvertTo-Json over the whole
    # edge PSObject), so it SHOULD preserve the field untouched — this pins that a future refactor to
    # explicit property projection can't silently drop a provenance marker (invisible in the data:
    # a dropped marker looks exactly like a legacy edge). Test-only; no production change expected.

    It 'preserves rationale_source value AND its key position, and keeps a legacy edge field-absent' {
        $OutPath = Join-Path ([System.IO.Path]::GetTempPath()) "write-edges-ratsrc-$(Get-Random).json"
        try {
            # Edge 1 carries rationale_source=restore (positioned right after rationale). Edge 2 is a
            # legacy edge with the field ABSENT — it must stay absent, never materialized as null.
            $withSource = [PSCustomObject][ordered]@{
                source = 'acc-001'; type = 'SUPPORTS'; target = 'saf-002'
                confidence = 0.95; rationale = 'because X'; rationale_source = 'restore'
            }
            $legacy = [PSCustomObject][ordered]@{
                source = 'acc-003'; type = 'CONTRADICTS'; target = 'skp-004'
                confidence = 0.9; rationale = 'because Z'
            }
            $Data = [PSCustomObject][ordered]@{ _schema_version = '1.0.0'; edges = @($withSource, $legacy) }

            InModuleScope AITriad -Parameters @{ Data = $Data; OutPath = $OutPath } {
                param($Data, $OutPath)
                Write-EdgesFile -EdgesData $Data -Path $OutPath
            }

            $Text     = [System.IO.File]::ReadAllText($OutPath)
            $Reparsed = $Text | ConvertFrom-Json

            # Value preserved on re-read.
            $e1 = $Reparsed.edges[0]
            $e1.rationale_source | Should -Be 'restore' -Because 'the provenance marker must survive serialization'

            # Key POSITION preserved: rationale_source serialized immediately after rationale (compact contract).
            $Text | Should -Match '"rationale":"because X","rationale_source":"restore"' -Because 'key order is preserved exactly'

            # Legacy edge stays field-absent — not materialized as null/empty. Exactly ONE edge carries the marker.
            $e2 = $Reparsed.edges[1]
            $e2.PSObject.Properties['rationale_source'] | Should -BeNullOrEmpty -Because 'an absent marker must not be materialized'
            ([regex]::Matches($Text, 'rationale_source')).Count | Should -Be 1 -Because 'only the one edge that had the field keeps it'
        }
        finally {
            if (Test-Path -LiteralPath $OutPath) { Remove-Item -LiteralPath $OutPath -Force }
        }
    }
}

Describe 'Write-EdgesFile — top-level hashtable document serializes correctly (t/2955 AC#4)' -Tag 'taxonomy' {
    # AC#4: the edge-rationale guard's document-level IDictionary branch protects a shape the sink
    # must actually be able to write. A raw [IDictionary] document's .PSObject.Properties are
    # Count/Keys/Values, so without the normalization branch the whole document mis-serializes.

    It 'round-trips an [ordered] hashtable document (top-level keys + edges) to valid, correct JSON' {
        $OutPath = Join-Path ([System.IO.Path]::GetTempPath()) "write-edges-hashdoc-$(Get-Random).json"
        try {
            # Document is a hashtable; edge is a hashtable too. [ordered] for deterministic key order.
            $Data = [ordered]@{
                _schema_version = '1.0.0'
                edges = @( [ordered]@{ source = 'acc-001'; type = 'SUPPORTS'; target = 'saf-002'; confidence = 0.95; rationale = 'r1' } )
            }
            InModuleScope AITriad -Parameters @{ Data = $Data; OutPath = $OutPath } {
                param($Data, $OutPath)
                Write-EdgesFile -EdgesData $Data -Path $OutPath
            }
            $Text     = [System.IO.File]::ReadAllText($OutPath)
            $Reparsed = $Text | ConvertFrom-Json
            $Reparsed._schema_version | Should -Be '1.0.0' -Because 'top-level hashtable keys must serialize, not Count/Keys/Values'
            @($Reparsed.edges).Count  | Should -Be 1
            $Reparsed.edges[0].source | Should -Be 'acc-001'
            $Reparsed.edges[0].rationale | Should -Be 'r1'
            # No hashtable-internals leaked into the document.
            $Text | Should -Not -Match '"(Count|Keys|Values|IsReadOnly|IsFixedSize)"' -Because 'hashtable internals must never serialize as document keys'
        }
        finally {
            if (Test-Path -LiteralPath $OutPath) { Remove-Item -LiteralPath $OutPath -Force }
        }
    }
}
