# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'P1/P2 CUI Test Functions Loaded' {

    It 'All 15 P1/P2 test functions are loaded in module scope' {
        InModuleScope AITriad {
            $functions = @(
                'Test-CuiTax003', 'Test-CuiTax004', 'Test-CuiTax005', 'Test-CuiTax011',
                'Test-CuiDeb004', 'Test-CuiDeb005',
                'Test-CuiAi003',
                'Test-CuiAuth003',
                'Test-CuiAdm002', 'Test-CuiAdm003', 'Test-CuiAdm004',
                'Test-CuiCom001', 'Test-CuiCom002',
                'Test-CuiData003',
                'Test-CuiCal001'
            )
            foreach ($fn in $functions) {
                Get-Command $fn -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty -Because "$fn should be loaded"
            }
        }
    }
}

Describe 'Test-CuiTax003' {

    It 'Returns pass when taxonomy has searchable nodes' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 20; Error = $null
                Body = [PSCustomObject]@{
                    nodes = @(
                        [PSCustomObject]@{ id = 'acc-B-001'; label = 'AI Progress'; description = 'Progress in AI'; category = 'Beliefs' }
                    )
                }
            }
        }

        InModuleScope AITriad {
            $result = Test-CuiTax003 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-TAX-003'
            $result.Pass   | Should -BeTrue
            $result.Checks | Should -Be 3
        }
    }
}

Describe 'Test-CuiTax004' {

    It 'Returns pass when edges have source and target' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 25; Error = $null
                Body = @(
                    [PSCustomObject]@{ source = 'acc-B-001'; target = 'saf-B-001'; type = 'attacks' }
                    [PSCustomObject]@{ source = 'acc-B-002'; target = 'skp-B-001'; type = 'supports' }
                )
            }
        }

        InModuleScope AITriad {
            $result = Test-CuiTax004 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-TAX-004'
            $result.Pass   | Should -BeTrue
            $result.Checks | Should -Be 4
        }
    }
}

Describe 'Test-CuiTax005' {

    It 'Returns pass when policy registry and lineage load' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 15; Error = $null
                Body = [PSCustomObject]@{ actions = @('pol-001') }
            }
        }

        InModuleScope AITriad {
            $result = Test-CuiTax005 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-TAX-005'
            $result.Pass   | Should -BeTrue
            $result.Checks | Should -Be 3
        }
    }
}

Describe 'Test-CuiTax011' {

    It 'Returns pass when sync endpoints are accessible' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            param($BaseUrl, $Path)
            if ($Path -eq '/api/sync/status') {
                return [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 20; Error = $null
                    Body = [PSCustomObject]@{ branch = 'session/user123'; currentBranch = 'session/user123' }
                }
            }
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 15; Error = $null
                Body = [PSCustomObject]@{ files = @() }
            }
        }
        Mock Invoke-WebRequest -ModuleName AITriad -MockWith {
            $ex = [System.Net.Http.HttpRequestException]::new('Bad Request')
            $resp = [PSCustomObject]@{ StatusCode = [System.Net.HttpStatusCode]::BadRequest }
            $ex | Add-Member -NotePropertyName Response -NotePropertyValue $resp
            throw $ex
        }

        InModuleScope AITriad {
            $result = Test-CuiTax011 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-TAX-011'
            $result.Checks | Should -Be 5
        }
    }
}

Describe 'Test-CuiDeb004' {

    It 'Returns pass when save and resume round-trips' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            param($BaseUrl, $Path)
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 20; Error = $null
                Body = [PSCustomObject]@{
                    id = 'cui-save-test-mock'
                    topic = 'CUI save/resume test'
                    transcript = @(
                        [PSCustomObject]@{ role = 'accelerationist'; content = 'Test turn 1' }
                        [PSCustomObject]@{ role = 'safetyist'; content = 'Test turn 2' }
                    )
                }
            }
        }
        Mock Invoke-WebRequest -ModuleName AITriad -MockWith {
            [PSCustomObject]@{ StatusCode = 200; Content = '{"ok":true}' }
        }

        InModuleScope AITriad {
            $result = Test-CuiDeb004 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-DEB-004'
            $result.Pass   | Should -BeTrue
            $result.Checks | Should -Be 3
        }
    }
}

Describe 'Test-CuiDeb005' {

    It 'Returns pass when create-delete-verify cycle succeeds' {
        $script:deleteCallCount = 0
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            param($BaseUrl, $Path)
            if ($Path -match '/api/debates/cui-del-test') {
                if ($script:deleteCallCount -gt 0) {
                    return [PSCustomObject]@{
                        Success = $false; StatusCode = 404; ResponseMs = 10; Error = 'Not found'
                        Body = $null
                    }
                }
                return [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 15; Error = $null
                    Body = [PSCustomObject]@{ id = 'cui-del-test-mock'; topic = 'test' }
                }
            }
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 10; Error = $null
                Body = $null
            }
        }
        Mock Invoke-WebRequest -ModuleName AITriad -MockWith {
            param($Uri, $Method)
            if ($Method -eq 'DELETE') { $script:deleteCallCount++ }
            [PSCustomObject]@{ StatusCode = 200; Content = '{"ok":true}' }
        }

        InModuleScope AITriad {
            $result = Test-CuiDeb005 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-DEB-005'
            $result.Checks | Should -Be 4
        }
    }
}

Describe 'Test-CuiAi003' {

    It 'Returns pass when tier and usage endpoints respond' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            param($BaseUrl, $Path)
            if ($Path -eq '/api/proxy/tier') {
                return [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 10; Error = $null
                    Body = [PSCustomObject]@{ tier = 'free' }
                }
            }
            if ($Path -eq '/api/proxy/usage') {
                return [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 10; Error = $null
                    Body = [PSCustomObject]@{ requests = 5; tokensToday = 1000 }
                }
            }
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 10; Error = $null
                Body = @('gemini')
            }
        }

        InModuleScope AITriad {
            $result = Test-CuiAi003 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-AI-003'
            $result.Pass   | Should -BeTrue
            $result.Checks | Should -Be 3
        }
    }
}

Describe 'Test-CuiAuth003' {

    It 'Returns pass when admin endpoints reject non-admin' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 10; Error = $null
                Body = [PSCustomObject]@{ anonymous = $true }
            }
        }
        Mock Invoke-WebRequest -ModuleName AITriad -MockWith {
            $ex = [System.Net.Http.HttpRequestException]::new('Forbidden')
            $resp = [PSCustomObject]@{ StatusCode = [System.Net.HttpStatusCode]::Forbidden }
            $ex | Add-Member -NotePropertyName Response -NotePropertyValue $resp
            throw $ex
        }

        InModuleScope AITriad {
            $result = Test-CuiAuth003 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-AUTH-003'
            $result.Checks | Should -Be 4
        }
    }
}

Describe 'Test-CuiAdm002' {

    It 'Returns pass when analytics endpoints respond' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 20; Error = $null
                Body = [PSCustomObject]@{ totalEvents = 100; uniqueUsers = 5 }
            }
        }

        InModuleScope AITriad {
            $result = Test-CuiAdm002 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-ADM-002'
            $result.Pass   | Should -BeTrue
            $result.Checks | Should -Be 3
        }
    }
}

Describe 'Test-CuiAdm003' {

    It 'Returns pass when error reporting works' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 15; Error = $null
                Body = [PSCustomObject]@{ errorCount = 3; feedbackCount = 10 }
            }
        }
        Mock Invoke-WebRequest -ModuleName AITriad -MockWith {
            [PSCustomObject]@{ StatusCode = 200; Content = '{"ok":true}' }
        }

        InModuleScope AITriad {
            $result = Test-CuiAdm003 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-ADM-003'
            $result.Pass   | Should -BeTrue
            $result.Checks | Should -Be 2
        }
    }
}

Describe 'Test-CuiAdm004' {

    It 'Returns pass when flight recorder list loads' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 20; Error = $null
                Body = [PSCustomObject]@{ files = @('dump-001.jsonl', 'dump-002.jsonl') }
            }
        }
        Mock Invoke-WebRequest -ModuleName AITriad -MockWith {
            [PSCustomObject]@{ StatusCode = 200; Content = '{"ok":true}' }
        }

        InModuleScope AITriad {
            $result = Test-CuiAdm004 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-ADM-004'
            $result.Pass   | Should -BeTrue
            $result.Checks | Should -Be 3
        }
    }
}

Describe 'Test-CuiCom001' {

    It 'Returns pass when community lists load' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 15; Error = $null
                Body = @()
            }
        }

        InModuleScope AITriad {
            $result = Test-CuiCom001 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-COM-001'
            $result.Pass   | Should -BeTrue
            $result.Checks | Should -Be 3
        }
    }
}

Describe 'Test-CuiCom002' {

    It 'Skips when not authenticated' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 10; Error = $null
                Body = [PSCustomObject]@{ anonymous = $true }
            }
        }

        InModuleScope AITriad {
            $result = Test-CuiCom002 -BaseUrl 'http://localhost:3000'
            $result.CuiId | Should -Be 'CUI-COM-002'
            $result.Error  | Should -BeLike '*no auth*'
            $result.Checks | Should -Be 1
        }
    }
}

Describe 'Test-CuiData003' {

    It 'Returns pass when health and liveness respond' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            param($BaseUrl, $Path)
            if ($Path -eq '/health') {
                return [PSCustomObject]@{
                    Success = $true; StatusCode = 200; ResponseMs = 15; Error = $null
                    Body = [PSCustomObject]@{ status = 'ok'; version = '1.0.0'; uptime = 3600 }
                }
            }
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 10; Error = $null
                Body = [PSCustomObject]@{ status = 'ok' }
            }
        }

        InModuleScope AITriad {
            $result = Test-CuiData003 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-DATA-003'
            $result.Pass   | Should -BeTrue
            $result.Checks | Should -Be 3
        }
    }
}

Describe 'Test-CuiCal001' {

    It 'Returns pass when calibration endpoints respond' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 20; Error = $null
                Body = @()
            }
        }

        InModuleScope AITriad {
            $result = Test-CuiCal001 -BaseUrl 'http://localhost:3000'
            $result.CuiId  | Should -Be 'CUI-CAL-001'
            $result.Pass   | Should -BeTrue
            $result.Checks | Should -Be 3
        }
    }
}

Describe 'P1/P2 CUI Result Structure' {

    It 'All results have PSTypeName CuiTestResult' {
        Mock Invoke-RemoteCheck -ModuleName AITriad -MockWith {
            [PSCustomObject]@{
                Success = $true; StatusCode = 200; ResponseMs = 10; Error = $null
                Body = [PSCustomObject]@{
                    available = $true; status = 'ok'; version = '1.0'; anonymous = $true; tier = 'free'
                    nodes = @([PSCustomObject]@{ id = 'x'; label = 'X'; category = 'B'; description = 'desc' })
                    branch = 'main'; files = @(); actions = @()
                    requests = 0; tokensToday = 0
                    errorCount = 0; feedbackCount = 0
                    totalEvents = 0; uniqueUsers = 0
                    uptime = 3600
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
                'Test-CuiTax003', 'Test-CuiTax005',
                'Test-CuiAi003',
                'Test-CuiAdm002',
                'Test-CuiCom001',
                'Test-CuiData003',
                'Test-CuiCal001'
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
