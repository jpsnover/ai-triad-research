# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AITSBOMPowerShellModules {
    <#
    .SYNOPSIS
        SBOM entries for AITriad.psd1's RequiredModules plus the companion
        modules (AIEnrich, DocConverters, PdfOptimizer). Extracted verbatim
        from Get-AITSBOM (t/3910) -- no behavior change.
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Generic.List[PSObject]])]
    param()

    Set-StrictMode -Version Latest
    $Entries = [System.Collections.Generic.List[PSObject]]::new()

    $ManifestPath = Join-Path $script:ModuleRoot 'AITriad.psd1'
    if (Test-Path $ManifestPath) {
        try {
            $Manifest = Import-PowerShellDataFile -Path $ManifestPath
            if ($Manifest.ContainsKey('RequiredModules') -and $Manifest.RequiredModules) {
                foreach ($Req in $Manifest.RequiredModules) {
                    if ($Req -is [string]) { $ModName = $Req } else { $ModName = $Req.ModuleName }
                    if ($Req -is [hashtable] -and $Req.ModuleVersion) { $ModVer = $Req.ModuleVersion } else { $ModVer = $null }
                    if (-not $ModVer) {
                        $Installed = Get-Module -ListAvailable -Name $ModName -ErrorAction SilentlyContinue | Select-Object -First 1
                        if ($Installed) { $ModVer = $Installed.Version.ToString() } else { $ModVer = 'not installed' }
                    }
                    $Entries.Add([PSCustomObject]@{
                        Name          = $ModName
                        Version       = $ModVer
                        LatestVersion = $null
                        Status        = $null
                        Type          = 'ps-module'
                        Scope         = 'required'
                        Source        = 'AITriad.psd1 RequiredModules'
                        SourceUrl     = "https://www.powershellgallery.com/packages/$ModName/"
                        License       = $null
                        Supplier      = $null
                        Description   = $null
                        Hash          = $null
                        InstalledVia  = 'PSGallery'
                    })
                }
            }
        }
        catch {
            Write-Warning "Failed to read AITriad.psd1: $($_.Exception.Message)"
        }
    }

    foreach ($Companion in @('AIEnrich', 'DocConverters', 'PdfOptimizer')) {
        $CompPath = Join-Path (Join-Path $script:ModuleRoot '..') "$Companion.psm1"
        $CompVer = 'present'
        if (Test-Path $CompPath) {
            $PsdPath = $CompPath -replace '\.psm1$', '.psd1'
            if (Test-Path $PsdPath) {
                try {
                    $CompManifest = Import-PowerShellDataFile -Path $PsdPath
                    $CompVer = $CompManifest.ModuleVersion
                }
                catch { }
            }
        }
        else {
            $CompVer = 'not found'
        }

        $Entries.Add([PSCustomObject]@{
            Name          = $Companion
            Version       = $CompVer
            LatestVersion = $null
            Status        = $null
            Type          = 'ps-module'
            Scope         = 'required'
            Source        = "scripts/$Companion.psm1"
            SourceUrl     = $null
            License       = 'MIT'
            Supplier      = 'AI Triad Research'
            Description   = $null
            Hash          = $null
            InstalledVia  = 'project'
        })
    }

    # Comma-wrap: see Get-AITSBOMAIModels.ps1 for why -- without it, the List[PSObject]
    # flattens to a plain array at the return boundary, losing .AddRange() in the caller.
    return ,$Entries
}
