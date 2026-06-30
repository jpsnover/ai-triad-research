# Tag: health (t/1186)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-AnonymousDebateFlow' -Tag 'health' {

    It 'Is exported from the module' {
        Get-Command Test-AnonymousDebateFlow -Module AITriad -ErrorAction Stop | Should -Not -BeNullOrEmpty
    }

    It 'Exposes BaseUrl, Detailed, StopOnFailure, TimeoutSec parameters' {
        $cmd = Get-Command Test-AnonymousDebateFlow -Module AITriad
        foreach ($p in 'BaseUrl','Detailed','StopOnFailure','TimeoutSec') {
            $cmd.Parameters.ContainsKey($p) | Should -Be $true
        }
    }

    It 'Returns 7 results on a fully passing run' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck {
                [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 12
                    Body = [PSCustomObject]@{ dumpId = 'dump-abc' }; Error = $null
                }
            }
            $result = Test-AnonymousDebateFlow -BaseUrl 'https://stub.example.com' 6>$null
            @($result).Count | Should -Be 7
            @($result | Where-Object { $_.Pass }).Count | Should -Be 7
        }
    }

    It 'Threads the dumpId from step 5 into step 6 path' {
        InModuleScope AITriad {
            $script:capturedPaths = [System.Collections.Generic.List[string]]::new()
            Mock Invoke-RemoteCheck {
                $script:capturedPaths.Add($Path)
                $body = if ($Path -eq '/api/flight-recorder/server-dump') {
                    [PSCustomObject]@{ dumpId = 'd-12345' }
                } else { $null }
                [PSCustomObject]@{ Success = $true; StatusCode = 200; ResponseMs = 1; Body = $body; Error = $null }
            }
            Test-AnonymousDebateFlow -BaseUrl 'https://stub.example.com' 6>$null | Out-Null
            $step6Path = $script:capturedPaths[5]
            $step6Path | Should -BeExactly '/api/flight-recorder/download-merged/d-12345'
        }
    }

    It 'Falls back to "unknown" dumpId when step 5 response lacks one' {
        InModuleScope AITriad {
            $script:capturedPaths = [System.Collections.Generic.List[string]]::new()
            Mock Invoke-RemoteCheck {
                $script:capturedPaths.Add($Path)
                # No dumpId in any response body
                [PSCustomObject]@{ Success = $true; StatusCode = 200; ResponseMs = 1; Body = $null; Error = $null }
            }
            Test-AnonymousDebateFlow -BaseUrl 'https://stub.example.com' 6>$null | Out-Null
            $script:capturedPaths[5] | Should -BeExactly '/api/flight-recorder/download-merged/unknown'
        }
    }

    It 'Stops at first failure when -StopOnFailure is set' {
        InModuleScope AITriad {
            $script:callCount = 0
            Mock Invoke-RemoteCheck {
                $script:callCount++
                if ($script:callCount -eq 2) {
                    [PSCustomObject]@{ Success = $false; StatusCode = 500; ResponseMs = 1; Body = $null; Error = 'boom' }
                } else {
                    [PSCustomObject]@{ Success = $true; StatusCode = 200; ResponseMs = 1; Body = $null; Error = $null }
                }
            }
            $result = Test-AnonymousDebateFlow -BaseUrl 'https://stub.example.com' -StopOnFailure 6>$null
            @($result).Count | Should -Be 2
            $result[-1].Pass | Should -Be $false
            $script:callCount | Should -Be 2
        }
    }

    It 'Continues past a failure when -StopOnFailure is NOT set' {
        InModuleScope AITriad {
            $script:callCount = 0
            Mock Invoke-RemoteCheck {
                $script:callCount++
                if ($script:callCount -eq 2) {
                    [PSCustomObject]@{ Success = $false; StatusCode = 500; ResponseMs = 1; Body = $null; Error = 'boom' }
                } else {
                    [PSCustomObject]@{ Success = $true; StatusCode = 200; ResponseMs = 1; Body = $null; Error = $null }
                }
            }
            $result = Test-AnonymousDebateFlow -BaseUrl 'https://stub.example.com' 6>$null
            @($result).Count | Should -Be 7
            @($result | Where-Object { -not $_.Pass }).Count | Should -Be 1
            @($result | Where-Object { $_.Pass }).Count | Should -Be 6
        }
    }

    It 'Passes a shared WebRequestSession to every step' {
        InModuleScope AITriad {
            $script:sessions = [System.Collections.Generic.List[object]]::new()
            Mock Invoke-RemoteCheck {
                $script:sessions.Add($Session)
                [PSCustomObject]@{ Success = $true; StatusCode = 200; ResponseMs = 1; Body = $null; Error = $null }
            }
            Test-AnonymousDebateFlow -BaseUrl 'https://stub.example.com' 6>$null | Out-Null
            $first = $script:sessions[0]
            $first | Should -Not -BeNullOrEmpty
            # Identity check: every step received the same session object instance
            for ($i = 1; $i -lt $script:sessions.Count; $i++) {
                [object]::ReferenceEquals($script:sessions[$i], $first) | Should -Be $true
            }
        }
    }

    It 'Returns AnonymousFlowStepResult objects with expected fields' {
        InModuleScope AITriad {
            Mock Invoke-RemoteCheck { [PSCustomObject]@{ Success = $true; StatusCode = 200; ResponseMs = 7; Body = $null; Error = $null } }
            $result = Test-AnonymousDebateFlow -BaseUrl 'https://stub.example.com' 6>$null
            $first = $result[0]
            $first.GetType().Name | Should -Be 'AnonymousFlowStepResult'
            $first.Step | Should -Be 1
            $first.Method | Should -Be 'POST'
            $first.Endpoint | Should -BeExactly '/api/auth/anonymous'
            $first.BugTags | Should -BeExactly 't/1060'
        }
    }
}

Describe 'Test-AnonymousDebateFlow - manifest' -Tag 'health' {
    It 'FunctionsToExport includes Test-AnonymousDebateFlow' {
        $manifestPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
        $manifest = Test-ModuleManifest -Path $manifestPath
        $manifest.ExportedFunctions.Keys | Should -Contain 'Test-AnonymousDebateFlow'
    }
}
