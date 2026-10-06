# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AITSBOMSchemas {
    <#
    .SYNOPSIS
        SBOM entries for taxonomy/schemas/*.schema.json files. Extracted
        verbatim from Get-AITSBOM (t/3910) -- no behavior change.
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

    $SchemaDir = Join-Path (Join-Path $RepoRoot 'taxonomy') 'schemas'
    if (Test-Path $SchemaDir) {
        foreach ($SchemaFile in Get-ChildItem -Path $SchemaDir -Filter '*.schema.json' -File) {
            $SchemaVer = 'unknown'
            try {
                $Schema = Get-Content -Raw -Path $SchemaFile.FullName | ConvertFrom-Json
                if ($Schema.PSObject.Properties['version']) { $SchemaVer = $Schema.version }
                elseif ($Schema.PSObject.Properties['$schema']) { $SchemaVer = 'json-schema' }
            }
            catch { }

            $Entries.Add([PSCustomObject]@{
                Name          = $SchemaFile.BaseName
                Version       = $SchemaVer
                LatestVersion = $null
                Status        = $null
                Type          = 'schema'
                Scope         = 'required'
                Source        = "taxonomy/schemas/$($SchemaFile.Name)"
                SourceUrl     = $null
                License       = 'MIT'
                Supplier      = 'AI Triad Research'
                Description   = $null
                Hash          = $null
                InstalledVia  = 'project'
            })
        }
    }

    # Comma-wrap: see Get-AITSBOMAIModels.ps1 for why -- without it, the List[PSObject]
    # flattens to a plain array at the return boundary, losing .AddRange() in the caller.
    return ,$Entries
}
