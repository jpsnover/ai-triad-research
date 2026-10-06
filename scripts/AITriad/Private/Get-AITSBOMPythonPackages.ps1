# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AITSBOMPythonPackages {
    <#
    .SYNOPSIS
        SBOM entries parsed from scripts/requirements.txt. Extracted verbatim
        from Get-AITSBOM (t/3910) -- no behavior change.
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

    $ReqPath = Join-Path (Join-Path $RepoRoot 'scripts') 'requirements.txt'
    if (Test-Path $ReqPath) {
        $Lines = Get-Content -Path $ReqPath
        foreach ($Line in $Lines) {
            $Line = $Line.Trim()
            if (-not $Line -or $Line.StartsWith('#')) { continue }
            if ($Line -match '^([a-zA-Z0-9_.\-]+(?:\[[^\]]+\])?)(?:[><=!~]+(.+))?$') {
                $PkgName = $Matches[1]
                if ($Matches[2]) { $PkgVer = $Matches[2] } else { $PkgVer = 'any' }
                $PyUrlName = $PkgName -replace '\[.*\]', ''
                $Entries.Add([PSCustomObject]@{
                    Name          = $PkgName
                    Version       = $PkgVer
                    LatestVersion = $null
                    Status        = $null
                    Type          = 'python'
                    Scope         = 'required'
                    Source        = 'scripts/requirements.txt'
                    SourceUrl     = "https://pypi.org/project/$PyUrlName/"
                    License       = $null
                    Supplier      = $null
                    Description   = $null
                    Hash          = $null
                    InstalledVia  = 'pip'
                })
            }
        }
    }

    # Comma-wrap: see Get-AITSBOMAIModels.ps1 for why -- without it, the List[PSObject]
    # flattens to a plain array at the return boundary, losing .AddRange() in the caller.
    return ,$Entries
}
