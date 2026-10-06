# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AITSBOM {
    <#
    .SYNOPSIS
        Generates a Software Bill of Materials (SBOM) for the AI Triad project.
    .DESCRIPTION
        Enumerates all project dependencies across PowerShell modules, Node.js
        packages, Python packages, system tools, AI models, and schemas.

        Enriches entries with license, supplier, description, and integrity hash
        from local lock files and package metadata (no network calls).

        With -CheckUpdates, queries package registries for latest versions.
        With -Update, upgrades outdated packages (prompts unless -Force).
    .PARAMETER CheckUpdates
        Query registries for latest available versions.
    .PARAMETER Update
        Update outdated packages. Prompts for confirmation unless -Force.
    .PARAMETER Force
        Skip confirmation prompts when updating.
    .PARAMETER Format
        Output format: Table (default), Json, Csv, CycloneDX, SPDX.
    .PARAMETER RepoRoot
        Repository root path. Defaults to module-resolved root.
    .EXAMPLE
        Get-AITSBOM
    .EXAMPLE
        Get-AITSBOM -CheckUpdates
    .EXAMPLE
        Get-AITSBOM -Format Json | Set-Content sbom.json
    .EXAMPLE
        Get-AITSBOM -Format CycloneDX | Set-Content sbom.cdx.json
    .LINK
        Show-AITriadHelp
    .LINK
        Invoke-PIIAudit
    .LINK
        Show-OSSLicenses
    .NOTES
        t/3910: decomposed into AITriad/Private helpers (one per enumeration
        source, two enrichment passes, the -CheckUpdates and -Update
        dispatchers, and the CycloneDX/SPDX converters) to bring this
        cmdlet's own complexity under the ratchet threshold. Pure refactor
        -- no behavior change; see each helper's own docstring for exactly
        what it carries over verbatim.
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [switch]$CheckUpdates,

        [switch]$Update,

        [switch]$Force,

        [ValidateSet('Table', 'Json', 'Csv', 'CycloneDX', 'SPDX')]
        [string]$Format = 'Table',

        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    if ($Update) { $CheckUpdates = $true }

    Write-Verbose 'Scanning PowerShell modules...'
    $Entries = Get-AITSBOMPowerShellModules
    Write-Verbose 'Scanning Node.js packages...'
    $Entries.AddRange((Get-AITSBOMNodePackages -RepoRoot $RepoRoot))
    Write-Verbose 'Scanning Python packages...'
    $Entries.AddRange((Get-AITSBOMPythonPackages -RepoRoot $RepoRoot))
    Write-Verbose 'Scanning system tools...'
    $Entries.AddRange((Get-AITSBOMSystemTools))
    Write-Verbose 'Scanning AI models...'
    $Entries.AddRange((Get-AITSBOMAIModels -RepoRoot $RepoRoot))
    Write-Verbose 'Scanning schemas...'
    $Entries.AddRange((Get-AITSBOMSchemas -RepoRoot $RepoRoot))

    Write-Verbose 'Enriching from local metadata...'
    Update-AITSBOMNpmMetadata -Entries $Entries -RepoRoot $RepoRoot
    Update-AITSBOMPythonMetadata -Entries $Entries

    if ($CheckUpdates) {
        Write-Verbose 'Checking for updates...'
        foreach ($Entry in $Entries) { Update-AITSBOMLatestVersion -Entry $Entry }
    }

    if ($Update) {
        Invoke-AITSBOMPackageUpdate -Entries $Entries -RepoRoot $RepoRoot -Force:$Force
    }

    # ── Output formatting ─────────────────────────────────────────────────────
    $BaseFields = @('Name', 'Version', 'Type', 'Scope', 'License', 'Supplier', 'InstalledVia', 'Source', 'SourceUrl', 'Description', 'Hash')
    if ($CheckUpdates) {
        $AllFields = @('Name', 'Version', 'LatestVersion', 'Status') + @('Type', 'Scope', 'License', 'Supplier', 'InstalledVia', 'Source', 'SourceUrl', 'Description', 'Hash')
        $OutputEntries = $Entries | Select-Object $AllFields
    }
    else {
        $OutputEntries = $Entries | Select-Object $BaseFields
    }

    switch ($Format) {
        'Table' {
            return $Entries
        }
        'Json' {
            return ($OutputEntries | ConvertTo-Json -Depth 5)
        }
        'Csv' {
            return ($OutputEntries | ConvertTo-Csv -NoTypeInformation)
        }
        'CycloneDX' {
            return (ConvertTo-AITSBOMCycloneDX -Entries $Entries)
        }
        'SPDX' {
            return (ConvertTo-AITSBOMSpdx -Entries $Entries)
        }
    }
}
