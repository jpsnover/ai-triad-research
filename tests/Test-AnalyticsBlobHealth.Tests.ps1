# Tag: health (t/2702)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Test-AnalyticsBlobHealth (t/2702) — analytics blob container diagnostics.
.DESCRIPTION
    Mocks the az CLI (mirroring TaxEditorBlob.Tests.ps1). The blob-download branch
    writes NDJSON to the --file path so event counting (one line per event) is
    exercised end-to-end. Covers: az missing / not-logged-in guards, a healthy
    round-trip (container present + fresh write + event count), a stale pipeline,
    and a missing container.

    Dynamic dates/timestamps are passed to the module-scoped mock via $global:
    variables (a Pester -MockWith body does not close over It-scope locals and
    does not honor $using:).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-AnalyticsBlobHealth' -Tag 'health' {

    AfterEach {
        Remove-Variable -Name AbhDate, AbhMod -Scope Global -ErrorAction SilentlyContinue
    }

    It 'Throws when az CLI is not found' {
        Mock Get-Command { $null } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        { Test-AnalyticsBlobHealth 2>$null } | Should -Throw
    }

    It 'Throws when az CLI is not logged in' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith { $global:LASTEXITCODE = 1; return $null } -ModuleName AITriad
        { Test-AnalyticsBlobHealth 2>$null } | Should -Throw
    }

    It 'Healthy: container present, fresh write, event count from NDJSON lines' {
        $global:AbhDate = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
        $global:AbhMod  = (Get-Date).ToUniversalTime().AddHours(-1).ToString('o')

        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith {
            param()
            $global:LASTEXITCODE = 0
            if ($args -contains 'account' -and $args -contains 'list') { return '["staitriadtest"]' }
            if ($args -contains 'container' -and $args -contains 'exists') { return '{"exists": true}' }
            if ($args -contains 'blob' -and $args -contains 'list') {
                return "[{`"name`":`"$($global:AbhDate).ndjson`",`"properties`":{`"contentLength`":128,`"lastModified`":`"$($global:AbhMod)`"}}]"
            }
            if ($args -contains 'blob' -and $args -contains 'download') {
                $fi = [array]::IndexOf($args, '--file')
                if ($fi -ge 0) { Set-Content -Path $args[$fi + 1] -Value @('{"event":1}', '{"event":2}', '{"event":3}') }
                return $null
            }
            return '{"id":"sub-123"}'
        } -ModuleName AITriad

        $h = Test-AnalyticsBlobHealth -StorageAccount 'staitriadtest' 6>$null

        $h.ContainerExists   | Should -BeTrue
        $h.Accessible        | Should -BeTrue
        $h.Stale             | Should -BeFalse
        $h.Healthy           | Should -BeTrue
        @($h.RecentBlobs).Count | Should -Be 1
        $h.RecentBlobs[0].EventCount | Should -Be 3 -Because 'the downloaded blob has 3 NDJSON lines'
        $h.TotalRecentEvents | Should -Be 3
    }

    It 'Stale: recent blob but last write older than threshold → unhealthy' {
        $global:AbhDate = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
        $global:AbhMod  = (Get-Date).ToUniversalTime().AddHours(-48).ToString('o')

        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith {
            param()
            $global:LASTEXITCODE = 0
            if ($args -contains 'container' -and $args -contains 'exists') { return '{"exists": true}' }
            if ($args -contains 'blob' -and $args -contains 'list') {
                return "[{`"name`":`"$($global:AbhDate).ndjson`",`"properties`":{`"contentLength`":64,`"lastModified`":`"$($global:AbhMod)`"}}]"
            }
            if ($args -contains 'blob' -and $args -contains 'download') {
                $fi = [array]::IndexOf($args, '--file')
                if ($fi -ge 0) { Set-Content -Path $args[$fi + 1] -Value @('{"event":1}') }
                return $null
            }
            return '{"id":"sub-123"}'
        } -ModuleName AITriad

        $h = Test-AnalyticsBlobHealth -StorageAccount 'staitriadtest' -StaleThresholdHours 24 6>$null

        $h.Stale   | Should -BeTrue
        $h.Healthy | Should -BeFalse
        $h.HoursSinceLastWrite | Should -BeGreaterThan 24
        ($h.Checks | Where-Object { $_.Name -eq 'Pipeline fresh' }).Pass | Should -BeFalse
    }

    It 'Missing container → ContainerExists false, unhealthy' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith {
            param()
            $global:LASTEXITCODE = 0
            if ($args -contains 'container' -and $args -contains 'exists') { return '{"exists": false}' }
            return '{"id":"sub-123"}'
        } -ModuleName AITriad

        $h = Test-AnalyticsBlobHealth -StorageAccount 'staitriadtest' 6>$null

        $h.ContainerExists | Should -BeFalse
        $h.Healthy         | Should -BeFalse
        @($h.RecentBlobs).Count | Should -Be 0 -Because 'no blob listing runs when the container is absent'
    }

    It 'Auto-detects storage account from resource group' {
        $global:AbhDate = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
        $global:AbhMod  = (Get-Date).ToUniversalTime().AddHours(-1).ToString('o')

        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith {
            param()
            $global:LASTEXITCODE = 0
            if ($args -contains 'account' -and $args -contains 'list' -and $args -contains '-g') { return '["staitriadauto"]' }
            if ($args -contains 'container' -and $args -contains 'exists') { return '{"exists": true}' }
            if ($args -contains 'blob' -and $args -contains 'list') {
                return "[{`"name`":`"$($global:AbhDate).ndjson`",`"properties`":{`"contentLength`":32,`"lastModified`":`"$($global:AbhMod)`"}}]"
            }
            if ($args -contains 'blob' -and $args -contains 'download') {
                $fi = [array]::IndexOf($args, '--file')
                if ($fi -ge 0) { Set-Content -Path $args[$fi + 1] -Value @('{"event":1}') }
                return $null
            }
            return '{"id":"sub-123"}'
        } -ModuleName AITriad

        $h = Test-AnalyticsBlobHealth 6>$null
        $h.StorageAccount | Should -Be 'staitriadauto'
    }
}
