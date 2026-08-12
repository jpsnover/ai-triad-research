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

    # Start server on an ephemeral test port with no browser
    $script:TestPort = 19943
    $script:Job = Start-Job -ScriptBlock {
        param($ModPath, $Port)
        Import-Module $ModPath -Force -WarningAction SilentlyContinue
        Register-AIBackend -NoBrowser -Port $Port
    } -ArgumentList $ModulePath, $script:TestPort

    # Wait up to 4 s for the listener to accept connections (expect 401 on unauth GET /)
    $script:ServerReady = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 100
        try {
            $null = Invoke-WebRequest -Uri "http://127.0.0.1:$($script:TestPort)/" -UseBasicParsing -ErrorAction Stop
        } catch {
            if ($_.Exception.Response) { $script:ServerReady = $true; break }
        }
    }
}

AfterAll {
    if ($script:Job) {
        Stop-Job  $script:Job -ErrorAction SilentlyContinue
        Remove-Job $script:Job -ErrorAction SilentlyContinue
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
        $script:ServerReady | Should -BeTrue
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

    It 'GET /api/reveal with spoofed Host header returns 403 (DNS-rebinding block)' {
        # Use .NET HttpClient to set the Host header — Invoke-WebRequest restricts it
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
        $status | Should -Be 403
    }
}
