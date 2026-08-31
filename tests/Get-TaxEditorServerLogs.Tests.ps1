# Tag: diagnostics (t/3082)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Unit tests for Get-TaxEditorServerLogs (t/3082). Mocks Assert-AzCli (preflight) and Invoke-Az
    (the az seam) so no live Azure call is made — asserts KQL construction, Pino parsing, the
    -System path, and the guard rails.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
}

Describe 'Get-TaxEditorServerLogs' -Tag 'diagnostics' {

    It 'is exported from the module' {
        Get-Command -Module AITriad -Name 'Get-TaxEditorServerLogs' | Should -Not -BeNullOrEmpty
    }

    It 'parses Pino console rows and surfaces unparseable lines as Level=unparsed' {
        InModuleScope AITriad {
            $script:TaxEditorLogWorkspaceId = $null
            Mock Assert-AzCli { }
            Mock Invoke-Az -ParameterFilter { $Arguments -contains 'list' } -MockWith { 'ws-guid-abc' }

            $rows = @(
                @{ TimeGenerated = '2026-08-27T10:00:01Z'; RevisionName_s = 'rev-1'
                   Log_s = (@{ level = 30; time = 1756310401000; requestId = 'req-abc'; component = 'server'; method = 'GET'; path = '/api/health'; status = 200; duration_ms = 8; msg = 'Request completed' } | ConvertTo-Json -Compress) }
                @{ TimeGenerated = '2026-08-27T10:00:02Z'; RevisionName_s = 'rev-1'
                   Log_s = (@{ level = 50; time = 1756310402000; requestId = 'req-def'; component = 'server'; method = 'PUT'; path = '/api/debates'; status = 500; duration_ms = 133; msg = 'Request errored' } | ConvertTo-Json -Compress) }
                @{ TimeGenerated = '2026-08-27T10:00:03Z'; RevisionName_s = 'rev-1'
                   Log_s = '{"level":40,"requestId":"req-trunc","msg":"sliced' }   # boundary-sliced: invalid JSON
            )
            $queryJson = $rows | ConvertTo-Json -Depth 6
            Mock Invoke-Az -ParameterFilter { $Arguments -contains 'query' } -MockWith { $queryJson }.GetNewClosure()

            $r = @(Get-TaxEditorServerLogs -From ([datetime]'2026-08-27T09:00:00Z') -To ([datetime]'2026-08-27T11:00:00Z') -WarningAction SilentlyContinue)
            $r.Count | Should -Be 3

            $ok = $r | Where-Object RequestId -eq 'req-abc'
            $ok.Level      | Should -Be 'info'
            $ok.Status     | Should -Be 200
            $ok.Method     | Should -Be 'GET'
            $ok.DurationMs | Should -Be 8

            $err = $r | Where-Object RequestId -eq 'req-def'
            $err.Level  | Should -Be 'error'
            $err.Status | Should -Be 500

            $bad = $r | Where-Object Level -eq 'unparsed'
            $bad.Message | Should -Match 'sliced'
            $bad.Raw     | Should -Match 'sliced'
        }
    }

    It 'parses tz-naive TimeGenerated as UTC — no DST offset shift (t/3129)' {
        InModuleScope AITriad {
            # Force a DST-observing zone so a naive-as-local parse would shift by +1h (BST on 2026-08-31).
            # $env:TZ + ClearCachedData drives TimeZoneInfo.Local on Linux CI; on a machine that ignores
            # $env:TZ the assertion still holds for the fixed (AssumeUniversal) code and only the old
            # local-assume code fails — so this never false-fails, and catches the bug on any DST host.
            $origTZ = $env:TZ
            try {
                $env:TZ = 'Europe/London'
                [System.TimeZoneInfo]::ClearCachedData()

                $script:TaxEditorLogWorkspaceId = 'ws-guid-abc'
                Mock Assert-AzCli { }
                # tz-NAIVE TimeGenerated (no 'Z'/offset), exactly as `az --output json | ConvertFrom-Json` yields.
                $rows = @(
                    @{ TimeGenerated = '2026-08-31T06:42:47'; RevisionName_s = 'rev-1'
                       Log_s = (@{ level = 30; requestId = 'req-tz'; msg = 'hi' } | ConvertTo-Json -Compress) }
                )
                $queryJson = $rows | ConvertTo-Json -Depth 6
                Mock Invoke-Az -ParameterFilter { $Arguments -contains 'query' } -MockWith { $queryJson }.GetNewClosure()

                $r = @(Get-TaxEditorServerLogs -WarningAction SilentlyContinue)
                $r.Count | Should -Be 1
                # UTC wall-clock preserved (06:42), NOT shifted to 05:42 by the local +1 DST offset.
                # $parseTime is shared by the console and -System paths, so this covers both call sites.
                $r[0].Time.Hour   | Should -Be 6
                $r[0].Time.Minute | Should -Be 42
                $r[0].Time.Kind   | Should -Be 'Utc'
            } finally {
                $env:TZ = $origTZ
                [System.TimeZoneInfo]::ClearCachedData()
            }
        }
    }

    It 'builds console KQL with the app filter, requestId has-clause, and pattern contains-clause' {
        InModuleScope AITriad {
            $script:TaxEditorLogWorkspaceId = 'ws-guid-abc'   # pre-seed cache: skip workspace list
            $script:capturedKql = $null
            $script:capturedQueryArg = $null
            Mock Assert-AzCli { }
            Mock Invoke-Az -ParameterFilter { $Arguments -contains 'query' } -MockWith {
                $script:capturedKql = ($Arguments -join ' ')
                # capture the exact --analytics-query value (the single arg az receives)
                $qi = [array]::IndexOf($Arguments, '--analytics-query')
                $script:capturedQueryArg = if ($qi -ge 0 -and ($qi + 1) -lt $Arguments.Count) { $Arguments[$qi + 1] } else { $null }
                '[]'
            }

            Get-TaxEditorServerLogs -RequestId 'req-abc' -Pattern 'GEMINI' -App 'taxonomy-editor' -WarningAction SilentlyContinue | Out-Null

            $script:capturedKql | Should -Match 'ContainerAppConsoleLogs_CL'
            $script:capturedKql | Should -Match "ContainerAppName_s == 'taxonomy-editor'"
            $script:capturedKql | Should -Match "Log_s has 'req-abc'"
            $script:capturedKql | Should -Match "Log_s contains 'GEMINI'"
            # t/3117 REAL root cause: the query is passed inline as ONE --analytics-query arg to
            # `& az`; an embedded NEWLINE truncates the arg at the PS→az boundary, so az sees only
            # the first line and dumps the whole table (where/project/order/take all lost — `take`
            # returning full retention was the tell). Guard the single-line-transport invariant on
            # the ACTUAL arg, and confirm the full pipeline survives inside that one arg. A
            # content-only assertion on the query string can't catch this — the bug is in transport.
            $script:capturedQueryArg | Should -Not -BeNullOrEmpty
            $script:capturedQueryArg | Should -Not -Match "`n"                        # single line: no embedded newline
            $script:capturedQueryArg | Should -Match 'where TimeGenerated between'    # window clause reaches az
            $script:capturedQueryArg | Should -Match 'take '                          # take survives (the tell)
            $script:capturedQueryArg | Should -Match "todatetime\('"                  # window bound uses todatetime (valid KQL)
            $script:capturedQueryArg | Should -Not -Match "between \(datetime\('"     # not the quoted-datetime() literal
        }
    }

    It '-System queries the system table and emits raw Type/Reason rows' {
        InModuleScope AITriad {
            $script:TaxEditorLogWorkspaceId = 'ws-guid-abc'
            Mock Assert-AzCli { }
            $rows = @(@{ TimeGenerated = '2026-08-27T10:00:00Z'; Log_s = 'Replica restarted'; Type_s = 'Normal'; Reason_s = 'Killing'; RevisionName_s = 'rev-2' })
            $queryJson = $rows | ConvertTo-Json -Depth 5
            # .GetNewClosure() captures $queryJson for the return value; it also rebinds $script:,
            # so assert the system table via Should -Invoke rather than a $script: capture var.
            Mock Invoke-Az -ParameterFilter { $Arguments -contains 'query' } -MockWith { $queryJson }.GetNewClosure()

            $r = @(Get-TaxEditorServerLogs -System)
            Should -Invoke Invoke-Az -Times 1 -Exactly -ParameterFilter { ($Arguments -join ' ') -match 'ContainerAppSystemLogs_CL' }
            $r.Count       | Should -Be 1
            $r[0].Type     | Should -Be 'Normal'
            $r[0].Reason   | Should -Be 'Killing'
            $r[0].Message  | Should -Be 'Replica restarted'
        }
    }

    It '-Raw emits the raw Log_s string rather than a structured object' {
        InModuleScope AITriad {
            $script:TaxEditorLogWorkspaceId = 'ws-guid-abc'
            Mock Assert-AzCli { }
            $rows = @(@{ TimeGenerated = '2026-08-27T10:00:01Z'; RevisionName_s = 'rev-1'
                        Log_s = (@{ level = 30; requestId = 'req-abc'; msg = 'hi' } | ConvertTo-Json -Compress) })
            $queryJson = $rows | ConvertTo-Json -Depth 6
            Mock Invoke-Az -ParameterFilter { $Arguments -contains 'query' } -MockWith { $queryJson }.GetNewClosure()

            $r = @(Get-TaxEditorServerLogs -Raw)
            $r.Count | Should -Be 1
            $r[0] | Should -BeOfType [string]
            $r[0] | Should -Match 'req-abc'
        }
    }

    It 'rejects a requestId with KQL-injection characters' {
        InModuleScope AITriad {
            $script:TaxEditorLogWorkspaceId = 'ws-guid-abc'
            Mock Assert-AzCli { }
            Mock Invoke-Az { '[]' }
            { Get-TaxEditorServerLogs -RequestId "req-abc' | union *" } | Should -Throw
        }
    }

    It 'throws when -From is after -To' {
        InModuleScope AITriad {
            Mock Assert-AzCli { }
            { Get-TaxEditorServerLogs -From ([datetime]'2026-08-27T11:00:00Z') -To ([datetime]'2026-08-27T10:00:00Z') } | Should -Throw
        }
    }

    It 'throws an actionable error when no Log Analytics workspace is found' {
        InModuleScope AITriad {
            $script:TaxEditorLogWorkspaceId = $null
            $prevEnv = $env:TAXEDITOR_LOG_WORKSPACE_ID
            $env:TAXEDITOR_LOG_WORKSPACE_ID = $null
            try {
                Mock Assert-AzCli { }
                Mock Invoke-Az -ParameterFilter { $Arguments -contains 'list' } -MockWith { $null }
                { Get-TaxEditorServerLogs } | Should -Throw
            } finally {
                $env:TAXEDITOR_LOG_WORKSPACE_ID = $prevEnv
            }
        }
    }
}
