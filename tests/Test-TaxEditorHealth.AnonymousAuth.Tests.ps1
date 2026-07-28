# Tag: health (t/1841)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Covers the anonymous-auth probe added to Test-TaxEditorHealth in t/1841.
.DESCRIPTION
    A server can pass /healthz + /health while its anonymous-auth layer is
    broken — every real API call then returns the login-page HTML instead of
    JSON (flight recorder 2026-07-28). Invoke-HealthProbe now adds two checks:
      - /.auth/anonymous must return 2xx AND set a session cookie
      - /api/flags (authenticated with that cookie) must return JSON, not the
        login shell
    Both sink overall Healthy so a broken auth layer no longer reads as healthy.

    /healthz + /health are mocked healthy throughout so the assertions isolate
    the auth-probe behavior; New-AnonymousWebSession is mocked to control the
    cookie jar and Invoke-WebRequest to control the /api/flags response.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-TaxEditorHealth anonymous-auth probe (t/1841)' -Tag 'health' {

    # Healthy liveness/readiness so only the auth probe drives the outcome.
    BeforeEach {
        InModuleScope AITriad {
            Mock Invoke-WebRequest -MockWith {
                param($Uri)
                if ($Uri -match '/healthz$') {
                    [PSCustomObject]@{ StatusCode = 200; Headers = @{ 'Content-Type' = @('application/json') }; Content = '{"status":"healthy"}' }
                } elseif ($Uri -match '/health$') {
                    [PSCustomObject]@{ StatusCode = 200; Headers = @{ 'Content-Type' = @('application/json') }; Content = '{"status":"ok"}' }
                } elseif ($Uri -match '/api/flags$') {
                    [PSCustomObject]@{ StatusCode = 200; Headers = @{ 'Content-Type' = @('application/json') }; Content = '{"someFlag":true}' }
                }
            }
        }
    }

    It 'Passes when /.auth/anonymous sets a cookie and /api/flags returns JSON' {
        InModuleScope AITriad {
            Mock New-AnonymousWebSession -MockWith {
                $s = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
                $s.Cookies.Add([System.Net.Cookie]::new('AppServiceAuthSession', 'x', '/', 'stub.local'))
                $s
            }

            $result = Test-TaxEditorHealth -BaseUrl 'https://stub' -TimeoutSec 1

            $auth  = $result.Checks | Where-Object { $_.Endpoint -eq '/.auth/anonymous' }
            $flags = $result.Checks | Where-Object { $_.Endpoint -eq '/api/flags' }
            $auth.Healthy  | Should -Be $true
            $flags.Healthy | Should -Be $true
            $result.Healthy | Should -Be $true
        }
    }

    It 'Fails when /.auth/anonymous establishes no session (non-2xx / transport error)' {
        InModuleScope AITriad {
            Mock New-AnonymousWebSession -MockWith { $null }

            $result = Test-TaxEditorHealth -BaseUrl 'https://stub' -TimeoutSec 1

            $auth = $result.Checks | Where-Object { $_.Endpoint -eq '/.auth/anonymous' }
            $auth.Healthy   | Should -Be $false
            $auth.Detail    | Should -Match 'no session established'
            $result.Healthy | Should -Be $false -Because 'a broken anon-auth layer must sink health'
            # /api/flags is skipped when no session was established.
            @($result.Checks | Where-Object { $_.Endpoint -eq '/api/flags' }).Count | Should -Be 0
        }
    }

    It 'Fails when /.auth/anonymous returns 2xx but sets no cookie' {
        InModuleScope AITriad {
            Mock New-AnonymousWebSession -MockWith {
                # 2xx but empty cookie jar — auth layer not issuing sessions.
                [Microsoft.PowerShell.Commands.WebRequestSession]::new()
            }

            $result = Test-TaxEditorHealth -BaseUrl 'https://stub' -TimeoutSec 1

            $auth = $result.Checks | Where-Object { $_.Endpoint -eq '/.auth/anonymous' }
            $auth.Healthy   | Should -Be $false
            $auth.Detail    | Should -Match 'no Set-Cookie'
            $result.Healthy | Should -Be $false
        }
    }

    It 'Fails when /api/flags returns the login-page HTML instead of JSON' {
        InModuleScope AITriad {
            Mock New-AnonymousWebSession -MockWith {
                $s = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
                $s.Cookies.Add([System.Net.Cookie]::new('AppServiceAuthSession', 'x', '/', 'stub.local'))
                $s
            }
            # Override /api/flags to serve the login shell (200 text/html).
            Mock Invoke-WebRequest -MockWith {
                param($Uri)
                if ($Uri -match '/healthz$') {
                    [PSCustomObject]@{ StatusCode = 200; Headers = @{ 'Content-Type' = @('application/json') }; Content = '{"status":"healthy"}' }
                } elseif ($Uri -match '/health$') {
                    [PSCustomObject]@{ StatusCode = 200; Headers = @{ 'Content-Type' = @('application/json') }; Content = '{"status":"ok"}' }
                } elseif ($Uri -match '/api/flags$') {
                    [PSCustomObject]@{ StatusCode = 200; Headers = @{ 'Content-Type' = @('text/html') }; Content = '<html><body>Sign In</body></html>' }
                }
            }

            $result = Test-TaxEditorHealth -BaseUrl 'https://stub' -TimeoutSec 1

            $auth  = $result.Checks | Where-Object { $_.Endpoint -eq '/.auth/anonymous' }
            $flags = $result.Checks | Where-Object { $_.Endpoint -eq '/api/flags' }
            $auth.Healthy   | Should -Be $true -Because 'the cookie was issued; the failure is downstream'
            $flags.Healthy  | Should -Be $false
            $flags.Detail   | Should -Match 'login-page HTML'
            $result.Healthy | Should -Be $false
        }
    }
}
