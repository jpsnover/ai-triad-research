# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Get-CriticalInteraction' {

    It 'Returns all 28 CUIs with no parameters' {
        $results = @(Get-CriticalInteraction)
        @($results).Count | Should -Be 28
    }

    It 'Every CUI has required fields' {
        $results = @(Get-CriticalInteraction)
        foreach ($cui in $results) {
            $cui.Id            | Should -Not -BeNullOrEmpty
            $cui.Domain        | Should -Not -BeNullOrEmpty
            $cui.Priority      | Should -Not -BeNullOrEmpty
            $cui.Title         | Should -Not -BeNullOrEmpty
            $cui.Description   | Should -Not -BeNullOrEmpty
            $cui.Preconditions | Should -Not -BeNullOrEmpty
            $cui.PSObject.Properties['ApiChecks']     | Should -Not -BeNullOrEmpty
            $cui.PSObject.Properties['UxSteps']       | Should -Not -BeNullOrEmpty
            $cui.PSObject.Properties['HasScreenshot'] | Should -Not -BeNullOrEmpty
            $cui.Level         | Should -Not -BeNullOrEmpty
        }
    }

    It 'All IDs are unique' {
        $results = @(Get-CriticalInteraction)
        $ids = $results | ForEach-Object { $_.Id }
        $uniqueIds = $ids | Sort-Object -Unique
        @($uniqueIds).Count | Should -Be @($ids).Count
    }

    It 'IDs follow naming convention (CUI-XXX-NNN)' {
        $results = @(Get-CriticalInteraction)
        foreach ($cui in $results) {
            $cui.Id | Should -Match '^CUI-[A-Z]+-\d{3}$'
        }
    }

    It '-Domain filters correctly' {
        $debate = @(Get-CriticalInteraction -Domain Debate)
        @($debate).Count | Should -Be 5
        foreach ($cui in $debate) {
            $cui.Domain | Should -Be 'Debate'
        }
    }

    It '-Priority P0 returns 12 blocking CUIs' {
        $p0 = @(Get-CriticalInteraction -Priority P0)
        @($p0).Count | Should -Be 12
        foreach ($cui in $p0) {
            $cui.Priority | Should -Be 'P0'
        }
    }

    It '-Priority P2 returns 3 CUIs' {
        $p2 = @(Get-CriticalInteraction -Priority P2)
        @($p2).Count | Should -Be 3
        foreach ($cui in $p2) {
            $cui.Priority | Should -Be 'P2'
        }
    }

    It '-Level API returns only CUIs with ApiChecks > 0' {
        $api = @(Get-CriticalInteraction -Level API)
        @($api).Count | Should -BeGreaterThan 0
        foreach ($cui in $api) {
            $cui.ApiChecks | Should -BeGreaterThan 0
        }
    }

    It '-Level UX returns only CUIs with UxSteps > 0' {
        $ux = @(Get-CriticalInteraction -Level UX)
        @($ux).Count | Should -BeGreaterThan 0
        foreach ($cui in $ux) {
            $cui.UxSteps | Should -BeGreaterThan 0
        }
    }

    It '-Level Both returns only CUIs with both API and UX' {
        $both = @(Get-CriticalInteraction -Level Both)
        @($both).Count | Should -BeGreaterThan 0
        foreach ($cui in $both) {
            $cui.ApiChecks | Should -BeGreaterThan 0
            $cui.UxSteps   | Should -BeGreaterThan 0
            $cui.Level     | Should -Be 'Both'
        }
    }

    It '-Level API excludes UX-only CUIs (CUI-DEB-003)' {
        $api = @(Get-CriticalInteraction -Level API)
        $ids = $api | ForEach-Object { $_.Id }
        $ids | Should -Not -Contain 'CUI-DEB-003'
    }

    It 'Filters compose: -Domain Taxonomy -Priority P0' {
        $results = @(Get-CriticalInteraction -Domain Taxonomy -Priority P0)
        @($results).Count | Should -Be 3
        foreach ($cui in $results) {
            $cui.Domain   | Should -Be 'Taxonomy'
            $cui.Priority | Should -Be 'P0'
        }
    }

    It 'Level field is computed correctly from ApiChecks and UxSteps' {
        $results = @(Get-CriticalInteraction)
        foreach ($cui in $results) {
            $hasApi = $cui.ApiChecks -gt 0
            $hasUx  = $cui.UxSteps -gt 0
            if ($hasApi -and $hasUx) {
                $cui.Level | Should -Be 'Both'
            } elseif ($hasApi) {
                $cui.Level | Should -Be 'API'
            } elseif ($hasUx) {
                $cui.Level | Should -Be 'UX'
            }
        }
    }

    It 'Domain distribution matches catalog spec' {
        $all = @(Get-CriticalInteraction)
        $byDomain = $all | Group-Object Domain
        $domainCounts = @{}
        foreach ($g in $byDomain) { $domainCounts[$g.Name] = $g.Count }

        $domainCounts['Taxonomy']    | Should -Be 7
        $domainCounts['Debate']      | Should -Be 5
        $domainCounts['AI']          | Should -Be 3
        $domainCounts['Auth']        | Should -Be 3
        $domainCounts['Admin']       | Should -Be 4
        $domainCounts['Community']   | Should -Be 2
        $domainCounts['Data']        | Should -Be 3
        $domainCounts['Calibration'] | Should -Be 1
    }

    It 'Objects have CriticalInteraction type name' {
        $cui = @(Get-CriticalInteraction)[0]
        $cui.PSObject.TypeNames | Should -Contain 'CriticalInteraction'
    }

    It 'Is discoverable via Get-Command' {
        $cmd = Get-Command Get-CriticalInteraction -ErrorAction SilentlyContinue
        $cmd | Should -Not -BeNullOrEmpty
        $cmd.ModuleName | Should -Be 'AITriad'
    }
}
