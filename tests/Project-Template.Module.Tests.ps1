# Tag: template (t/1186)
BeforeAll {
    $script:ptRoot = "$PSScriptRoot/../scripts/Project-Template"
}

Describe 'Project-Template Module Manifest' -Tag 'template' {

    It 'passes Test-ModuleManifest' {
        $manifestPath = Join-Path $script:ptRoot 'Project-Template.psd1'
        { Test-ModuleManifest -Path $manifestPath } | Should -Not -Throw
    }

    It 'declares PowerShell 7+ minimum' {
        $manifest = Import-PowerShellDataFile (Join-Path $script:ptRoot 'Project-Template.psd1')
        $manifest.PowerShellVersion | Should -Be '7.0'
    }
}

Describe 'Project-Template Module Loading' -Tag 'template' {

    BeforeAll {
        Import-Module (Join-Path $script:ptRoot 'Project-Template.psd1') -Force
    }

    AfterAll {
        Remove-Module Project-Template -ErrorAction SilentlyContinue
    }

    It 'exports exactly 15 functions' {
        $exported = (Get-Module Project-Template).ExportedFunctions.Keys
        $exported.Count | Should -Be 15
    }

    It 'exports all flight recorder cmdlets' {
        $expected = @('Get-FlightRecorderDump', 'Get-FlightRecorderReport', 'Show-FlightRecorder', 'Find-FlightRecorderPattern', 'Test-FlightRecorderPII')
        $exported = (Get-Module Project-Template).ExportedFunctions.Keys
        foreach ($fn in $expected) {
            $fn | Should -BeIn $exported
        }
    }

    It 'exports all maintenance cmdlets' {
        $expected = @('Invoke-VerifyGate', 'Invoke-LicenseAudit', 'Invoke-DependencyAudit', 'Test-VersionConsistency', 'Test-SBOMCurrency')
        $exported = (Get-Module Project-Template).ExportedFunctions.Keys
        foreach ($fn in $expected) {
            $fn | Should -BeIn $exported
        }
    }

    It 'exports all ADR cmdlets' {
        $expected = @('New-ADR', 'Get-ADRIndex')
        $exported = (Get-Module Project-Template).ExportedFunctions.Keys
        foreach ($fn in $expected) {
            $fn | Should -BeIn $exported
        }
    }

    It 'exports all utility cmdlets' {
        $expected = @('Get-ProjectHealth', 'Get-ProjectMap', 'Initialize-ProjectModule')
        $exported = (Get-Module Project-Template).ExportedFunctions.Keys
        foreach ($fn in $expected) {
            $fn | Should -BeIn $exported
        }
    }

    It 'does not export private helpers' {
        $exported = (Get-Module Project-Template).ExportedFunctions.Keys
        'New-ActionableError' | Should -Not -BeIn $exported
        'Invoke-WithRecovery' | Should -Not -BeIn $exported
    }

    It 'exports no cmdlets, variables, or aliases' {
        $mod = Get-Module Project-Template
        $mod.ExportedCmdlets.Count | Should -Be 0
        $mod.ExportedVariables.Count | Should -Be 0
        $mod.ExportedAliases.Count | Should -Be 0
    }
}
