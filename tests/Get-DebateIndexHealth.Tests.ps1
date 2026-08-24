# Tag: health (t/2735)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Get-DebateIndexHealth (t/2735) — type-invalid entry scan of the
    aggregated debate index (.debate-index.json).
.DESCRIPTION
    Writes a real .debate-index.json fixture to a temp debates dir and drives the
    cmdlet via -DebatesDir. Covers: a clean index, the t/2729 title-object bug,
    missing/null/wrong-type string fields, -Repair deletion (+ compact rewrite,
    good entries preserved), -WhatIf no-op, a missing index, and corrupt JSON.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Get-DebateIndexHealth' -Tag 'health' {

    BeforeEach {
        $script:DebatesDir = Join-Path ([System.IO.Path]::GetTempPath()) "dih-$(New-Guid)"
        New-Item -ItemType Directory -Path $script:DebatesDir -Force | Out-Null
        $script:IndexPath = Join-Path $script:DebatesDir '.debate-index.json'
    }

    AfterEach {
        Remove-Item -Path $script:DebatesDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    function script:New-Summary ($Id, $Title) {
        [ordered]@{
            id = $Id; title = $Title; created_at = '2026-08-01T00:00:00Z'
            updated_at = '2026-08-02T00:00:00Z'; phase = 'concluding'
            topic_text = 'A topic'; model = 'gemini-3.5'; turn_count = 4
        }
    }

    function script:Write-Index ($Entries) {
        $Index = [ordered]@{ v = 1; entries = $Entries }
        # Compact, like the app's saveIndex.
        [System.IO.File]::WriteAllText($script:IndexPath, ($Index | ConvertTo-Json -Depth 20 -Compress), [System.Text.UTF8Encoding]::new($false))
    }

    It 'Clean index → no issues' {
        Write-Index ([ordered]@{
            'aaa' = [ordered]@{ mtimeMs = 1; summary = (New-Summary 'aaa' 'Good title') }
            'bbb' = [ordered]@{ mtimeMs = 2; summary = (New-Summary 'bbb' 'Another') }
        })

        $r = Get-DebateIndexHealth -DebatesDir $script:DebatesDir -PassThru 6>$null
        $r.TotalEntries | Should -Be 2
        $r.BadEntries   | Should -Be 0
        @($r.Details).Count | Should -Be 0
    }

    It 'Flags a title that is an object {final, original} (the t/2729 bug)' {
        Write-Index ([ordered]@{
            'good' = [ordered]@{ mtimeMs = 1; summary = (New-Summary 'good' 'Fine') }
            'bad'  = [ordered]@{ mtimeMs = 2; summary = (New-Summary 'bad' ([ordered]@{ final = 'F'; original = 'O' })) }
        })

        $rows = @(Get-DebateIndexHealth -DebatesDir $script:DebatesDir 6>$null)
        $titleIssue = $rows | Where-Object { $_.Id -eq 'bad' -and $_.Field -eq 'title' }
        $titleIssue        | Should -Not -BeNullOrEmpty
        $titleIssue.Expected | Should -Be 'string'
        $titleIssue.Actual   | Should -Be 'PSCustomObject'
        $titleIssue.Detail   | Should -Match 'final'
        $titleIssue.Detail   | Should -Match 'original'
    }

    It 'Flags missing, null, and wrong-type required string fields' {
        $missingPhase = New-Summary 'm1' 'T'; $missingPhase.Remove('phase')
        $nullTitle    = New-Summary 'm2' 'x'; $nullTitle['title'] = $null
        Write-Index ([ordered]@{
            'm1' = [ordered]@{ mtimeMs = 1; summary = $missingPhase }
            'm2' = [ordered]@{ mtimeMs = 2; summary = $nullTitle }
        })

        $r = Get-DebateIndexHealth -DebatesDir $script:DebatesDir -PassThru 6>$null
        $r.BadEntries | Should -Be 2
        ($r.Details | Where-Object { $_.Id -eq 'm1' -and $_.Field -eq 'phase' }).Actual | Should -Be 'missing'
        ($r.Details | Where-Object { $_.Id -eq 'm2' -and $_.Field -eq 'title' }).Actual | Should -Be 'null'
    }

    It '-Repair deletes bad entries, preserves good ones, rewrites compact JSON' {
        Write-Index ([ordered]@{
            'good' = [ordered]@{ mtimeMs = 1; summary = (New-Summary 'good' 'Keep me') }
            'bad'  = [ordered]@{ mtimeMs = 2; summary = (New-Summary 'bad' ([ordered]@{ final = 'F' })) }
        })

        $r = Get-DebateIndexHealth -DebatesDir $script:DebatesDir -Repair -PassThru 6>$null
        $r.Removed | Should -Be 1

        $reloaded = Get-Content -Raw -Path $script:IndexPath | ConvertFrom-Json
        @($reloaded.entries.PSObject.Properties.Name) | Should -Be @('good') -Because 'only the bad entry is removed'
        $reloaded.v | Should -Be 1

        # Compact rewrite: no newlines, no trailing whitespace, no BOM.
        $bytes = [System.IO.File]::ReadAllBytes($script:IndexPath)
        @($bytes | Where-Object { $_ -eq 10 -or $_ -eq 13 }).Count | Should -Be 0 -Because 'compact JSON has no line breaks'
        ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) | Should -BeFalse -Because 'UTF-8 no-BOM'

        # Re-scan is clean.
        (Get-DebateIndexHealth -DebatesDir $script:DebatesDir -PassThru 6>$null).BadEntries | Should -Be 0
    }

    It '-Repair -WhatIf does not modify the file' {
        Write-Index ([ordered]@{
            'bad' = [ordered]@{ mtimeMs = 2; summary = (New-Summary 'bad' ([ordered]@{ final = 'F' })) }
        })
        $before = [System.IO.File]::ReadAllText($script:IndexPath)

        Get-DebateIndexHealth -DebatesDir $script:DebatesDir -Repair -WhatIf 6>$null | Out-Null

        [System.IO.File]::ReadAllText($script:IndexPath) | Should -Be $before -Because '-WhatIf must not write'
    }

    It 'Missing index → graceful, 0 entries' {
        # BeforeEach created the dir but no index file.
        $r = Get-DebateIndexHealth -DebatesDir $script:DebatesDir -PassThru 6>$null
        $r.TotalEntries | Should -Be 0
        $r.BadEntries   | Should -Be 0
    }

    It 'Corrupt index JSON → throws' {
        [System.IO.File]::WriteAllText($script:IndexPath, '{ not valid json', [System.Text.UTF8Encoding]::new($false))
        { Get-DebateIndexHealth -DebatesDir $script:DebatesDir 6>$null } | Should -Throw
    }
}
