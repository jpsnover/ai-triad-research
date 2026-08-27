# Tag: diagnostics (t/3065)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Get-DebateRateLimitSummary (t/3065) — 429/rate-limit summary from a flight recorder dump.
.DESCRIPTION
    Builds a throwaway JSONL dump with server rate-limiter events (embed:/free: buckets, retryAfterMs)
    and a client 429 (http_status/retry_after_s), plus non-rate-limit noise, then asserts the grouped
    summary. _wall is epoch-ms (matching lib/flight-recorder/types.ts), NOT the ISO strings used in the
    TS test mocks.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

    function New-RlDumpFixture {
        param([switch]$NoRateLimit)

        $path = Join-Path ([System.IO.Path]::GetTempPath()) "rl-$([guid]::NewGuid().ToString('N').Substring(0,8)).jsonl"
        $lines = [System.Collections.Generic.List[string]]::new()
        $lines.Add((@{ _type = 'header'; schema_version = '1.0.0'; ring_buffer_capacity = 500 } | ConvertTo-Json -Compress -Depth 5))

        function _Evt($h) { $h['_type'] = 'event'; ($h | ConvertTo-Json -Compress -Depth 6) }

        if (-not $NoRateLimit) {
            $base = 1756310000000  # arbitrary epoch-ms
            # embed:<ip> per-IP local-ONNX bucket — 3× 429 with distinct retryAfterMs (44s / 3s / 45s)
            $lines.Add((_Evt @{ type = 'ai.error'; component = 'rate-limiter'; level = 'warn'; _wall = $base + 1000; message = 'RPM limit reached (60/60)'; data = @{ type = 'requests_per_minute'; limitKey = 'embed:203.0.113.7'; limit = 60; current = 60; retryAfterMs = 44000; backend = 'local-onnx'; tier = 'free' } }))
            $lines.Add((_Evt @{ type = 'ai.error'; component = 'rate-limiter'; level = 'warn'; _wall = $base + 2000; message = 'RPM limit reached (60/60)'; data = @{ type = 'requests_per_minute'; limitKey = 'embed:203.0.113.7'; limit = 60; current = 60; retryAfterMs = 3000;  backend = 'local-onnx'; tier = 'free' } }))
            $lines.Add((_Evt @{ type = 'ai.error'; component = 'rate-limiter'; level = 'warn'; _wall = $base + 3000; message = 'RPM limit reached (60/60)'; data = @{ type = 'requests_per_minute'; limitKey = 'embed:203.0.113.7'; limit = 60; current = 60; retryAfterMs = 45000; backend = 'local-onnx'; tier = 'free' } }))
            # free:<ip> shared generate bucket — 2× 429
            $lines.Add((_Evt @{ type = 'ai.error'; component = 'rate-limiter'; level = 'warn'; _wall = $base + 1500; message = 'RPM limit reached (30/30)'; data = @{ type = 'requests_per_minute'; limitKey = 'free:203.0.113.7'; limit = 30; current = 30; retryAfterMs = 46000; backend = 'gemini'; tier = 'free' } }))
            $lines.Add((_Evt @{ type = 'ai.error'; component = 'rate-limiter'; level = 'warn'; _wall = $base + 4000; message = 'RPM limit reached (30/30)'; data = @{ type = 'requests_per_minute'; limitKey = 'free:203.0.113.7'; limit = 30; current = 30; retryAfterMs = 4000;  backend = 'gemini'; tier = 'free' } }))
            # client-side 429 from the instrumented web bridge
            $lines.Add((_Evt @{ type = 'ai.error'; component = 'web-bridge'; level = 'warn'; _wall = $base + 5000; message = 'HTTP 429'; data = @{ method = 'PUT /api/debates'; category = 'debate'; http_status = 429; retry_after_s = 46 } }))
        }
        # non-rate-limit noise (must be ignored)
        $lines.Add((_Evt @{ type = 'ai.response'; component = 'ai-generate'; level = 'info'; _wall = 1756310009000; message = 'ok'; data = @{ duration_ms = 12 } }))
        $lines.Add((_Evt @{ type = 'debate.phase'; component = 'orchestrator'; level = 'info'; _wall = 1756310010000; data = @{ phase = 'opening' } }))

        Set-Content -LiteralPath $path -Value $lines -Encoding utf8
        return $path
    }
}

Describe 'Get-DebateRateLimitSummary' -Tag 'diagnostics' {

    It 'is exported from the module' {
        Get-Command -Module AITriad -Name 'Get-DebateRateLimitSummary' | Should -Not -BeNullOrEmpty
    }

    It 'groups by bucket and ignores non-rate-limit events' {
        $p = New-RlDumpFixture
        try {
            $r = @(Get-DebateRateLimitSummary -Path $p)
            $r.Count | Should -Be 3   # embed:, free:, client method — noise excluded
            ($r.Bucket | Sort-Object) | Should -Contain 'embed:203.0.113.7'
            ($r.Bucket | Sort-Object) | Should -Contain 'free:203.0.113.7'
            ($r.Bucket | Sort-Object) | Should -Contain 'PUT /api/debates'
        } finally { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue }
    }

    It 'computes the embed bucket count + retry-after stats (ms→s) correctly' {
        $p = New-RlDumpFixture
        try {
            $embed = Get-DebateRateLimitSummary -Path $p | Where-Object Bucket -eq 'embed:203.0.113.7'
            $embed.Count              | Should -Be 3
            $embed.Source             | Should -Be 'embed'
            $embed.LimitType          | Should -Be 'requests_per_minute'
            $embed.Backend            | Should -Be 'local-onnx'
            $embed.RetryAfterMinSec   | Should -Be 3
            $embed.RetryAfterMaxSec   | Should -Be 45
            $embed.RetryAfterMeanSec  | Should -Be 30.7   # (44+3+45)/3
            $embed.RetryAfterDistinct | Should -Be 3
            $embed.PSObject.TypeNames | Should -Contain 'AITriad.RateLimitSummary'
        } finally { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue }
    }

    It 'classifies the client 429 (http_status/retry_after_s) with Source=client' {
        $p = New-RlDumpFixture
        try {
            $client = Get-DebateRateLimitSummary -Path $p | Where-Object Bucket -eq 'PUT /api/debates'
            $client.Source           | Should -Be 'client'
            $client.Count            | Should -Be 1
            $client.RetryAfterMaxSec | Should -Be 46
        } finally { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue }
    }

    It '-PerEvent emits one flat record per 429 event, in time order' {
        $p = New-RlDumpFixture
        try {
            $ev = @(Get-DebateRateLimitSummary -Path $p -PerEvent)
            $ev.Count | Should -Be 6   # 3 embed + 2 free + 1 client
            $ev[0].WallMs | Should -BeLessOrEqual $ev[-1].WallMs
        } finally { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue }
    }

    It 'warns and returns nothing when the dump has no rate-limit events' {
        $p = New-RlDumpFixture -NoRateLimit
        try {
            $r = Get-DebateRateLimitSummary -Path $p -WarningAction SilentlyContinue
            $r | Should -BeNullOrEmpty
        } finally { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue }
    }

    It 'throws an actionable error when the dump file is missing' {
        { Get-DebateRateLimitSummary -Path (Join-Path ([System.IO.Path]::GetTempPath()) 'no-such-dump.jsonl') } | Should -Throw
    }
}
