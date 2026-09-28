# Tag: flightrecorder (t/3726)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Tests for Read-FlightRecorderDump — structured error/retry summary (t/3726).
    Isolated fixture JSONL, no real dump. Covers: dictionary-handle resolution,
    retry-chain reconstruction (call_id-keyed + fallback-keyed), backoff interval
    computation, preceding-warning lookback, error grouping (component+type vs
    component-only), server/client split (both arms), -ErrorsOnly suppression,
    and the missing-file ActionableError path.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force

    $script:Fx = Join-Path ([System.IO.Path]::GetTempPath()) ("rfrd-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $script:Fx | Out-Null

    function script:Line($obj) { $obj | ConvertTo-Json -Compress -Depth 10 }

    # ── Primary fixture: chains, warnings, mixed-type error grouping ────────────
    $lines = [System.Collections.Generic.List[string]]::new()

    $lines.Add((script:Line @{ _type = 'header'; _version = 1; schema_version = '1.0.0'
        timestamp = '2026-09-28T10:00:00.000Z'; uptime_ms = 1000
        ring_buffer_capacity = 1000; ring_buffer_events_total = 8; ring_buffer_events_retained = 8; events_lost = 0
        app_version = '1.2.3'; platform = 'win32' }))

    $lines.Add((script:Line @{ _type = 'dictionary'; entries = @(
        @{ handle = 0; category = 'component'; value = 'ai-adapter'; registered_at = 1 }
    ) }))

    # Chain A — call_id-keyed: 2 retries then a terminal error (FAILED). Retries are
    # level=warn so they double as the PrecedingWarnings fixture for their own error.
    $lines.Add((script:Line @{ _type = 'event'; _seq = 1; _wall = 1000; type = 'ai.retry'; component = 0; level = 'warn'
        call_id = 'call-abc'; data = @{ attempt = 1; maxRetries = 3; backoffSeconds = 15 } }))
    $lines.Add((script:Line @{ _type = 'event'; _seq = 2; _wall = 16000; type = 'ai.retry'; component = 0; level = 'warn'
        call_id = 'call-abc'; data = @{ attempt = 2; maxRetries = 3; backoffSeconds = 45 } }))
    $lines.Add((script:Line @{ _type = 'event'; _seq = 3; _wall = 61000; type = 'ai.error'; component = 0; level = 'error'
        call_id = 'call-abc'; error_category = 'network'; message = 'generateText failed' }))

    # Chain B — no correlation id at all: falls back to component|backend|model key. Ends
    # in ai.response (RECOVERED).
    $lines.Add((script:Line @{ _type = 'event'; _seq = 4; _wall = 70000; type = 'ai.retry'; component = 'ai-adapter'; level = 'warn'
        data = @{ backend = 'gemini'; model = 'gemini-3.5-flash-lite'; attempt = 1 } }))
    $lines.Add((script:Line @{ _type = 'event'; _seq = 5; _wall = 75000; type = 'ai.response'; component = 'ai-adapter'; level = 'info'
        data = @{ backend = 'gemini'; model = 'gemini-3.5-flash-lite' } }))

    # Distinct component, second error TYPE — differentiates (component,type) grouping
    # from -GroupByComponent, and gives a warn-then-error PrecedingWarnings case.
    $lines.Add((script:Line @{ _type = 'event'; _seq = 6; _wall = 80000; type = 'state.error'; component = 'state-mgr'; level = 'warn'
        message = 'save slow' }))
    $lines.Add((script:Line @{ _type = 'event'; _seq = 7; _wall = 81000; type = 'state.error'; component = 'state-mgr'; level = 'error'
        error_category = 'state'; message = 'save failed' }))

    # Second error TYPE in the ai-adapter component (not an ai.* retry-chain type) — makes
    # ai-adapter carry 2 errors of different types (ai.error + system.error).
    $lines.Add((script:Line @{ _type = 'event'; _seq = 8; _wall = 90000; type = 'system.error'; component = 0; level = 'error'
        error_category = 'state'; message = 'disk full' }))

    $script:PrimaryDump = Join-Path $script:Fx 'primary.jsonl'
    Set-Content -LiteralPath $script:PrimaryDump -Value $lines -Encoding utf8NoBOM

    # ── Merged-dump fixture: _source-tagged (Available=$true arm) ────────────────
    $mergedLines = [System.Collections.Generic.List[string]]::new()
    $mergedLines.Add((script:Line @{ _type = 'header'; merged = $true }))
    $mergedLines.Add((script:Line @{ _type = 'event'; _seq = 1; _wall = 1000; type = 'lifecycle'; component = 'app'; level = 'info'; _source = 'client' }))
    $mergedLines.Add((script:Line @{ _type = 'event'; _seq = 2; _wall = 2000; type = 'lifecycle'; component = 'app'; level = 'info'; _source = 'client' }))
    $mergedLines.Add((script:Line @{ _type = 'event'; _seq = 3; _wall = 3000; type = 'lifecycle'; component = 'app'; level = 'info'; _source = 'server' }))
    $script:MergedDump = Join-Path $script:Fx 'merged.jsonl'
    Set-Content -LiteralPath $script:MergedDump -Value $mergedLines -Encoding utf8NoBOM
}

AfterAll {
    if ($script:Fx -and (Test-Path $script:Fx)) { Remove-Item -Recurse -Force $script:Fx -ErrorAction SilentlyContinue }
}

Describe 'Read-FlightRecorderDump (t/3726)' -Tag 'flightrecorder' {

    It 'is exported and callable' {
        Get-Command Read-FlightRecorderDump -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
    }

    It 'throws an ActionableError when the file is missing' {
        { Read-FlightRecorderDump -Path (Join-Path $script:Fx 'nope.jsonl') } |
            Should -Throw -ExpectedMessage '*File not found*'
    }

    It 'resolves the dictionary handle for component and parses the header' {
        $r = Read-FlightRecorderDump -Path $script:PrimaryDump -AsObject
        $r.Header.AppVersion | Should -Be '1.2.3'
        $r.Header.Retained | Should -Be 8
        ($r.Errors | Where-Object { $_.Seq -eq 3 }).Component | Should -Be 'ai-adapter'
    }

    It 'finds all error/fatal events' {
        $r = Read-FlightRecorderDump -Path $script:PrimaryDump -AsObject
        $r.ErrorCount | Should -Be 3
        @($r.Errors.Seq | Sort-Object) | Should -Be @(3, 7, 8)
    }

    It 'reconstructs a call_id-keyed retry chain with computed backoff intervals — FAILED' {
        $r = Read-FlightRecorderDump -Path $script:PrimaryDump -ShowRetryStats -AsObject
        $chain = $r.RetryChains | Where-Object { $_.CorrelationKey -eq 'call-abc' }
        $chain | Should -Not -BeNullOrEmpty
        $chain.AttemptCount | Should -Be 3
        $chain.FinalStatus | Should -Be 'failed'
        @($chain.BackoffIntervalsMs) | Should -Be @(15000, 45000)
    }

    It 'reconstructs a fallback (component|backend|model)-keyed chain — RECOVERED' {
        $r = Read-FlightRecorderDump -Path $script:PrimaryDump -ShowRetryStats -AsObject
        $chain = $r.RetryChains | Where-Object { $_.CorrelationKey -eq 'ai-adapter|gemini|gemini-3.5-flash-lite' }
        $chain | Should -Not -BeNullOrEmpty
        $chain.AttemptCount | Should -Be 2
        $chain.FinalStatus | Should -Be 'recovered'
        @($chain.BackoffIntervalsMs) | Should -Be @(5000)
    }

    It 'does not emit a chain for a non-retry standalone error (system.error at seq 8)' {
        $r = Read-FlightRecorderDump -Path $script:PrimaryDump -ShowRetryStats -AsObject
        $r.RetryChains.Count | Should -Be 2
    }

    It 'captures preceding same-component warnings within the default lookback' {
        $r = Read-FlightRecorderDump -Path $script:PrimaryDump -AsObject
        $err3 = $r.Errors | Where-Object { $_.Seq -eq 3 }
        $err3.PrecedingWarnings.Count | Should -Be 2   # seq 1 + seq 2, both ai.retry/warn, same resolved component

        $err7 = $r.Errors | Where-Object { $_.Seq -eq 7 }
        $err7.PrecedingWarnings.Count | Should -Be 1   # seq 6 warn, same component
    }

    It 'respects -WarningLookback narrowing the scan window' {
        $r = Read-FlightRecorderDump -Path $script:PrimaryDump -WarningLookback 1 -AsObject
        $err3 = $r.Errors | Where-Object { $_.Seq -eq 3 }
        $err3.PrecedingWarnings.Count | Should -Be 1   # only seq 2 scanned
    }

    It 'groups the error summary by (Component,Type) by default' {
        $r = Read-FlightRecorderDump -Path $script:PrimaryDump -AsObject
        @($r.ErrorSummary).Count | Should -Be 3   # ai-adapter/ai.error, ai-adapter/system.error, state-mgr/state.error
        @($r.ErrorSummary | Where-Object { $_.Component -eq 'ai-adapter' -and $_.Type -eq 'ai.error' }).Count | Should -Be 1
    }

    It '-GroupByComponent collapses type distinctions within a component' {
        $r = Read-FlightRecorderDump -Path $script:PrimaryDump -GroupByComponent -AsObject
        @($r.ErrorSummary).Count | Should -Be 2   # ai-adapter (2 errors), state-mgr (1 error) -- 2 GROUPS
        ($r.ErrorSummary | Where-Object { $_.Component -eq 'ai-adapter' }).Count | Should -Be 2   # that group's error COUNT
    }

    It '-ErrorsOnly suppresses ErrorSummary, ServerVsClient, and per-error PrecedingWarnings' {
        $r = Read-FlightRecorderDump -Path $script:PrimaryDump -ErrorsOnly -AsObject
        $r.PSObject.Properties['ErrorSummary'] | Should -BeNullOrEmpty
        $r.PSObject.Properties['ServerVsClient'] | Should -BeNullOrEmpty
        @($r.Errors | Where-Object { $_.Seq -eq 3 }).PrecedingWarnings.Count | Should -Be 0
    }

    It 'reports ServerVsClient unavailable on a single-source (unmerged) dump' {
        $r = Read-FlightRecorderDump -Path $script:PrimaryDump -AsObject
        $r.ServerVsClient.Available | Should -BeFalse
        $r.ServerVsClient.Reason | Should -Match 'single-source'
    }

    It 'reports the Client/Server split on a _source-tagged merged dump' {
        $r = Read-FlightRecorderDump -Path $script:MergedDump -AsObject
        $r.ServerVsClient.Available | Should -BeTrue
        $r.ServerVsClient.Client | Should -Be 2
        $r.ServerVsClient.Server | Should -Be 1
    }

    It '-AsObject:$false returns formatted text containing the error count and file path' {
        $text = Read-FlightRecorderDump -Path $script:PrimaryDump
        $text | Should -BeOfType [string]
        $text | Should -Match 'Errors \(3\)'
        $text | Should -Match ([regex]::Escape($script:PrimaryDump))
    }

    It 'accepts pipeline input by property name (FullName, as from Get-ChildItem)' {
        $fileObj = Get-Item -LiteralPath $script:PrimaryDump
        $r = $fileObj | Read-FlightRecorderDump -AsObject
        $r.ErrorCount | Should -Be 3
    }
}
