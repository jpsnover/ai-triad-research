# Tests for the /readyz deploy warm-gate (t/3114; blocking flip t/3148).
# Part 1 exercises the pure Get-ReadyzGateAction predicate (status + body → action).
# Part 2 exercises Invoke-ReadyzWarmGateCheck.ps1's polling loop with mocked HTTP, asserting
# the emitted warm=true/false peer-gate output (mechanism B) and exit 0.
#
# The 'ready' body comes from the SHARED fixture that the server's readyz.test.ts also pins to the
# handler's real 200 — so a coordinated status-contract rename fails BOTH sides (gate↔handler
# coupling, t/3148). Fixture: taxonomy-editor/src/server/__tests__/fixtures/readyz-ready-body.json.
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $DevOpsDir  = Join-Path $PSScriptRoot '..' 'operations' 'devops'
    . (Join-Path $DevOpsDir 'ReadyzWarmGatePredicate.ps1')
    $script:ScriptPath = Join-Path $DevOpsDir 'Invoke-ReadyzWarmGateCheck.ps1'

    # Consumer-side pin: read the SAME shared fixture literal the handler test pins (producer side).
    $script:ReadyFixturePath = Join-Path $PSScriptRoot '..' 'taxonomy-editor' 'src' 'server' '__tests__' 'fixtures' 'readyz-ready-body.json'
    $script:ReadyBody = (Get-Content -Raw -LiteralPath $script:ReadyFixturePath).Trim()

    # SPA index.html fallback that an unregistered /readyz would 200 with — NOT a warm signal.
    $script:SpaBody = '<!doctype html><html><head><title>App</title></head><body><div id="root"></div></body></html>'

    # Read the warm=... value the gate appended to $env:GITHUB_OUTPUT. Defined in BeforeAll so it
    # is in scope during the Pester run phase for the It blocks (a function in the Describe body is
    # only present during discovery).
    function Get-EmittedWarm {
        $line = Get-Content -LiteralPath $env:GITHUB_OUTPUT -ErrorAction SilentlyContinue |
            Where-Object { $_ -like 'warm=*' } | Select-Object -Last 1
        if ($line) { return ($line -replace '^warm=', '') }
        return $null
    }
}

Describe 'Get-ReadyzGateAction (pure predicate: status + body)' -Tag 'unit' {
    It 'PROCEED: 200 + shared ready fixture {status:ready,nodeCount>0}' {
        Get-ReadyzGateAction -StatusCode 200 -Body $script:ReadyBody | Should -Be 'proceed'
    }
    It 'WAIT: 200 + {status:warming} (present-but-warming, never proceeds)' {
        Get-ReadyzGateAction -StatusCode 200 -Body '{"status":"warming"}' | Should -Be 'wait'
    }
    It 'WAIT: 200 + SPA index.html fallback (non-JSON body → not warm; bare 200 is not a signal)' {
        Get-ReadyzGateAction -StatusCode 200 -Body $script:SpaBody | Should -Be 'wait'
    }
    It 'WAIT: 200 + {status:ready} but nodeCount:0 (empty cache is not warm)' {
        Get-ReadyzGateAction -StatusCode 200 -Body '{"status":"ready","nodeCount":0}' | Should -Be 'wait'
    }
    It 'WAIT: 200 + {status:ready} with nodeCount MISSING (contract violation → not warm)' {
        Get-ReadyzGateAction -StatusCode 200 -Body '{"status":"ready"}' | Should -Be 'wait'
    }
    It 'WAIT: 200 + empty body' {
        Get-ReadyzGateAction -StatusCode 200 -Body '' | Should -Be 'wait'
    }
    It 'WAIT: 404 (route absent) → wait, NOT skip (t/3148 dropped the 404 short-circuit)' {
        Get-ReadyzGateAction -StatusCode 404 -Body 'Not Found' | Should -Be 'wait'
    }
    It 'WAIT: 503 present-but-warming' {
        Get-ReadyzGateAction -StatusCode 503 -Body '{"status":"warming"}' | Should -Be 'wait'
    }
    It 'WAIT: transient/ambiguous codes (500, connection-error sentinel 0, 429) never proceed' {
        Get-ReadyzGateAction -StatusCode 500 -Body ''  | Should -Be 'wait'
        Get-ReadyzGateAction -StatusCode 0   -Body ''  | Should -Be 'wait'
        Get-ReadyzGateAction -StatusCode 429 -Body ''  | Should -Be 'wait'
    }
    It 'The only PROCEED path is 200 + a valid ready body — nothing else' {
        Get-ReadyzGateAction -StatusCode 200 -Body $script:ReadyBody | Should -Be 'proceed'
        Get-ReadyzGateAction -StatusCode 200 -Body $script:SpaBody   | Should -Not -Be 'proceed'
        Get-ReadyzGateAction -StatusCode 404 -Body $script:ReadyBody | Should -Not -Be 'proceed'
    }
    It 'FAIL: 503 + {status:failed} (definitive data-root-failed) → fail (not wait; server has decided)' {
        Get-ReadyzGateAction -StatusCode 503 -Body '{"status":"failed","reason":"data-root-failed: forced"}' | Should -Be 'fail'
    }
    It 'FAIL: {status:failed} wins for ANY status code (200 too) — definitive check precedes the 200/non-200 split' {
        Get-ReadyzGateAction -StatusCode 200 -Body '{"status":"failed","reason":"x"}' | Should -Be 'fail'
        Get-ReadyzGateAction -StatusCode 500 -Body '{"status":"failed"}'               | Should -Be 'fail'
    }
    It 'NOT fail: warming/ready/absent/SPA never map to fail (only an explicit status:failed does)' {
        Get-ReadyzGateAction -StatusCode 503 -Body '{"status":"warming"}' | Should -Be 'wait'
        Get-ReadyzGateAction -StatusCode 200 -Body $script:ReadyBody      | Should -Be 'proceed'
        Get-ReadyzGateAction -StatusCode 404 -Body 'Not Found'            | Should -Be 'wait'
        Get-ReadyzGateAction -StatusCode 200 -Body $script:SpaBody        | Should -Be 'wait'
        Get-ReadyzGateAction -StatusCode 503 -Body ''                     | Should -Be 'wait'
    }
}

Describe 'Invoke-ReadyzWarmGateCheck.ps1 (warm=true/false output, mechanism B)' -Tag 'unit' {

    BeforeEach {
        Mock Start-Sleep { }   # never actually sleep
        # Capture the emitted GITHUB_OUTPUT to a temp file the gate appends warm=... to.
        $script:OutFile = New-TemporaryFile
        $env:GITHUB_OUTPUT = $script:OutFile.FullName
    }
    AfterEach {
        Remove-Item -LiteralPath $script:OutFile.FullName -ErrorAction SilentlyContinue
        Remove-Item Env:\GITHUB_OUTPUT -ErrorAction SilentlyContinue
    }

    It 'PROCEED: 200 + ready body on first poll → warm=true, exit 0' {
        $readyBody = $script:ReadyBody   # capture into the mock closure ($script: doesn't resolve inside a deferred mock body)
        Mock Invoke-WebRequest { [pscustomobject]@{ StatusCode = 200; Content = $readyBody } }.GetNewClosure()
        $out = & $script:ScriptPath -BaseUrl 'http://rev.local' -TimeoutSec 300 -PollIntervalSec 0 *>&1 | Out-String
        $LASTEXITCODE | Should -Be 0
        Get-EmittedWarm | Should -Be 'true'
        $out | Should -Match 'Warm-gate PASSED'
    }

    It 'WAIT-THEN-PROCEED: 503 then 200 → waits, then warm=true (present-503 is waited on)' {
        $readyBody = $script:ReadyBody   # capture into the mock closure
        $global:readyzCalls = 0
        Mock Invoke-WebRequest {
            $global:readyzCalls++
            if ($global:readyzCalls -lt 3) { [pscustomobject]@{ StatusCode = 503; Content = '{"status":"warming"}' } }
            else                            { [pscustomobject]@{ StatusCode = 200; Content = $readyBody } }
        }.GetNewClosure()
        try {
            $out = & $script:ScriptPath -BaseUrl 'http://rev.local' -TimeoutSec 30 -PollIntervalSec 0 *>&1 | Out-String
            $LASTEXITCODE | Should -Be 0
            Get-EmittedWarm | Should -Be 'true'
            $out | Should -Match 'Warm-gate PASSED after 3 poll'
            $global:readyzCalls | Should -Be 3
        } finally {
            Remove-Variable -Name readyzCalls -Scope Global -ErrorAction SilentlyContinue
        }
    }

    It 'TIMEOUT → warm=false + exit 0 + ::error:: (blocks traffic shift; deploy rolls back)' {
        Mock Invoke-WebRequest { [pscustomobject]@{ StatusCode = 503; Content = '{"status":"warming"}' } }
        $out = & $script:ScriptPath -BaseUrl 'http://rev.local' -TimeoutSec 0 -PollIntervalSec 0 *>&1 | Out-String
        $LASTEXITCODE | Should -Be 0
        Get-EmittedWarm | Should -Be 'false'
        $out | Should -Match '::error::embeddings pre-warm not ready'
    }

    It '404 (route absent) sustained → warm=false (NOT skip; a dropped route blocks, t/3148)' {
        Mock Invoke-WebRequest { [pscustomobject]@{ StatusCode = 404; Content = 'Not Found' } }
        $out = & $script:ScriptPath -BaseUrl 'http://rev.local' -TimeoutSec 0 -PollIntervalSec 0 *>&1 | Out-String
        $LASTEXITCODE | Should -Be 0
        Get-EmittedWarm | Should -Be 'false'
    }

    It 'SPA-HTML 200 sustained → warm=false (body-shape check: a bare 200 is not warm)' {
        $spaBody = $script:SpaBody   # capture into the mock closure
        Mock Invoke-WebRequest { [pscustomobject]@{ StatusCode = 200; Content = $spaBody } }.GetNewClosure()
        $out = & $script:ScriptPath -BaseUrl 'http://rev.local' -TimeoutSec 0 -PollIntervalSec 0 *>&1 | Out-String
        $LASTEXITCODE | Should -Be 0
        Get-EmittedWarm | Should -Be 'false'
    }

    It 'CONNECTION-ERROR → fail-closed warm=false + exit 0 (never silently proceeds)' {
        Mock Invoke-WebRequest { throw 'connection refused' }
        $out = & $script:ScriptPath -BaseUrl 'http://rev.local' -TimeoutSec 0 -PollIntervalSec 0 *>&1 | Out-String
        $LASTEXITCODE | Should -Be 0
        Get-EmittedWarm | Should -Be 'false'
    }

    It 'FAIL-FAST: 503 {status:failed} on poll #1 → warm=false after ONE poll (not the full timeout), distinct hard-failure error, exit 0 (t/3343)' {
        $global:readyzCalls = 0
        Mock Invoke-WebRequest {
            $global:readyzCalls++
            [pscustomobject]@{ StatusCode = 503; Content = '{"status":"failed","reason":"data-root-failed: forced"}' }
        }.GetNewClosure()
        try {
            # Generous TimeoutSec: a correct fail-fast breaks on poll #1 regardless; a regression that
            # treated status:failed as 'warming' would instead spin to the (real-time) deadline.
            $out = & $script:ScriptPath -BaseUrl 'http://rev.local' -TimeoutSec 5 -PollIntervalSec 0 *>&1 | Out-String
            $LASTEXITCODE       | Should -Be 0
            Get-EmittedWarm     | Should -Be 'false'
            $global:readyzCalls | Should -Be 1     # broke immediately — did NOT burn the timeout
            $out | Should -Match 'DEFINITIVE failure'
            $out | Should -Not -Match 'pre-warm not ready'   # not the generic timeout message
        } finally {
            Remove-Variable -Name readyzCalls -Scope Global -ErrorAction SilentlyContinue
        }
    }
}
