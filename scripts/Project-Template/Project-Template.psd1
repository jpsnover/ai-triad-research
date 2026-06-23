# Module manifest for Project-Template
# This module provides infrastructure cmdlets for projects created from the ai-research-template.
# Rename this module (directory, .psd1, .psm1) to match your project name after cloning.

@{
    RootModule        = 'Project-Template.psm1'
    ModuleVersion     = '0.1.0'
    GUID              = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'  # Replace with: [guid]::NewGuid()
    Author            = 'Your Name'
    CompanyName       = 'Your Organization'
    Copyright         = '(c) 2026. All rights reserved.'
    Description       = 'Infrastructure cmdlets for project scaffolding, flight recorder analysis, maintenance automation, and compliance.'
    PowerShellVersion = '7.0'

    FunctionsToExport = @(
        # Flight Recorder
        'Get-FlightRecorderDump'
        'Get-FlightRecorderReport'
        'Show-FlightRecorder'
        'Find-FlightRecorderPattern'
        'Test-FlightRecorderPII'

        # Maintenance & Compliance
        'Invoke-VerifyGate'
        'Invoke-LicenseAudit'
        'Invoke-DependencyAudit'
        'Test-VersionConsistency'
        'Test-SBOMCurrency'

        # ADR Management
        'New-ADR'
        'Get-ADRIndex'

        # Project Health & Utilities
        'Get-ProjectHealth'
        'Get-ProjectMap'
        'Initialize-ProjectModule'
    )

    CmdletsToExport   = @()
    VariablesToExport  = @()
    AliasesToExport    = @()

    PrivateData = @{
        PSData = @{
            Tags       = @('project-template', 'flight-recorder', 'compliance', 'maintenance')
            ProjectUri = 'https://github.com/your-org/your-project'
        }
    }
}
