# Tests for the /readyz deploy warm-gate (t/3114).
# Part 1 exercises the pure Get-ReadyzGateAction predicate (no I/O).
# Part 2 exercises Invoke-ReadyzWarmGateCheck.ps1's polling loop with mocked HTTP —
# the four gate arms TL GV requires: proceed(200), skip(404), wait-then-proceed(503->200),
# timeout-fail(sustained 503).
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $DevOpsDir  = Join-Path $PSScriptRoot '..' 'operations' 'devops'
    . (Join-Path $DevOpsDir 'ReadyzWarmGatePredicate.ps1')
    $script:ScriptPath = Join-Path $DevOpsDir 'Invoke-ReadyzWarmGateCheck.ps1'
}

Describe 'Get-ReadyzGateAction (pure predicate)' -Tag 'unit' {
    It '200 -> proceed (cache warm)' {
        Get-ReadyzGateAction -StatusCode 200 | Should -Be 'proceed'
    }
    It '404 -> skip (endpoint absent; only 404 short-circuits)' {
        Get-ReadyzGateAction -StatusCode 404 | Should -Be 'skip'
    }
    It '503 -> wait (present-but-warming; NEVER skipped)' {
        Get-ReadyzGateAction -StatusCode 503 | Should -Be 'wait'
    }
    It 'Ambiguous/transient codes -> wait (conservative: do not skip on anything but 404)' {
        Get-ReadyzGateAction -StatusCode 500 | Should -Be 'wait'
        Get-ReadyzGateAction -StatusCode 200 | Should -Not -Be 'wait'
        Get-ReadyzGateAction -StatusCode 0   | Should -Be 'wait'   # connection error sentinel
        Get-ReadyzGateAction -StatusCode 429 | Should -Be 'wait'
    }
}

Describe 'Invoke-ReadyzWarmGateCheck.ps1 (polling arms)' -Tag 'unit' {

    BeforeEach {
        Mock Start-Sleep { }   # never actually sleep
    }

    It 'PROCEED: /readyz 200 on first poll -> exit 0' {
        Mock Invoke-WebRequest { [pscustomobject]@{ StatusCode = 200; Content = '{"status":"ready","nodeCount":4144}' } }
        $out = & $script:ScriptPath -BaseUrl 'http://rev.local' -TimeoutSec 300 -PollIntervalSec 0 *>&1 | Out-String
        $LASTEXITCODE | Should -Be 0
        $out | Should -Match 'Warm-gate PASSED'
    }

    It 'SKIP: /readyz 404 (absent) -> exit 0 + warning (no deadlock on introducing deploy)' {
        Mock Invoke-WebRequest { [pscustomobject]@{ StatusCode = 404; Content = 'Not Found' } }
        $out = & $script:ScriptPath -BaseUrl 'http://rev.local' -TimeoutSec 300 -PollIntervalSec 0 *>&1 | Out-String
        $LASTEXITCODE | Should -Be 0
        $out | Should -Match '::warning::Warm-gate SKIPPED'
        $out | Should -Match '404'
    }

    It 'WAIT-THEN-PROCEED: 503 then 200 -> waits, then exit 0 (present-503 is waited on, not skipped)' {
        # $global: (not $script:) — the mock body runs inside the &-invoked script's scope, which
        # has Set-StrictMode -Version Latest; an undefined $script:calls there would throw (read as
        # a connection error by the script's catch) and loop to timeout. $global: initialized to 0
        # is StrictMode-safe and visible across the invoked-script scope.
        $global:readyzCalls = 0
        Mock Invoke-WebRequest {
            $global:readyzCalls++
            if ($global:readyzCalls -lt 3) { [pscustomobject]@{ StatusCode = 503; Content = '{"status":"warming"}' } }
            else                            { [pscustomobject]@{ StatusCode = 200; Content = '{"status":"ready","nodeCount":4144}' } }
        }
        try {
            $out = & $script:ScriptPath -BaseUrl 'http://rev.local' -TimeoutSec 30 -PollIntervalSec 0 *>&1 | Out-String
            $LASTEXITCODE | Should -Be 0
            $out | Should -Match 'Warm-gate PASSED after 3 poll'
            $global:readyzCalls | Should -Be 3
        } finally {
            Remove-Variable -Name readyzCalls -Scope Global -ErrorAction SilentlyContinue
        }
    }

    It 'TIMEOUT-FAIL: sustained 503 past timeout -> exit 1 + explicit error (blocks traffic shift)' {
        Mock Invoke-WebRequest { [pscustomobject]@{ StatusCode = 503; Content = '{"status":"warming"}' } }
        $out = & $script:ScriptPath -BaseUrl 'http://rev.local' -TimeoutSec 0 -PollIntervalSec 0 *>&1 | Out-String
        $LASTEXITCODE | Should -Be 1
        $out | Should -Match '::error::embeddings pre-warm not ready'
        $out | Should -Match 'within 0s'
    }

    It 'TIMEOUT-FAIL: connection error treated as warming, still fails closed (never silently skips)' {
        Mock Invoke-WebRequest { throw 'connection refused' }
        $out = & $script:ScriptPath -BaseUrl 'http://rev.local' -TimeoutSec 0 -PollIntervalSec 0 *>&1 | Out-String
        $LASTEXITCODE | Should -Be 1
        $out | Should -Match '::error::embeddings pre-warm not ready'
    }

    It 'OBSERVE-ONLY: sustained 503 past timeout -> exit 0 + ::warning:: (logs, never blocks)' {
        # t/2683 real-env-first: the observe-only ship must NOT fail the deploy on a warm timeout;
        # it only logs, so real-env warm detection can be validated before the gate is promoted.
        Mock Invoke-WebRequest { [pscustomobject]@{ StatusCode = 503; Content = '{"status":"warming"}' } }
        $out = & $script:ScriptPath -BaseUrl 'http://rev.local' -TimeoutSec 0 -PollIntervalSec 0 -ObserveOnly *>&1 | Out-String
        $LASTEXITCODE | Should -Be 0
        $out | Should -Match '::warning::\[OBSERVE-ONLY\] embeddings pre-warm not ready'
    }
}
