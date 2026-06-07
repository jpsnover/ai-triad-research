# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force
}

Describe 'Get-TaxonomyProcess' {

    It 'returns empty when no matching processes are found' {
        Mock Get-Process { return $null } -ModuleName AITriad
        $result = Get-TaxonomyProcess
        $result | Should -BeNullOrEmpty
    }

    It 'identifies an electron process by command line' {
        $fakeProc = [PSCustomObject]@{
            Id        = 9999
            StartTime = [datetime]'2026-06-07T10:00:00'
        }
        Mock Get-Process { return @($fakeProc) } -ModuleName AITriad
        Mock Get-CimInstance {
            [PSCustomObject]@{ CommandLine = 'C:\app\electron.exe taxonomy-editor --no-sandbox' }
        } -ModuleName AITriad

        $result = @(Get-TaxonomyProcess)
        $result.Count | Should -Be 1
        $result[0].PID | Should -Be 9999
        $result[0].Type | Should -Be 'electron'
        $result[0].PipeName | Should -Be 'taxonomy-flight-recorder-9999'
    }

    It 'filters by -Type parameter' {
        $fakeProc = [PSCustomObject]@{
            Id        = 1234
            StartTime = [datetime]'2026-06-07T10:00:00'
        }
        Mock Get-Process { return @($fakeProc) } -ModuleName AITriad
        Mock Get-CimInstance {
            [PSCustomObject]@{ CommandLine = 'node electron.exe taxonomy-editor' }
        } -ModuleName AITriad

        $result = @(Get-TaxonomyProcess -Type 'cli-debate')
        $result.Count | Should -Be 0

        $result2 = @(Get-TaxonomyProcess -Type 'electron')
        $result2.Count | Should -Be 1
    }

    It 'identifies a cli-debate process' {
        $fakeProc = [PSCustomObject]@{
            Id        = 5678
            StartTime = [datetime]'2026-06-07T10:00:00'
        }
        Mock Get-Process { return @($fakeProc) } -ModuleName AITriad
        Mock Get-CimInstance {
            [PSCustomObject]@{ CommandLine = 'node tsx lib/debate/cli.ts --model gemini' }
        } -ModuleName AITriad

        $result = @(Get-TaxonomyProcess)
        $result.Count | Should -Be 1
        $result[0].Type | Should -Be 'cli-debate'
    }
}
