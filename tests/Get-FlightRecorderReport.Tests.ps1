# Tag: health (t/1186)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force
}

Describe 'Get-FlightRecorderReport' -Tag 'health' {

    BeforeAll {
        $script:testFile = Join-Path $TestDrive 'test-dump.jsonl'

        $lines = @(
            (@{
                _type = 'header'
                _version = 1
                schema_version = '1.0.0'
                timestamp = '2026-06-07T10:00:00Z'
                ring_buffer_capacity = 5000
                ring_buffer_events_total = 10
                ring_buffer_events_retained = 10
                events_lost = 0
            } | ConvertTo-Json -Compress)

            (@{
                _type = 'dictionary'
                entries = @(
                    @{ handle = 0; category = 'component'; value = 'debate-engine' }
                    @{ handle = 1; category = 'component'; value = 'turn-pipeline' }
                    @{ handle = 10; category = 'pov'; value = 'accelerationist' }
                )
            } | ConvertTo-Json -Compress)

            (@{
                _type = 'context'
                app = @{ version = '0.8.0'; build_date = '2026-06-07T09:00:00Z' }
                debate = @{ id = 'debate-123'; phase = 'argumentation' }
            } | ConvertTo-Json -Compress)

            (@{
                _type = 'event'; _seq = 1; _wall = 1749290400000
                type = 'lifecycle'; component = 0; level = 'info'
                message = 'Engine started'
            } | ConvertTo-Json -Compress)

            (@{
                _type = 'event'; _seq = 2; _wall = 1749290401000
                type = 'debate.phase'; component = 0; level = 'info'
                data = @{ phase = 'confrontation' }
            } | ConvertTo-Json -Compress)

            (@{
                _type = 'event'; _seq = 3; _wall = 1749290402000
                type = 'turn.stage'; component = 1; level = 'info'
                speaker = 10; message = 'Turn generated'
            } | ConvertTo-Json -Compress)

            (@{
                _type = 'event'; _seq = 4; _wall = 1749290403000
                type = 'debate.round'; component = 0; level = 'info'
                data = @{ round = 2 }
            } | ConvertTo-Json -Compress)

            (@{
                _type = 'event'; _seq = 5; _wall = 1749290404000
                type = 'ai.error'; component = 0; level = 'error'
                error_category = 'rate_limit'
                message = 'Rate limited by API'
            } | ConvertTo-Json -Compress)

            (@{
                _type = 'event'; _seq = 6; _wall = 1749290405000
                type = 'debate.phase'; component = 0; level = 'info'
                data = @{ phase = 'argumentation' }
            } | ConvertTo-Json -Compress)

            (@{
                _type = 'event'; _seq = 7; _wall = 1749290406000
                type = 'turn.stage'; component = 1; level = 'warn'
                message = 'Low citation quality'
            } | ConvertTo-Json -Compress)
        )

        $lines | Set-Content -Path $script:testFile -Encoding utf8
    }

    It 'parses JSONL and returns structured report with -AsObject' {
        $report = Get-FlightRecorderReport -Path $script:testFile -AsObject
        $report | Should -Not -BeNullOrEmpty
        $report.EventCount | Should -Be 7
        $report.ErrorCount | Should -Be 1
        $report.WarningCount | Should -Be 1
        $report.DebateId | Should -Be 'debate-123'
    }

    It 'resolves dictionary handles for components' {
        $report = Get-FlightRecorderReport -Path $script:testFile -AsObject
        $compNames = $report.Components | ForEach-Object { $_.Component }
        $compNames | Should -Contain 'debate-engine'
        $compNames | Should -Contain 'turn-pipeline'
    }

    It 'builds phase timeline with event counts' {
        $report = Get-FlightRecorderReport -Path $script:testFile -AsObject
        $report.PhaseTimeline.Count | Should -BeGreaterOrEqual 2
        $report.PhaseTimeline[0].Phase | Should -Be 'confrontation'
        $report.PhaseTimeline[1].Phase | Should -Be 'argumentation'
    }

    It 'tracks current state (phase, round, speaker)' {
        $report = Get-FlightRecorderReport -Path $script:testFile -AsObject
        $report.CurrentState.Phase | Should -Be 'argumentation'
        $report.CurrentState.Round | Should -Be 2
        $report.CurrentState.Speaker | Should -Be 'accelerationist'
    }

    It 'categorizes errors in error summary' {
        $report = Get-FlightRecorderReport -Path $script:testFile -AsObject
        $report.ErrorSummary['rate_limit'] | Should -Be 1
    }

    It 'returns formatted text by default' {
        $output = Get-FlightRecorderReport -Path $script:testFile
        $output | Should -BeOfType [string]
        $output | Should -Match 'Flight Recorder Report'
        $output | Should -Match 'debate-123'
    }

    It 'includes events list with -Detailed' {
        $report = Get-FlightRecorderReport -Path $script:testFile -AsObject -Detailed
        $report.Events.Count | Should -Be 7
        $report.Errors.Count | Should -Be 1
        $report.Warnings.Count | Should -Be 1
    }

    It 'throws ActionableError for missing file' {
        { Get-FlightRecorderReport -Path 'C:\nonexistent\dump.jsonl' } |
            Should -Throw
    }
}
