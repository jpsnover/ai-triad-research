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

Describe 'Test-PersonaEndpoints - manifest' -Tag 'health' {
    It 'FunctionsToExport includes Test-PersonaEndpoints' {
        $manifestPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
        $manifest = Test-ModuleManifest -Path $manifestPath
        $manifest.ExportedFunctions.Keys | Should -Contain 'Test-PersonaEndpoints'
    }
}
