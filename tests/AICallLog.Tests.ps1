# Tag: unit (t/3241)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    AI Call Log — core (t/3241; epic t/3235). Flag semantics, the append-writer record shape +
    monotonic ID, and the rotate/clear cmdlet.
.DESCRIPTION
    Private helpers (Test-AICallLogEnabled / Write-AICallLogEntry) are exercised via InModuleScope;
    the writer takes a -Path override so nothing touches the real data-root log. The env flag is
    process-global, so an AfterEach clears it to keep tests independent.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
}

Describe 'AI Call Log core (t/3241)' -Tag 'unit' {

    AfterEach {
        Remove-Item Env:AI_CALL_LOG_ENABLED -ErrorAction SilentlyContinue
    }

    Context 'Test-AICallLogEnabled — default-off flag' {
        It 'is FALSE when the flag is unset (default off)' {
            Remove-Item Env:AI_CALL_LOG_ENABLED -ErrorAction SilentlyContinue
            InModuleScope AITriad { Test-AICallLogEnabled } | Should -BeFalse
        }
        It 'is TRUE for truthy value <_>' -ForEach @('1', 'true', 'TRUE', 'yes', 'on') {
            $env:AI_CALL_LOG_ENABLED = $_
            InModuleScope AITriad { Test-AICallLogEnabled } | Should -BeTrue
        }
        It 'is FALSE for non-truthy value "<_>"' -ForEach @('0', 'false', 'no', 'off', '') {
            $env:AI_CALL_LOG_ENABLED = $_
            InModuleScope AITriad { Test-AICallLogEnabled } | Should -BeFalse
        }
    }

    Context 'Write-AICallLogEntry — no-op when the flag is off' {
        It 'writes NOTHING when the flag is off (zero-overhead early return, AC)' {
            Remove-Item Env:AI_CALL_LOG_ENABLED -ErrorAction SilentlyContinue
            $log = Join-Path $TestDrive 'off.jsonl'
            InModuleScope AITriad -Parameters @{ P = $log } {
                param($P)
                Write-AICallLogEntry -Scenario 'Debate' -Status '200' -Path $P
            }
            Test-Path -LiteralPath $log | Should -BeFalse
        }
    }

    Context 'Write-AICallLogEntry — record shape when on' {
        BeforeEach { $env:AI_CALL_LOG_ENABLED = '1' }

        It 'writes one well-formed JSONL record with all 7 fields' {
            $log = Join-Path $TestDrive 'on.jsonl'
            InModuleScope AITriad -Parameters @{ P = $log } {
                param($P)
                Write-AICallLogEntry -Scenario 'Logical Form' `
                    -PromptID 'enrichment.logical-form-formalization' `
                    -PromptStart 'Formalize this claim.' -RetryCount 2 -Status '200' -Path $P
            }
            $lines = @(Get-Content -LiteralPath $log)
            $lines.Count | Should -Be 1
            $rec = $lines[0] | ConvertFrom-Json
            foreach ($f in 'ID', 'Datetime', 'Scenario', 'PromptID', 'PromptStart', 'RetryCount', 'Status') {
                $rec.PSObject.Properties[$f] | Should -Not -BeNullOrEmpty -Because "field '$f' must be present"
            }
            $rec.ID         | Should -Be 1
            $rec.Scenario   | Should -Be 'Logical Form'
            $rec.PromptID   | Should -Be 'enrichment.logical-form-formalization'
            $rec.RetryCount | Should -Be 2
            $rec.Status     | Should -Be '200'
            # Assert Datetime on the RAW line, not $rec.Datetime — PS7 ConvertFrom-Json coerces the
            # ISO-8601 string to [DateTime] (drops the literal 'Z'); the on-disk contract is the text.
            $lines[0] | Should -Match '"Datetime":"\d{4}-\d{2}-\d{2}T[0-9:.]+Z"'   # UTC ISO-8601
        }

        It 'truncates PromptStart to 160 chars' {
            $log = Join-Path $TestDrive 'trunc.jsonl'
            $long = 'x' * 500
            InModuleScope AITriad -Parameters @{ P = $log; Long = $long } {
                param($P, $Long)
                Write-AICallLogEntry -Scenario 'Chat' -PromptStart $Long -Status '200' -Path $P
            }
            $rec = Get-Content -LiteralPath $log | Select-Object -First 1 | ConvertFrom-Json
            $rec.PromptStart.Length | Should -Be 160
        }

        It 'assigns monotonic IDs across appends (1,2,3)' {
            $log = Join-Path $TestDrive 'mono.jsonl'
            InModuleScope AITriad -Parameters @{ P = $log } {
                param($P)
                Write-AICallLogEntry -Scenario 'A' -Status '200' -Path $P
                Write-AICallLogEntry -Scenario 'B' -Status '429' -Path $P
                Write-AICallLogEntry -Scenario 'C' -Status '500' -Path $P
            }
            $ids = @(Get-Content -LiteralPath $log | ForEach-Object { ($_ | ConvertFrom-Json).ID })
            $ids | Should -Be @(1, 2, 3)
        }
    }

    Context 'Clear-AICallLog — rotate resets the session' {
        BeforeEach { $env:AI_CALL_LOG_ENABLED = '1' }

        It 'removes the file and the next write restarts ID at 1' {
            $log = Join-Path $TestDrive 'rotate.jsonl'
            InModuleScope AITriad -Parameters @{ P = $log } {
                param($P)
                Write-AICallLogEntry -Scenario 'A' -Status '200' -Path $P
                Write-AICallLogEntry -Scenario 'B' -Status '200' -Path $P
            }
            @(Get-Content -LiteralPath $log).Count | Should -Be 2

            $res = Clear-AICallLog -Path $log
            $res.Removed | Should -BeTrue
            Test-Path -LiteralPath $log | Should -BeFalse

            InModuleScope AITriad -Parameters @{ P = $log } {
                param($P)
                Write-AICallLogEntry -Scenario 'C' -Status '200' -Path $P
            }
            (Get-Content -LiteralPath $log | Select-Object -First 1 | ConvertFrom-Json).ID | Should -Be 1
        }

        It 'is a no-op (Removed=$false) when the file is absent' {
            $log = Join-Path $TestDrive 'absent.jsonl'
            $res = Clear-AICallLog -Path $log
            $res.Removed | Should -BeFalse
            { Clear-AICallLog -Path $log } | Should -Not -Throw
        }
    }

    Context 'Manifest export' {
        It 'exports Clear-AICallLog' {
            Get-Command Clear-AICallLog -Module AITriad | Should -Not -BeNullOrEmpty
        }
        It 'FunctionsToExport includes Clear-AICallLog' {
            $manifestPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
            (Test-ModuleManifest -Path $manifestPath).ExportedFunctions.Keys | Should -Contain 'Clear-AICallLog'
        }
    }
}

Describe 'Get-AICallLog (t/3243)' -Tag 'unit' {

    # A deterministic fixture with known Datetime/Scenario/Status so range + wildcard filters
    # are testable without depending on wall-clock (the writer stamps UtcNow).
    BeforeEach {
        $script:log = Join-Path $TestDrive "get-$([guid]::NewGuid()).jsonl"
        $fixture = @(
            [ordered]@{ ID = 1; Datetime = '2026-01-01T08:00:00.0000000Z'; Scenario = 'Debate';     PromptID = 'p1'; PromptStart = 'alpha';   RetryCount = 0; Status = '200' }
            [ordered]@{ ID = 2; Datetime = '2026-01-02T09:30:00.0000000Z'; Scenario = 'Chat';       PromptID = '';   PromptStart = 'bravo';   RetryCount = 1; Status = '429' }
            [ordered]@{ ID = 3; Datetime = '2026-01-03T11:15:00.0000000Z'; Scenario = 'Fact Check'; PromptID = 'p3'; PromptStart = 'charlie'; RetryCount = 0; Status = '500' }
        )
        $fixture | ForEach-Object { $_ | ConvertTo-Json -Compress } |
            Set-Content -LiteralPath $script:log -Encoding utf8
    }

    Context 'read + shape' {
        It 'returns one [AICallLogEntry] per record with all 7 fields (AC)' {
            $r = @(Get-AICallLog -Path $script:log)
            $r.Count | Should -Be 3
            $r[0].GetType().Name | Should -Be 'AICallLogEntry'
            foreach ($f in 'ID', 'Datetime', 'Scenario', 'PromptID', 'PromptStart', 'RetryCount', 'Status') {
                $r[0].PSObject.Properties[$f] | Should -Not -BeNullOrEmpty -Because "field '$f' must be present"
            }
            $r[0].ID          | Should -Be 1
            $r[0].Scenario    | Should -Be 'Debate'
            $r[0].Status      | Should -Be '200'
            $r[0].RetryCount  | Should -Be 0
        }

        It 'parses Datetime to a [datetime]' {
            $r = @(Get-AICallLog -Path $script:log)
            $r[0].Datetime | Should -BeOfType ([datetime])
            $r[0].Datetime.ToUniversalTime().ToString('yyyy-MM-dd') | Should -Be '2026-01-01'
        }

        It 'emits records one at a time down the pipeline (composes with Where-Object)' {
            $retried = @(Get-AICallLog -Path $script:log | Where-Object RetryCount -gt 0)
            $retried.Count | Should -Be 1
            $retried[0].ID | Should -Be 2
        }

        It 'reads regardless of the AI_CALL_LOG_ENABLED flag (flag gates writes, not reads)' {
            Remove-Item Env:AI_CALL_LOG_ENABLED -ErrorAction SilentlyContinue
            @(Get-AICallLog -Path $script:log).Count | Should -Be 3
        }
    }

    Context 'filters' {
        It 'filters by -Scenario (case-insensitive wildcard)' {
            $r = @(Get-AICallLog -Path $script:log -Scenario 'fact*')
            $r.Count | Should -Be 1
            $r[0].Scenario | Should -Be 'Fact Check'
        }
        It 'filters by -Status wildcard (all 4xx)' {
            $r = @(Get-AICallLog -Path $script:log -Status '4*')
            $r.Count | Should -Be 1
            $r[0].Status | Should -Be '429'
        }
        It 'filters by -After (inclusive lower bound)' {
            $r = @(Get-AICallLog -Path $script:log -After ([datetime]::Parse('2026-01-02T00:00:00Z')))
            @($r.ID) | Should -Be @(2, 3)
        }
        It 'filters by -Before (exclusive upper bound)' {
            $r = @(Get-AICallLog -Path $script:log -Before ([datetime]::Parse('2026-01-02T00:00:00Z')))
            @($r.ID) | Should -Be @(1)
        }
        It 'combines -After and -Before into a range' {
            $r = @(Get-AICallLog -Path $script:log `
                    -After ([datetime]::Parse('2026-01-02T00:00:00Z')) `
                    -Before ([datetime]::Parse('2026-01-03T00:00:00Z')))
            @($r.ID) | Should -Be @(2)
        }
    }

    Context 'non-fatal empty / degraded paths' {
        It 'returns empty (no throw) when the log file is absent' {
            $absent = Join-Path $TestDrive 'nope.jsonl'
            $r = $null
            { $r = @(Get-AICallLog -Path $absent) } | Should -Not -Throw
            $r.Count | Should -Be 0
        }
        It 'returns empty when the log file is empty' {
            $empty = Join-Path $TestDrive 'empty.jsonl'
            Set-Content -LiteralPath $empty -Value '' -Encoding utf8
            @(Get-AICallLog -Path $empty).Count | Should -Be 0
        }
        It 'skips an unparseable line with a warning but returns the valid records' {
            Add-Content -LiteralPath $script:log -Value 'this is not json' -Encoding utf8
            $warnings = @()
            $r = @(Get-AICallLog -Path $script:log -WarningVariable warnings -WarningAction SilentlyContinue)
            $r.Count | Should -Be 3
            @($warnings).Count | Should -BeGreaterThan 0
        }
    }

    Context 'Manifest export' {
        It 'exports Get-AICallLog' {
            Get-Command Get-AICallLog -Module AITriad | Should -Not -BeNullOrEmpty
        }
        It 'FunctionsToExport includes Get-AICallLog' {
            $manifestPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
            (Test-ModuleManifest -Path $manifestPath).ExportedFunctions.Keys | Should -Contain 'Get-AICallLog'
        }
    }
}

Describe 'Show-AICallLog (t/3244)' -Tag 'unit' {

    BeforeEach {
        $script:log = Join-Path $TestDrive "show-$([guid]::NewGuid()).jsonl"
        $fixture = @(
            [ordered]@{ ID = 1; Datetime = '2026-01-01T08:00:00.0000000Z'; Scenario = 'Debate';     PromptID = 'p1'; PromptStart = 'alpha';   RetryCount = 0; Status = '200' }
            [ordered]@{ ID = 2; Datetime = '2026-01-02T09:30:00.0000000Z'; Scenario = 'Chat';       PromptID = '';   PromptStart = 'bravo';   RetryCount = 1; Status = '429' }
            [ordered]@{ ID = 3; Datetime = '2026-01-03T11:15:00.0000000Z'; Scenario = 'Fact Check'; PromptID = 'p3'; PromptStart = 'charlie'; RetryCount = 0; Status = '500' }
        )
        $fixture | ForEach-Object { $_ | ConvertTo-Json -Compress } |
            Set-Content -LiteralPath $script:log -Encoding utf8
    }

    Context 'render (-PassThru returns the HTML file)' {
        It 'writes a valid HTML file with a table and one row per record (AC)' {
            $out = Show-AICallLog -Path $script:log -PassThru
            $out | Should -Not -BeNullOrEmpty
            Test-Path -LiteralPath $out | Should -BeTrue
            $out | Should -Match '\.html$'
            $html = Get-Content -LiteralPath $out -Raw
            $html | Should -Match '<!DOCTYPE html>'
            $html | Should -Match '<table id="log">'
            # 3 data rows (class="r"); the header row lives in <thead> and is not class="r".
            ([regex]::Matches($html, '<tr class="r">')).Count | Should -Be 3
            $html | Should -Match 'Fact Check'
            $html | Should -Match 'charlie'
        }

        It 'includes all 7 column headers' {
            $html = Get-Content -LiteralPath (Show-AICallLog -Path $script:log -PassThru) -Raw
            foreach ($c in 'ID', 'Datetime', 'Scenario', 'PromptID', 'PromptStart', 'RetryCount', 'Status') {
                $html | Should -Match ">$c</th>"
            }
        }

        It 'forwards filters to Get-AICallLog (only matching rows rendered)' {
            $html = Get-Content -LiteralPath (Show-AICallLog -Path $script:log -Status '4*' -PassThru) -Raw
            ([regex]::Matches($html, '<tr class="r">')).Count | Should -Be 1
            $html | Should -Match 'bravo'
            $html | Should -Not -Match 'charlie'
        }
    }

    Context 'safety + non-fatal paths' {
        It 'HTML-escapes cell values (no raw <script> injection)' {
            $evil = Join-Path $TestDrive 'evil.jsonl'
            ([ordered]@{ ID = 1; Datetime = '2026-01-01T00:00:00.0000000Z'; Scenario = '<script>alert(1)</script>'; PromptID = ''; PromptStart = 'x'; RetryCount = 0; Status = '200' } |
                ConvertTo-Json -Compress) | Set-Content -LiteralPath $evil -Encoding utf8
            $html = Get-Content -LiteralPath (Show-AICallLog -Path $evil -PassThru) -Raw
            $html | Should -Match '&lt;script&gt;'
            $html | Should -Not -Match '<script>alert\(1\)</script>'
        }

        It 'renders a valid empty-state page (no throw) when the log is absent' {
            $absent = Join-Path $TestDrive 'nope.jsonl'
            # Direct capture (not inside a { } | Should -Not-Throw scriptblock, which runs in a
            # child scope and wouldn't propagate $out); reaching the next line proves no throw.
            $out = Show-AICallLog -Path $absent -PassThru
            $out | Should -Not -BeNullOrEmpty
            Test-Path -LiteralPath $out | Should -BeTrue
            $html = Get-Content -LiteralPath $out -Raw
            $html | Should -Match '<!DOCTYPE html>'
            $html | Should -Match 'No AI call log records'
            $html | Should -Not -Match '<table id="log">'
        }
    }

    Context 'Manifest export' {
        It 'exports Show-AICallLog' {
            Get-Command Show-AICallLog -Module AITriad | Should -Not -BeNullOrEmpty
        }
        It 'FunctionsToExport includes Show-AICallLog' {
            $manifestPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
            (Test-ModuleManifest -Path $manifestPath).ExportedFunctions.Keys | Should -Contain 'Show-AICallLog'
        }
    }
}
