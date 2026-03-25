# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Save-Source {
    <#
    .SYNOPSIS
        Copies raw source documents to a target directory.
    .DESCRIPTION
        For each DocId, locates the raw file(s) under sources/<DocId>/raw/
        and copies them to the specified directory.

        If the directory does not exist it is created.
        If it already exists its contents are removed first.

        DocId accepts pipeline input by property name, so output from
        Find-Source or other commands that emit a DocId property can be
        piped directly.

        The directory is prepared (created or cleared) once on the first
        pipeline object, then each DocId appends its raw files into it.
    .PARAMETER Directory
        Target directory to copy raw files into.
        Created if missing; cleared if it already exists.
    .PARAMETER DocId
        One or more document IDs whose raw files should be copied.
        Accepts pipeline input by property name.
    .EXAMPLE
        Save-Source -Directory './export' -DocId 'ai-as-normal-technology-2026'
        # Copy one document's raw files.
    .EXAMPLE
        Save-Source -Directory './export' -DocId 'ai-as-normal-technology-2026','concrete-problems-ai-safety-2026'
        # Copy multiple documents' raw files.
    .EXAMPLE
        Find-Source -Id 'skp-methods-005' | Save-Source -Directory './export'
        # Pipeline from Find-Source.
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory, Position = 0)]
        [string]$Directory,

        [Parameter(Mandatory, ValueFromPipelineByPropertyName)]
        [string[]]$DocId
    )

    begin {
        Set-StrictMode -Version Latest
        $ErrorActionPreference = 'Stop'

        $SourcesDir  = Get-SourcesDir
        $Prepared    = $false
        $CopiedCount = 0
    }

    process {
        # Prepare the target directory once on first invocation
        if (-not $Prepared) {
            if (Test-Path $Directory) {
                if ($PSCmdlet.ShouldProcess($Directory, 'Clear existing directory')) {
                    Get-ChildItem -Path $Directory -Force | Remove-Item -Recurse -Force
                    Write-Info "Cleared existing directory: $Directory"
                }
            }
            else {
                if ($PSCmdlet.ShouldProcess($Directory, 'Create directory')) {
                    [void](New-Item -Path $Directory -ItemType Directory -Force)
                    Write-Info "Created directory: $Directory"
                }
            }
            $Prepared = $true
        }

        foreach ($Id in $DocId) {
            $RawDir = Join-Path $SourcesDir $Id 'raw'

            if (-not (Test-Path $RawDir)) {
                Write-Warn "No raw directory found for '$Id' — skipping"
                continue
            }

            $RawFiles = @(Get-ChildItem -Path $RawDir -File)
            if ($RawFiles.Count -eq 0) {
                Write-Warn "Raw directory is empty for '$Id' — skipping"
                continue
            }

            foreach ($File in $RawFiles) {
                $Dest = Join-Path $Directory $File.Name

                # Avoid name collisions by prefixing with doc-id
                if (Test-Path $Dest) {
                    $Dest = Join-Path $Directory "$Id`_$($File.Name)"
                }

                if ($PSCmdlet.ShouldProcess($File.FullName, "Copy to $Dest")) {
                    Copy-Item -Path $File.FullName -Destination $Dest
                    Write-OK "$Id -> $($File.Name)"
                    $CopiedCount++
                }
            }
        }
    }

    end {
        if ($CopiedCount -gt 0) {
            Write-Step "Saved $CopiedCount file(s) to $Directory"
        }
        elseif ($Prepared) {
            Write-Warn "No raw files were copied"
        }
    }
}
