# Tag: health (t/1474)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression coverage for the false-green fix in Invoke-RemoteCheck (t/1474).
.DESCRIPTION
    The bug the fix targets: production data endpoints were returning
    `text/html` (SPA login page) with HTTP 200 to unauthenticated callers,
    and the smoke test reported Pass=True because:
      (a) `Content-Type` was never inspected, and
      (b) the `ExpectedField` gate short-circuited on `-and $Body` — when
          ConvertFrom-Json failed on HTML, `$Body` was `$null`, the gate
          skipped, and `$Success` stayed `$true`.

    Each `It` mocks `Invoke-WebRequest` to force the exact wire shape
    that produced the false-green in production, then asserts the fixed
    behavior. No live HTTP.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Invoke-RemoteCheck -ExpectJson (t/1474 AC#1)' -Tag 'health' {

    It 'FAILS when server returns 200 text/html and -ExpectJson is set (the false-green production bug)' {
        InModuleScope AITriad {
            Mock Invoke-WebRequest -MockWith {
                [PSCustomObject]@{
                    StatusCode = 200
                    Headers    = @{ 'Content-Type' = @('text/html; charset=utf-8') }
                    Content    = '<!DOCTYPE html><html><title>Sign In</title></html>'
                }
            }

            $r = Invoke-RemoteCheck -BaseUrl 'https://stub' -Path '/api/nodes' -ExpectJson
            $r.StatusCode  | Should -Be 200
            $r.ContentType | Should -Match 'text/html'
            $r.Success     | Should -Be $false -Because 'HTML 200 must FAIL when -ExpectJson is set (t/1474 false-green fix)'
        }
    }

    It 'PASSES when server returns 200 application/json and -ExpectJson is set (backward-compat happy path)' {
        InModuleScope AITriad {
            Mock Invoke-WebRequest -MockWith {
                [PSCustomObject]@{
                    StatusCode = 200
                    Headers    = @{ 'Content-Type' = @('application/json; charset=utf-8') }
                    Content    = '{"nodes":[]}'
                }
            }

            $r = Invoke-RemoteCheck -BaseUrl 'https://stub' -Path '/api/nodes' -ExpectJson
            $r.Success     | Should -Be $true
            $r.ContentType | Should -Match 'application/json'
        }
    }

    It 'PASSES when server returns 200 text/html and -ExpectJson is NOT set (existing callers unaffected — AC#4)' {
        InModuleScope AITriad {
            Mock Invoke-WebRequest -MockWith {
                [PSCustomObject]@{
                    StatusCode = 200
                    Headers    = @{ 'Content-Type' = @('text/html; charset=utf-8') }
                    Content    = '<html>ok</html>'
                }
            }

            # Simulates /third-party-notices — legitimately HTML, no -ExpectJson passed
            $r = Invoke-RemoteCheck -BaseUrl 'https://stub' -Path '/third-party-notices'
            $r.Success | Should -Be $true
        }
    }
}

Describe 'Invoke-RemoteCheck ExpectedField null-body short-circuit (t/1474 AC#3 / Change C)' -Tag 'health' {

    It 'FAILS when ExpectedField is set and body is null (HTML/parse failure)' {
        InModuleScope AITriad {
            # HTML body → ConvertFrom-Json throws → $Body = $null. Pre-fix, the outer
            # `-and $Body` guard skipped the ExpectedField check and Success stayed true.
            Mock Invoke-WebRequest -MockWith {
                [PSCustomObject]@{
                    StatusCode = 200
                    Headers    = @{ 'Content-Type' = @('text/html') }
                    Content    = '<html>oh no</html>'
                }
            }
            $r = Invoke-RemoteCheck -BaseUrl 'https://stub' -Path '/api/nodes' -ExpectedField 'nodes'
            $r.Success | Should -Be $false -Because 'ExpectedField=nodes must fail when body is unparseable (t/1474 Change C)'
        }
    }

    It 'FAILS when ExpectedField is set and body is valid JSON but missing the field' {
        InModuleScope AITriad {
            Mock Invoke-WebRequest -MockWith {
                [PSCustomObject]@{
                    StatusCode = 200
                    Headers    = @{ 'Content-Type' = @('application/json') }
                    Content    = '{"something_else":true}'
                }
            }
            $r = Invoke-RemoteCheck -BaseUrl 'https://stub' -Path '/api/nodes' -ExpectedField 'nodes'
            $r.Success | Should -Be $false
        }
    }

    It 'PASSES when ExpectedField is set and body contains the field' {
        InModuleScope AITriad {
            Mock Invoke-WebRequest -MockWith {
                [PSCustomObject]@{
                    StatusCode = 200
                    Headers    = @{ 'Content-Type' = @('application/json') }
                    Content    = '{"nodes":[]}'
                }
            }
            $r = Invoke-RemoteCheck -BaseUrl 'https://stub' -Path '/api/nodes' -ExpectedField 'nodes'
            $r.Success | Should -Be $true
        }
    }
}

Describe 'Test-TaxEditorEndpoints propagates -ExpectJson for non-Static endpoints (t/1474 AC#2 / Change D)' -Tag 'health' {

    It 'Data-category endpoint reports FAIL when server returns HTML 200 (the exact production regression)' {
        InModuleScope AITriad {
            Mock Get-TaxEditorBaseUrl -MockWith { 'https://stub.example.com' }
            # Server returns SPA shell for every API path — the production false-green scenario.
            Mock Invoke-WebRequest -MockWith {
                [PSCustomObject]@{
                    StatusCode = 200
                    Headers    = @{ 'Content-Type' = @('text/html; charset=utf-8') }
                    Content    = '<!DOCTYPE html><html><title>Sign In</title></html>'
                }
            }

            $results = Test-TaxEditorEndpoints -BaseUrl 'https://stub' -Category Data 6>$null
            $results | Should -Not -BeNullOrEmpty
            # Every Data endpoint should now FAIL because HTML 200 tripped -ExpectJson
            @($results | Where-Object { $_.Pass -eq $true }).Count | Should -Be 0 `
                -Because 'HTML 200 on Data endpoints must no longer report Pass=True (t/1474)'
        }
    }
}
