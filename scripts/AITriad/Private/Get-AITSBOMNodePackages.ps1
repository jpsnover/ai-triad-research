# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AITSBOMNodePackages {
    <#
    .SYNOPSIS
        SBOM entries for npm dependencies/devDependencies across the root and
        every app dir's package.json. Extracted verbatim from Get-AITSBOM
        (t/3910) -- no behavior change.
    .PARAMETER RepoRoot
        Repository root path.
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Generic.List[PSObject]])]
    param(
        [Parameter(Mandatory)]
        [string]$RepoRoot
    )

    Set-StrictMode -Version Latest
    $Entries = [System.Collections.Generic.List[PSObject]]::new()

    $AppDirs = @('taxonomy-editor', 'poviewer', 'summary-viewer', 'workflow-app', 'lib')
    $RootPkg = Join-Path $RepoRoot 'package.json'
    if (Test-Path $RootPkg) { $AppDirs = @('') + $AppDirs }

    foreach ($AppDir in $AppDirs) {
        if ($AppDir) { $PkgPath = Join-Path (Join-Path $RepoRoot $AppDir) 'package.json' } else { $PkgPath = $RootPkg }
        if (-not (Test-Path $PkgPath)) { continue }

        if ($AppDir) { $SourceLabel = "$AppDir/package.json" } else { $SourceLabel = 'package.json' }
        try {
            $Pkg = Get-Content -Raw -Path $PkgPath | ConvertFrom-Json

            foreach ($DepType in @('dependencies', 'devDependencies')) {
                if (-not $Pkg.PSObject.Properties[$DepType]) { continue }
                $DepScope = if ($DepType -eq 'devDependencies') { 'development' } else { 'required' }
                $PkgType  = if ($DepType -eq 'devDependencies') { 'npm-dev' } else { 'npm' }
                foreach ($Prop in $Pkg.$DepType.PSObject.Properties) {
                    $CleanVer = $Prop.Value -replace '[\^~>=<]', ''
                    $Entries.Add([PSCustomObject]@{
                        Name          = $Prop.Name
                        Version       = $CleanVer
                        LatestVersion = $null
                        Status        = $null
                        Type          = $PkgType
                        Scope         = $DepScope
                        Source        = $SourceLabel
                        SourceUrl     = "https://www.npmjs.com/package/$($Prop.Name)"
                        License       = $null
                        Supplier      = $null
                        Description   = $null
                        Hash          = $null
                        InstalledVia  = 'npm'
                    })
                }
            }
        }
        catch {
            Write-Warning "Failed to parse $SourceLabel`: $($_.Exception.Message)"
        }
    }

    # Comma-wrap: see Get-AITSBOMAIModels.ps1 for why -- without it, the List[PSObject]
    # flattens to a plain array at the return boundary, losing .AddRange() in the caller.
    return ,$Entries
}
