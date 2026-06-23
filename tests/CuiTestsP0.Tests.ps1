# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'CUI Test Infrastructure' {

    It 'New-CuiTestResult produces structured output' {
        InModuleScope AITriad {
            $detail = New-CuiCheckResult -Check 'test' -Pass $true -Detail 'ok' -Ms 10
            $result = New-CuiTestResult -CuiId 'CUI-TEST-001' -Domain 'Test' -Priority 'P0' `
                -DurationMs 100 -Details @($detail)
            $result.CuiId      | Should -Be 'CUI-TEST-001'
            $result.Pass       | Should -BeTrue
            $result.Checks     | Should -Be 1
            $result.Passed     | Should -Be 1
            $result.Failed     | Should -Be 0
            $result.DurationMs | Should -Be 100
        }
    }

    It 'New-CuiTestResult marks failure when any check fails' {
        InModuleScope AITriad {
            $details = @(
                (New-CuiCheckResult -Check 'ok' -Pass $true -Detail 'good')
                (New-CuiCheckResult -Check 'bad' -Pass $false -Detail 'failed')
            )
            $result = New-CuiTestResult -CuiId 'CUI-TEST-002' -Domain 'Test' -Priority 'P0' `
                -DurationMs 50 -Details $details
            $result.Pass   | Should -BeFalse
            $result.Passed | Should -Be 1
            $result.Failed | Should -Be 1
        }
    }

    It 'New-CuiTestResult marks failure with error string' {
        InModuleScope AITriad {
            $result = New-CuiTestResult -CuiId 'CUI-TEST-003' -Domain 'Test' -Priority 'P0' `
                -DurationMs 10 -Details @() -Error 'Something broke'
            $result.Pass  | Should -BeFalse
            $result.Error | Should -Be 'Something broke'
        }
    }

    It 'All 12 P0 test functions are loaded in module scope' {
        InModuleScope AITriad {
            $functions = @(
                'Test-CuiTax001', 'Test-CuiTax002', 'Test-CuiTax010',
                'Test-CuiDeb001', 'Test-CuiDeb002',
                'Test-CuiAi001', 'Test-CuiAi002',
                'Test-CuiAuth001', 'Test-CuiAuth002',
                'Test-CuiAdm001',
                'Test-CuiData001', 'Test-CuiData002'
            )
            foreach ($fn in $functions) {
                Get-Command $fn -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty -Because "$fn should be loaded"
            }
        }
    }
}

Describe 'Test-CuiTax001' {

    It 'Returns pass when all endpoints succeed' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            param($BaseUrl, $Path, $TimeoutSec, $ExpectedField)
            $Body = [PSCustomObject]@{ available = $true }
            if ($Path -like '/api/taxonomy/*') {
                $Body = [PSCustomObject]@{
                    nodes = @(
                        [PSCustomObject]@{ id = 'acc-B-001'; label = 'Test'; category = 'Beliefs' }
                    )
                }
            }
            [PSCustomObject]@{ Success = $true; StatusCode = 200; ResponseMs = 50; Body = $Body; Error = $null }
        }

        InModuleScope AITriad {
            $result = Test-CuiTax001 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-TAX-001'
            $result.Pass   | Should -BeTrue
            $result.Checks | Should -Be 6
            $result.Failed | Should -Be 0
        }
    }

    It 'Returns failure when data is unavailable' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            [PSCustomObject]@{ Success = $false; StatusCode = 503; ResponseMs = 100; Body = $null; Error = 'Service unavailable' }
        }

        InModuleScope AITriad {
            $result = Test-CuiTax001 -BaseUrl 'http://localhost:3000'
            $result.Pass   | Should -BeFalse
            $result.Failed | Should -BeGreaterThan 0
        }
    }
}

Describe 'Test-CuiTax002' {

    It 'Returns pass when nodes have attributes' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 30; Error = $null
                Body = [PSCustomObject]@{
                    nodes = @(
                        [PSCustomObject]@{
                            id = 'acc-B-001'; label = 'Test Node'; description = 'A test'; category = 'Beliefs'
                            graph_attributes = [PSCustomObject]@{ epistemic_type = 'empirical' }
                        }
                    )
                }
            }
        }

        InModuleScope AITriad {
            $result = Test-CuiTax002 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-TAX-002'
            $result.Pass   | Should -BeTrue
            $result.Checks | Should -Be 3
        }
    }
}

Describe 'Test-CuiTax010' {

    It 'Skips mutation checks when not authenticated' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            param($BaseUrl, $Path)
            if ($Path -eq '/api/auth/me') {
                return [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 20; Error = $null
                    Body = [PSCustomObject]@{ anonymous = $true }
                }
            }
            [PSCustomObject]@{ Success = $true; StatusCode = 200; ResponseMs = 20; Body = $null; Error = $null }
        }

        InModuleScope AITriad {
            $result = Test-CuiTax010 -BaseUrl 'http://localhost:3000'
            $result.CuiId | Should -Be 'CUI-TAX-010'
            $result.Error  | Should -BeLike '*no auth*'
            $result.Checks | Should -Be 1
        }
    }
}

Describe 'Test-CuiAuth002' {

    It 'Returns pass when anonymous reads work and writes are blocked' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            param($BaseUrl, $Path)
            if ($Path -eq '/api/auth/me') {
                return [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 15; Error = $null
                    Body = [PSCustomObject]@{ anonymous = $true }
                }
            }
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 30; Error = $null
                Body = [PSCustomObject]@{ nodes = @([PSCustomObject]@{ id = 'test' }) }
            }
        }
        Mock Invoke-WebRequest -ModuleName AITriad -MockWith {
            $ex = [System.Net.Http.HttpRequestException]::new('Forbidden')
            $resp = [PSCustomObject]@{ StatusCode = [System.Net.HttpStatusCode]::Forbidden }
            $ex | Add-Member -NotePropertyName Response -NotePropertyValue $resp
            throw $ex
        }

        InModuleScope AITriad {
            $result = Test-CuiAuth002 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-AUTH-002'
            $result.Checks | Should -Be 4
        }
    }
}

Describe 'Test-CuiAdm001' {

    It 'Returns pass when health endpoints respond' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            param($BaseUrl, $Path)
            if ($Path -eq '/health') {
                return [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 25; Error = $null
                    Body = [PSCustomObject]@{ status = 'ok'; version = '1.0.0' }
                }
            }
            if ($Path -eq '/api/admin/health') {
                return [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 30; Error = $null
                    Body = [PSCustomObject]@{ errorCount = 0; feedbackCount = 5 }
                }
            }
            [PSCustomObject]@{ Success = $true; StatusCode = 200; ResponseMs = 20; Body = $null; Error = $null }
        }

        InModuleScope AITriad {
            $result = Test-CuiAdm001 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-ADM-001'
            $result.Pass   | Should -BeTrue
            $result.Checks | Should -Be 3
        }
    }
}

Describe 'Test-CuiData001' {

    It 'Returns pass when data is available and all POVs loaded' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            param($BaseUrl, $Path)
            if ($Path -eq '/api/data/available') {
                return [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 15; Error = $null
                    Body = [PSCustomObject]@{ available = $true }
                }
            }
            if ($Path -eq '/health') {
                return [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 20; Error = $null
                    Body = [PSCustomObject]@{
                        status = 'ok'
                        github = [PSCustomObject]@{
                            rateLimit = [PSCustomObject]@{ remaining = 4500 }
                        }
                    }
                }
            }
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 40; Error = $null
                Body = [PSCustomObject]@{
                    nodes = @([PSCustomObject]@{ id = 'test-001' })
                }
            }
        }

        InModuleScope AITriad {
            $result = Test-CuiData001 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-DATA-001'
            $result.Pass   | Should -BeTrue
            $result.Checks | Should -Be 3
        }
    }
}

Describe 'Test-CuiData002' {

    It 'Returns pass when sync status and taxonomy load' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            param($BaseUrl, $Path)
            if ($Path -eq '/api/sync/status') {
                return [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 20; Error = $null
                    Body = [PSCustomObject]@{ branch = 'session/user123'; currentBranch = 'session/user123' }
                }
            }
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 30; Error = $null
                Body = [PSCustomObject]@{
                    nodes = @([PSCustomObject]@{ id = 'test-001' })
                }
            }
        }

        InModuleScope AITriad {
            $result = Test-CuiData002 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-DATA-002'
            $result.Pass   | Should -BeTrue
            $result.Checks | Should -Be 3
        }
    }
}

Describe 'CUI Result Structure' {

    It 'All results have PSTypeName CuiTestResult' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 10; Error = $null
                Body = [PSCustomObject]@{
                    available = $true; status = 'ok'; version = '1.0'; anonymous = $true
                    nodes = @([PSCustomObject]@{ id = 'x'; label = 'X'; category = 'B'; description = 'desc' })
                    branch = 'main'
                    github = [PSCustomObject]@{ rateLimit = [PSCustomObject]@{ remaining = 100 } }
                    errorCount = 0
                }
            }
        }
        Mock Invoke-WebRequest -ModuleName AITriad -MockWith {
            $ex = [System.Net.Http.HttpRequestException]::new('Forbidden')
            $resp = [PSCustomObject]@{ StatusCode = [System.Net.HttpStatusCode]::Forbidden }
            $ex | Add-Member -NotePropertyName Response -NotePropertyValue $resp
            throw $ex
        }

        InModuleScope AITriad {
            $functions = @(
                'Test-CuiTax001', 'Test-CuiTax002', 'Test-CuiTax010',
                'Test-CuiAdm001', 'Test-CuiData001', 'Test-CuiData002',
                'Test-CuiAuth002'
            )
            foreach ($fn in $functions) {
                $result = & $fn -BaseUrl 'http://localhost:3000'
                $result.PSObject.TypeNames | Should -Contain 'CuiTestResult' -Because "$fn should return CuiTestResult"
                $result.PSObject.Properties['CuiId']      | Should -Not -BeNullOrEmpty -Because "$fn must have CuiId"
                $result.PSObject.Properties['Pass']        | Should -Not -BeNullOrEmpty -Because "$fn must have Pass"
                $result.PSObject.Properties['DurationMs']  | Should -Not -BeNullOrEmpty -Because "$fn must have DurationMs"
                $result.PSObject.Properties['Checks']      | Should -Not -BeNullOrEmpty -Because "$fn must have Checks"
                $result.PSObject.Properties['Passed']      | Should -Not -BeNullOrEmpty -Because "$fn must have Passed"
                $result.PSObject.Properties['Failed']      | Should -Not -BeNullOrEmpty -Because "$fn must have Failed"
                $result.PSObject.Properties['Details']     | Should -Not -BeNullOrEmpty -Because "$fn must have Details"
            }
        }
    }
}
