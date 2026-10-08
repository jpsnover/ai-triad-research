# Tag: security (t/2527)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression tests for t/2527 — Register-AIBackend localhost HTTP server auth hardening.
    Source-level assertions + live-server integration tests.
#>

BeforeAll {
    $ModulePath  = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    $SourcePath  = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public' 'Register-AIBackend.ps1'
    $script:Src  = Get-Content $SourcePath -Raw

    # Start server on an OS-assigned ephemeral port with no browser.
    # Bind a TcpListener on 127.0.0.1:0 so the OS picks a free port, capture it, then
    # release the probe before the server binds. A fixed port (was 19943) flaked this
    # suite (t/3547): when a prior job's server left the port in TIME_WAIT (~60s on
    # Linux), the listener couldn't bind and every integration test failed — and
    # t/3530's immediate same-job rerun failed identically, so the flake classifier
    # reported a definitive failure (false TL hold on PR #2286). An OS-assigned port
    # from the ephemeral range can never collide with a prior run's leftover; a probe
    # listener that never accepts a connection leaves no TIME_WAIT, so it frees cleanly.
    function Get-EphemeralPort {
        $Probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
        $Probe.Start()
        try { ([System.Net.IPEndPoint]$Probe.LocalEndpoint).Port } finally { $Probe.Stop() }
    }

    # Wait for the listener (t/3665, t/4111). Poll 100ms for up to 30s: the Start-Job runspace first
    # does `Import-Module AITriad -Force` (~4.6s COLD) before Register-AIBackend binds, so under CI
    # load import+start can take far longer than the fast path. Two guards (t/4111):
    # - Ready means a 401 on unauthenticated GET /, i.e. OUR auth-hardened server. Any other
    #   response means something else answered on the port, and the tests would assert against it.
    # - The job is watched while waiting. If it dies (Failed/Completed/Stopped), stop waiting at once
    #   and keep its error, instead of burning the full 30s and failing with no reason.
    function Wait-AuthTestServer([System.Management.Automation.Job]$Job, [int]$Port) {
        for ($i = 0; $i -lt 300; $i++) {
            Start-Sleep -Milliseconds 100
            if ($Job.State -in 'Failed', 'Completed', 'Stopped') {
                $Why = @(Receive-Job $Job -ErrorAction SilentlyContinue -ErrorVariable jobErr 2>&1) + @($jobErr) |
                    ForEach-Object { "$_" } | Where-Object { $_ } | Select-Object -First 3
                return [pscustomobject]@{ Ready = $false; Reason = "server job $($Job.State) on port ${Port}: $($Why -join ' | ')" }
            }
            try {
                $null = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
                return [pscustomobject]@{ Ready = $false; Reason = "port ${Port} answered 200 to an unauthenticated GET /: not our auth-hardened server" }
            } catch {
                $Resp = $_.Exception.Response
                if ($Resp) {
                    $Code = [int]$Resp.StatusCode
                    if ($Code -eq 401) { return [pscustomobject]@{ Ready = $true; Reason = '' } }
                    return [pscustomobject]@{ Ready = $false; Reason = "port ${Port} answered HTTP $Code (expected 401): not our server" }
                }
            }
        }
        [pscustomobject]@{ Ready = $false; Reason = "server on port $Port not listening after 30s (job state $($Job.State))" }
    }

    # Start the server on an OS-assigned ephemeral port with no browser (t/3547: a fixed port flaked on
    # TIME_WAIT). The probe-then-release has a small race: another process can take the port between
    # the probe's Stop() and the server's bind (HttpListener cannot bind port 0 itself). When that
    # happens the server job fails with "Could not start HTTP listener", or another listener answers
    # with something other than 401. Either way, retry on a fresh port, up to 3 attempts (t/4111).
    $script:ServerReady = $false
    $script:ServerFailure = @()
    for ($Attempt = 1; $Attempt -le 3 -and -not $script:ServerReady; $Attempt++) {
        $script:TestPort = Get-EphemeralPort
        $script:Job = Start-Job -ScriptBlock {
            param($ModPath, $Port)
            Import-Module $ModPath -Force -WarningAction SilentlyContinue
            Register-AIBackend -NoBrowser -Port $Port
        } -ArgumentList $ModulePath, $script:TestPort
        $Result = Wait-AuthTestServer -Job $script:Job -Port $script:TestPort
        if ($Result.Ready) { $script:ServerReady = $true; break }
        $script:ServerFailure += "attempt ${Attempt}: $($Result.Reason)"
        Write-Warning "Register-AIBackend auth test: server not ready, retrying on a fresh port (t/4111): $($Result.Reason)"
        Stop-Job $script:Job -ErrorAction SilentlyContinue
        Remove-Job $script:Job -Force -ErrorAction SilentlyContinue
        $script:Job = $null
    }
}

AfterAll {
    # Stop-Job ends the child process that owns the HttpListener, so the port is released
    # deterministically; -Force removes the job even if Stop-Job raced it (t/4111).
    if ($script:Job) {
        Stop-Job  $script:Job -ErrorAction SilentlyContinue
        Remove-Job $script:Job -Force -ErrorAction SilentlyContinue
    }
}

Describe 'Register-AIBackend auth hardening (t/2527)' -Tag 'security' {

    # ── Source-level assertions ────────────────────────────────────────────────

    It 'HttpListener $Prefix binds to 127.0.0.1 only (not localhost or wildcard)' {
        # Check the specific $Prefix assignment used for Prefixes.Add — not doc/Ollama references
        $script:Src | Should -Match '\$Prefix\s*=\s*"http://127\.0\.0\.1:'
        $script:Src | Should -Not -Match '\$Prefix\s*=\s*"http://localhost:'
        $script:Src | Should -Not -Match '\$Prefix\s*=\s*"http://\+:'
        $script:Src | Should -Not -Match '\$Prefix\s*=\s*"http://\*:'
    }

    It 'Uses FixedTimeEquals for constant-time token comparison' {
        $script:Src | Should -Match 'FixedTimeEquals'
    }

    It 'InitialState contains no unmasked API key fields' {
        # Unmasked keys must not appear as hashtable entries in $InitialState
        $script:Src | Should -Not -Match "gemini_key\s*=\s*\`$Persisted"
        $script:Src | Should -Not -Match "anthropic_key\s*=\s*\`$Persisted"
        $script:Src | Should -Not -Match "groq_key\s*=\s*\`$Persisted"
        $script:Src | Should -Not -Match "openai_key\s*=\s*\`$Persisted"
        $script:Src | Should -Not -Match "zai_key\s*=\s*\`$Persisted"
    }

    It 'All API endpoints have an auth guard (Send-Unauthorized appears in every handler)' {
        # GET /, GET /api/reveal, POST /api/test, POST /api/save — 4 handlers minimum
        ([regex]::Matches($script:Src, 'Send-Unauthorized')).Count | Should -BeGreaterOrEqual 4
    }

    # ── Live-server integration tests ─────────────────────────────────────────

    It 'Server started and is listening' {
        $script:ServerReady | Should -BeTrue -Because ($script:ServerFailure -join '; ')
    }

    It 'GET / without token returns 401' {
        $status = $null
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:$($script:TestPort)/" -UseBasicParsing -ErrorAction Stop
        } catch {
            $status = [int]$_.Exception.Response.StatusCode
        }
        $status | Should -Be 401
    }

    It 'GET /api/reveal without Authorization returns 401' {
        $status = $null
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:$($script:TestPort)/api/reveal?backend=gemini" `
                -UseBasicParsing -ErrorAction Stop
        } catch {
            $status = [int]$_.Exception.Response.StatusCode
        }
        $status | Should -Be 401
    }

    It 'POST /api/save without Authorization returns 401' {
        $status = $null
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:$($script:TestPort)/api/save" `
                -Method Post -Body '{}' -ContentType 'application/json' `
                -UseBasicParsing -ErrorAction Stop
        } catch {
            $status = [int]$_.Exception.Response.StatusCode
        }
        $status | Should -Be 401
    }

    It 'GET /api/reveal with wrong Origin returns 403 (cross-origin block)' {
        $status = $null
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:$($script:TestPort)/api/reveal?backend=gemini" `
                -Headers @{ Origin = 'http://evil.example.com'; Authorization = 'Bearer wrong' } `
                -UseBasicParsing -ErrorAction Stop
        } catch {
            $status = [int]$_.Exception.Response.StatusCode
        }
        $status | Should -Be 403
    }

    It 'GET /api/reveal with spoofed Host header is rejected (DNS-rebinding block)' {
        # Use .NET HttpClient to set the Host header — Invoke-WebRequest restricts it.
        # On Linux, HttpListener rejects a Host-mismatch before the handler runs (404);
        # on Windows our handler fires and returns 403. Both prove the request was blocked.
        $status = $null
        try {
            $handler = [System.Net.Http.HttpClientHandler]::new()
            $client  = [System.Net.Http.HttpClient]::new($handler)
            $req     = [System.Net.Http.HttpRequestMessage]::new(
                [System.Net.Http.HttpMethod]::Get,
                "http://127.0.0.1:$($script:TestPort)/api/reveal?backend=gemini"
            )
            [void]$req.Headers.TryAddWithoutValidation('Authorization', 'Bearer valid-looking-but-wrong')
            [void]$req.Headers.TryAddWithoutValidation('Host', "evil.example:$($script:TestPort)")
            $resp    = $client.SendAsync($req).GetAwaiter().GetResult()
            $status  = [int]$resp.StatusCode
            $client.Dispose()
        } catch {
            # connection refused or other transport error — server not ready
        }
        $status | Should -BeIn @(403, 404)
    }
}
