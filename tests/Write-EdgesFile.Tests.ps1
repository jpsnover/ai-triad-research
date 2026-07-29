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
