# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Show-POViewer {
    <#
    .SYNOPSIS
        Launch the POV Viewer Electron app.
    .DESCRIPTION
        Runs 'npm run dev' inside the poviewer directory.
    .EXAMPLE
        Show-POViewer
        POViewer
    #>
    [CmdletBinding()]
    param()
    $AppDir = Join-Path $script:RepoRoot 'poviewer'
    Push-Location $AppDir
    try { npm run dev }
    finally { Pop-Location }
}
