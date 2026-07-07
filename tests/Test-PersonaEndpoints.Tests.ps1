# Tag: health (t/1186)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-PersonaEndpoints' -Tag 'health' {

    It 'Is exported from the module' {
        Get-Command Test-PersonaEndpoints -Module AITriad -ErrorAction Stop | Should -Not -BeNullOrEmpty
    }

    It 'Has the documented parameters' {
        $cmd = Get-Command Test-PersonaEndpoints -Module AITriad -ErrorAction Stop
        foreach ($p in 'BaseUrl','Persona','Category','PersonaSecret','Detailed','TimeoutSec') {
            ($cmd.Parameters.Keys -contains $p) | Should -Be $true
        }
    }

    It 'Skips authenticated/admin rows when -PersonaSecret is empty (forward-compatibility)' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck {
                [PSCustomObject]@{ Success = $true; StatusCode = 200; ResponseMs = 1; Body = $null; Error = $null }
            }
            $r = Test-PersonaEndpoints -BaseUrl 'https://stub.example.com' -PersonaSecret '' 6>$null
            $authed = @($r | Where-Object { $_.Persona -eq 'authenticated' })
            $admin  = @($r | Where-Object { $_.Persona -eq 'admin' })
            $authed.Count | Should -BeGreaterThan 0
            $admin.Count  | Should -BeGreaterThan 0
            ($authed | ForEach-Object { $_.Note }) -join '|' | Should -Match 'PersonaSecret'
            ($admin  | ForEach-Object { $_.Note }) -join '|' | Should -Match 'PersonaSecret'
        }
    }

    It 'Always tests the anonymous row regardless of -PersonaSecret' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck {
                [PSCustomObject]@{ Success = $true; StatusCode = 200; ResponseMs = 1; Body = $null; Error = $null }
            }
            $r = Test-PersonaEndpoints -BaseUrl 'https://stub.example.com' -PersonaSecret '' 6>$null
            $anon = @($r | Where-Object { $_.Persona -eq 'anonymous' })
            $anon.Count | Should -BeGreaterThan 0
            @($anon | Where-Object { $_.Note }).Count | Should -Be 0
        }
    }

    It 'Pass=true when admin-gated endpoint returns 403 for anonymous (gate works)' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck {
                # Simulate the auth gate: admin endpoints 403 for non-admin callers
                $isAdminEndpoint = $Path -match '/api/(admin|flight-recorder)'
                if ($isAdminEndpoint) {
                    [PSCustomObject]@{ Success = $false; StatusCode = 403; ResponseMs = 1; Body = $null; Error = 'Forbidden' }
                } else {
                    [PSCustomObject]@{ Success = $true;  StatusCode = 200; ResponseMs = 1; Body = $null; Error = $null }
                }
            }
            $r = Test-PersonaEndpoints -BaseUrl 'https://stub.example.com' -Persona anonymous 6>$null
            # Every anonymous cell should pass: 2xx where expected, 403 where gated
            @($r | Where-Object { -not $_.Pass }).Count | Should -Be 0
        }
    }

    It 'Pass=false when an admin-only endpoint returns 200 for anonymous (gate broken open)' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck {
                # Simulate regression: every endpoint returns 200 even when it should be gated
                [PSCustomObject]@{ Success = $true; StatusCode = 200; ResponseMs = 1; Body = $null; Error = $null }
            }
            $r = Test-PersonaEndpoints -BaseUrl 'https://stub.example.com' -Persona anonymous 6>$null
            $regressions = @($r | Where-Object { -not $_.Pass })
            $regressions.Count | Should -BeGreaterThan 0
            # The admin/debug-category endpoints should be the ones flagged
            ($regressions | Where-Object { $_.Category -in @('Admin','Debug') }).Count | Should -BeGreaterThan 0
        }
    }

    It 'Sends X-Test-Persona + X-Test-Persona-Secret headers when -PersonaSecret is provided' {
        InModuleScope AITriad {
            $script:capturedHeaders = [System.Collections.Generic.List[object]]::new()
            Mock Invoke-RemoteCheck {
                $script:capturedHeaders.Add($ExtraHeaders)
                [PSCustomObject]@{ Success = $true; StatusCode = 200; ResponseMs = 1; Body = $null; Error = $null }
            }
            Test-PersonaEndpoints -BaseUrl 'https://stub.example.com' -Persona authenticated -PersonaSecret 'shh' 6>$null | Out-Null
            $sample = $script:capturedHeaders | Where-Object { $_ } | Select-Object -First 1
            $sample | Should -Not -BeNullOrEmpty
            $sample['X-Test-Persona'] | Should -Be 'authenticated'
            $sample['X-Test-Persona-Secret'] | Should -Be 'shh'
        }
    }

    It '-Category filter limits the endpoints tested' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck {
                [PSCustomObject]@{ Success = $true; StatusCode = 200; ResponseMs = 1; Body = $null; Error = $null }
            }
            $r = Test-PersonaEndpoints -BaseUrl 'https://stub.example.com' -Persona anonymous -Category Admin 6>$null
            @($r | Where-Object { $_.Category -ne 'Admin' }).Count | Should -Be 0
        }
    }

    It 'Returns PersonaEndpointTestResult objects' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck {
                [PSCustomObject]@{ Success = $true; StatusCode = 200; ResponseMs = 1; Body = $null; Error = $null }
            }
            $r = Test-PersonaEndpoints -BaseUrl 'https://stub.example.com' -Persona anonymous 6>$null
            $r[0].GetType().Name | Should -Be 'PersonaEndpointTestResult'
        }
    }
}

Describe 'Test-PersonaEndpoints classifier lattice (t/1355)' -Tag 'health' {

    It 'Cell 1: 200 + text/html SPA shell + ExpectedAccess=false → soft-PASS with Note (no data leak)' {
        InModuleScope AITriad {
            # Production-shape SPA sign-in page inlined here (rather than a $using: var
            # from BeforeAll) — InModuleScope is not a remoting scope, so $using: fails.
            $shellBody = "<!DOCTYPE html>`n<html lang=`"en`">`n<head><title>Sign In — Taxonomy Editor</title></head>`n<body><div id=`"root`"></div></body>`n</html>"
            Mock Invoke-RemoteCheck {
                [PSCustomObject]@{
                    Success     = $true
                    StatusCode  = 200
                    ResponseMs  = 42
                    Body        = $null
                    ContentType = 'text/html; charset=utf-8'
                    RawBody     = $shellBody
                    Error       = $null
                }
            }
            $r = Test-PersonaEndpoints -BaseUrl 'https://stub.example.com' -Persona anonymous -Category Admin 6>$null |
                Where-Object { $_.Endpoint -eq '/api/admin/review/stats' } |
                Select-Object -First 1
            $r                | Should -Not -BeNullOrEmpty
            $r.StatusCode     | Should -Be 200
            $r.ExpectedAccess | Should -Be $false
            $r.ActualAccess   | Should -Be $false        # reclassified: shell != real access
            $r.Pass           | Should -Be $true         # soft-pass
            $r.BodyKind       | Should -Be 'html'
            $r.ContentType    | Should -Match '^text/html'
            $r.Note           | Should -Match 'SPA-shell'
        }
    }

    It 'Cell 2 (CRITICAL): 200 + real JSON + ExpectedAccess=false → HARD-FAIL (real bypass, must NOT be masked)' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck {
                # Simulates a REAL auth bypass — an admin endpoint returns real admin
                # data to an anonymous caller with proper JSON. This MUST fail;
                # the shell-detection refinement is designed to preserve this signal.
                [PSCustomObject]@{
                    Success     = $true
                    StatusCode  = 200
                    ResponseMs  = 55
                    Body        = [PSCustomObject]@{ pendingCount = 42; approvedToday = 7 }
                    ContentType = 'application/json; charset=utf-8'
                    RawBody     = '{"pendingCount":42,"approvedToday":7}'
                    Error       = $null
                }
            }
            $r = Test-PersonaEndpoints -BaseUrl 'https://stub.example.com' -Persona anonymous -Category Admin 6>$null |
                Where-Object { $_.Endpoint -eq '/api/admin/review/stats' } |
                Select-Object -First 1
            $r                | Should -Not -BeNullOrEmpty
            $r.StatusCode     | Should -Be 200
            $r.ExpectedAccess | Should -Be $false
            $r.ActualAccess   | Should -Be $true         # real grant (not reclassified)
            $r.Pass           | Should -Be $false        # ← the guarded property
            $r.BodyKind       | Should -Be 'json'
            $r.Note           | Should -BeNullOrEmpty    # no soft-pass Note applied
        }
    }

    It 'Cell 3: 200 + real JSON + ExpectedAccess=true → PASS (normal grant)' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck {
                [PSCustomObject]@{
                    Success     = $true
                    StatusCode  = 200
                    ResponseMs  = 30
                    Body        = [PSCustomObject]@{ nodes = @(); edges = @() }
                    ContentType = 'application/json; charset=utf-8'
                    RawBody     = '{"nodes":[],"edges":[]}'
                    Error       = $null
                }
            }
            $r = Test-PersonaEndpoints -BaseUrl 'https://stub.example.com' -Persona anonymous -Category Data 6>$null |
                Where-Object { $_.Endpoint -eq '/api/taxonomy/accelerationist' } |
                Select-Object -First 1
            $r                | Should -Not -BeNullOrEmpty
            $r.StatusCode     | Should -Be 200
            $r.ExpectedAccess | Should -Be $true
            $r.ActualAccess   | Should -Be $true
            $r.Pass           | Should -Be $true
            $r.BodyKind       | Should -Be 'json'
        }
    }

    It 'Cell 4: 401 + ExpectedAccess=false → PASS (proper gate)' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck {
                [PSCustomObject]@{
                    Success     = $false
                    StatusCode  = 401
                    ResponseMs  = 25
                    Body        = $null
                    ContentType = 'application/json; charset=utf-8'
                    RawBody     = '{"error":"unauthorized"}'
                    Error       = 'HTTP 401'
                }
            }
            $r = Test-PersonaEndpoints -BaseUrl 'https://stub.example.com' -Persona anonymous -Category Admin 6>$null |
                Where-Object { $_.Endpoint -eq '/api/admin/review/stats' } |
                Select-Object -First 1
            $r                | Should -Not -BeNullOrEmpty
            $r.StatusCode     | Should -Be 401
            $r.ExpectedAccess | Should -Be $false
            $r.ActualAccess   | Should -Be $false
            $r.Pass           | Should -Be $true
            $r.Note           | Should -BeNullOrEmpty    # no shell note for a real 401
        }
    }

    It 'PersonaEndpointTestResult exposes ContentType and BodyKind fields (t/1355 shape check)' {
        InModuleScope AITriad {
            $r = [PersonaEndpointTestResult]::new()
            $r.PSObject.Properties['ContentType'] | Should -Not -BeNullOrEmpty
            $r.PSObject.Properties['BodyKind']    | Should -Not -BeNullOrEmpty
        }
    }

    It '-Detailed renders the matrix without throwing "Format item ends prematurely" (DevOps p/169#4 hotfix regression guard)' {
        # This bug blocked the t/1375 deploy gate: `'  {0,-' + $PathWidth + '}' -f 'Endpoint'`
        # was parsed as `'  {0,-' + $PathWidth + ('}' -f 'Endpoint')` because -f binds
        # tighter than +. The fix is `"  {0,-$PathWidth}" -f 'Endpoint'` — one literal
        # format string via interpolation.
        InModuleScope AITriad {
            Mock -CommandName Invoke-RemoteCheck -MockWith {
                [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 1
                    Body = $null; ContentType = 'application/json'; RawBody = '{}'; Error = $null
                }
            } -ModuleName AITriad
            { Test-PersonaEndpoints -BaseUrl 'https://stub' -Persona anonymous -Detailed 6>$null } |
                Should -Not -Throw
        }
    }
}

Describe 'Test-PersonaEndpoints - manifest' -Tag 'health' {
    It 'FunctionsToExport includes Test-PersonaEndpoints' {
        $manifestPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
        $manifest = Test-ModuleManifest -Path $manifestPath
        $manifest.ExportedFunctions.Keys | Should -Contain 'Test-PersonaEndpoints'
    }
}
