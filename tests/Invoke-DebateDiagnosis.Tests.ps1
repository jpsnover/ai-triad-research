# Tag: debate (t/3768)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Invoke-DebateDiagnosis — structured debate FR dump analysis (t/3768).
    Isolated fixture JSONL, built to match the REAL event shapes verified against an actual
    2877-event debate dump (t/3768#2) — debate.phase/data.povers, debate.round/data.round+
    speakers, debate.moderate/data.intervention_move+responder, and steelman_of leaking only
    as raw text inside a system.error parse-failure payload (never a structured field).
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force

    $script:Fx = Join-Path ([System.IO.Path]::GetTempPath()) ("dbgdiag-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $script:Fx | Out-Null
    function script:Line($obj) { $obj | ConvertTo-Json -Compress -Depth 10 }

    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add((script:Line @{ _type = 'header'; timestamp = '2026-09-29T21:46:56.115Z'; ring_buffer_events_retained = 12 }))

    # ── Run A (run-A): full lifecycle — setup -> debate -> 1 round -> 2/3 povers COMMIT ──
    $lines.Add((script:Line @{ _type = 'event'; _seq = 1; _wall = 1000; type = 'debate.phase'; component = 'debate-store'; level = 'info'
        debate_id = 'debate-1'; run_id = 'run-A'; message = 'debate.start'
        data = @{ phase = 'setup'; topic = 'Topic A'; povers = @('accelerationist', 'safetyist', 'skeptic'); model = 'gemini-3.5-flash-lite'; audience = 'policymakers' } }))
    $lines.Add((script:Line @{ _type = 'event'; _seq = 2; _wall = 2000; type = 'debate.round'; component = 'debate-store'; level = 'info'
        debate_id = 'debate-1'; run_id = 'run-A'; message = 'Cross-respond round 1 start'
        data = @{ round = 1; phase = 'confrontation'; speakers = @('accelerationist', 'safetyist', 'skeptic') } }))
    $lines.Add((script:Line @{ _type = 'event'; _seq = 3; _wall = 3000; type = 'debate.moderate'; component = 'moderator'; level = 'info'
        debate_id = 'debate-1'; run_id = 'run-A'; message = 'Moderator intervention: COMMIT'
        data = @{ responder = 'safetyist'; intervention_move = 'COMMIT'; budget_remaining = 2.0; health_score = 0.8 } }))
    $lines.Add((script:Line @{ _type = 'event'; _seq = 4; _wall = 4000; type = 'debate.moderate'; component = 'moderator'; level = 'info'
        debate_id = 'debate-1'; run_id = 'run-A'; message = 'Moderator intervention: COMMIT'
        data = @{ responder = 'accelerationist'; intervention_move = 'COMMIT'; budget_remaining = 1.5; health_score = 0.75 } }))

    # ── Run B (run-B): synthesis-direct COMMIT with NO round event first (Rounds -> null) ──
    $lines.Add((script:Line @{ _type = 'event'; _seq = 5; _wall = 5000; type = 'debate.phase'; component = 'debate-store'; level = 'info'
        debate_id = 'debate-1'; run_id = 'run-B'; message = 'debate.start'
        data = @{ phase = 'setup'; topic = 'Topic B'; povers = @('accelerationist', 'safetyist', 'skeptic'); model = 'gemini-3.5-flash-lite' } }))
    $lines.Add((script:Line @{ _type = 'event'; _seq = 6; _wall = 6000; type = 'debate.moderate'; component = 'moderator'; level = 'info'
        debate_id = 'debate-1'; run_id = 'run-B'; message = 'Moderator intervention: COMMIT'
        data = @{ responder = 'skeptic'; intervention_move = 'COMMIT' } }))

    # A non-COMMIT moderate event — must NOT be counted as a commit.
    $lines.Add((script:Line @{ _type = 'event'; _seq = 7; _wall = 7000; type = 'debate.moderate'; component = 'moderator'; level = 'debug'
        debate_id = 'debate-1'; run_id = 'run-A'; message = 'Moderator intervention: CHALLENGE'
        data = @{ responder = 'skeptic'; intervention_move = 'CHALLENGE' } }))

    # Errors / duplicate warnings (dedup target: 2 identical messages -> Count=2, 1 distinct)
    $lines.Add((script:Line @{ _type = 'event'; _seq = 8; _wall = 8000; type = 'system.error'; component = 'debate-store'; level = 'error'
        debate_id = 'debate-1'; run_id = 'run-A'; message = 'Fatal parse failure'; error = @{ name = 'SyntaxError'; message = 'boom' } }))
    $lines.Add((script:Line @{ _type = 'event'; _seq = 9; _wall = 9000; type = 'ai.retry'; component = 'ai-adapter'; level = 'warn'
        debate_id = 'debate-1'; run_id = 'run-A'; message = 'retry once' }))
    $lines.Add((script:Line @{ _type = 'event'; _seq = 10; _wall = 10000; type = 'ai.retry'; component = 'ai-adapter'; level = 'warn'
        debate_id = 'debate-1'; run_id = 'run-A'; message = 'retry once' }))

    # Steelman leak — only inside a parse-failure payload's raw text (never structured).
    $lines.Add((script:Line @{ _type = 'event'; _seq = 11; _wall = 11000; type = 'system.error'; component = 'parseAIJson'; level = 'warn'
        debate_id = 'debate-1'; run_id = 'run-A'; message = 'parseAIJson exhausted all recovery strategies'
        data = @{ discarded_tail = '..."specificity": "general", "steelman_of": null }' } }))

    $script:Dump = Join-Path $script:Fx 'debate.jsonl'
    Set-Content -LiteralPath $script:Dump -Value $lines -Encoding utf8NoBOM
}

AfterAll {
    if ($script:Fx -and (Test-Path $script:Fx)) { Remove-Item -Recurse -Force $script:Fx -ErrorAction SilentlyContinue }
}

Describe 'Invoke-DebateDiagnosis (t/3768)' -Tag 'debate' {

    It 'is exported and callable' {
        Get-Command Invoke-DebateDiagnosis -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
    }

    It 'throws an ActionableError when the file is missing' {
        { Invoke-DebateDiagnosis -DumpPath (Join-Path $script:Fx 'nope.jsonl') } |
            Should -Throw -ExpectedMessage '*File not found*'
    }

    It 'extracts BuildDate from the header timestamp as a parseable ISO-8601 instant' {
        # PS7 ConvertFrom-Json coerces the JSON timestamp string to [datetime] before the
        # cmdlet ever sees it, so compare the resulting INSTANT, not exact string formatting
        # (the round-trip 'o' format renders 7-digit fractional seconds, not the source's 3).
        $r = Invoke-DebateDiagnosis -DumpPath $script:Dump -AsObject
        [DateTimeOffset]::Parse($r.BuildDate) | Should -Be ([DateTimeOffset]::Parse('2026-09-29T21:46:56.115Z'))
    }

    It 'identifies both runs with their topic/povers/model' {
        $r = Invoke-DebateDiagnosis -DumpPath $script:Dump -AsObject
        @($r.Runs).Count | Should -Be 2
        $runA = $r.Runs | Where-Object { $_.RunId -eq 'run-A' }
        $runA.Topic | Should -Be 'Topic A'
        @($runA.Povers) | Should -Be @('accelerationist', 'safetyist', 'skeptic')
    }

    It 'builds RoundSummary from debate.round events (round + phase + speakers)' {
        $r = Invoke-DebateDiagnosis -DumpPath $script:Dump -AsObject
        @($r.RoundSummary).Count | Should -Be 1
        $r.RoundSummary[0].Round | Should -Be 1
        $r.RoundSummary[0].Phase | Should -Be 'confrontation'
        @($r.RoundSummary[0].Speakers) | Should -Be @('accelerationist', 'safetyist', 'skeptic')
    }

    It 'counts only intervention_move -eq COMMIT (ignores CHALLENGE) — CommitState per (RunId,Pover)' {
        $r = Invoke-DebateDiagnosis -DumpPath $script:Dump -AsObject
        @($r.CommitState).Count | Should -Be 3   # run-A/safetyist, run-A/accelerationist, run-B/skeptic
        $safetyist = $r.CommitState | Where-Object { $_.RunId -eq 'run-A' -and $_.Pover -eq 'safetyist' }
        $safetyist.CommitCount | Should -Be 1
        $safetyist.Rounds | Should -Be @(1)   # tracked: debate.round(1) fired before this COMMIT
    }

    It 'reports a null round for a COMMIT with no preceding debate.round event (synthesis-direct path)' {
        $r = Invoke-DebateDiagnosis -DumpPath $script:Dump -AsObject
        $skepticB = $r.CommitState | Where-Object { $_.RunId -eq 'run-B' -and $_.Pover -eq 'skeptic' }
        $skepticB.CommitCount | Should -Be 1
        $skepticB.Rounds[0] | Should -BeNullOrEmpty
    }

    It 'ClosureAnalysis: run-A has 2/3 committed (missing skeptic) — NOT all-committed' {
        $r = Invoke-DebateDiagnosis -DumpPath $script:Dump -AsObject
        $ca = $r.ClosureAnalysis | Where-Object { $_.RunId -eq 'run-A' }
        $ca.AllCommitted | Should -BeFalse
        @($ca.MissingPovers) | Should -Be @('skeptic')
    }

    It 'ClosureAnalysis: run-B has only 1/3 committed — missing 2' {
        $r = Invoke-DebateDiagnosis -DumpPath $script:Dump -AsObject
        $cb = $r.ClosureAnalysis | Where-Object { $_.RunId -eq 'run-B' }
        $cb.AllCommitted | Should -BeFalse
        @($cb.MissingPovers | Sort-Object) | Should -Be @('accelerationist', 'safetyist')
    }

    It 'Errors: captures level=error/fatal events regardless of type' {
        $r = Invoke-DebateDiagnosis -DumpPath $script:Dump -AsObject
        @($r.Errors).Count | Should -Be 1
        $r.Errors[0].Message | Should -Be 'Fatal parse failure'
    }

    It 'Warnings: dedups identical messages by count, distinct from Errors' {
        $r = Invoke-DebateDiagnosis -DumpPath $script:Dump -AsObject
        $retryWarn = $r.Warnings | Where-Object { $_.Message -eq 'retry once' }
        $retryWarn.Count | Should -Be 2
        @($r.Warnings.Message) | Should -Not -Contain 'Fatal parse failure'   # errors aren't double-counted as warnings
    }

    It 'SteelmanSummary: finds the text-leak inside a parse-failure payload (best-effort scan)' {
        $r = Invoke-DebateDiagnosis -DumpPath $script:Dump -AsObject
        @($r.SteelmanSummary).Count | Should -BeGreaterOrEqual 1
        $r.SteelmanSummary[0].Snippet | Should -Match 'steelman_of'
    }

    It '-RunId restricts Runs/RoundSummary/CommitState/ClosureAnalysis to that run' {
        $r = Invoke-DebateDiagnosis -DumpPath $script:Dump -RunId 'run-B' -AsObject
        @($r.Runs).Count | Should -Be 1
        $r.Runs[0].RunId | Should -Be 'run-B'
        @($r.CommitState).Count | Should -Be 1
        @($r.RoundSummary).Count | Should -Be 0   # run-B never emits a debate.round event
    }

    It '-AsObject:$false returns formatted text mentioning Runs and Closure Analysis' {
        $text = Invoke-DebateDiagnosis -DumpPath $script:Dump
        $text | Should -BeOfType [string]
        $text | Should -Match 'Closure Analysis'
        $text | Should -Match 'Topic A'
    }

    It 'accepts pipeline input by property name (FullName)' {
        $fileObj = Get-Item -LiteralPath $script:Dump
        $r = $fileObj | Invoke-DebateDiagnosis -AsObject
        @($r.Runs).Count | Should -Be 2
    }
}
