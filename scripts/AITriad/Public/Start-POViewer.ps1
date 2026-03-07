# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Start-POViewer {
    <#
    .SYNOPSIS
        Launch the PO Viewer Electron app.
    .DESCRIPTION
        Runs 'npm run dev' inside the poviewer directory.
    .EXAMPLE
        Start-POViewer
        POViewer
    #>
    [CmdletBinding()]
    param()
    $AppDir = Join-Path $script:RepoRoot 'poviewer'
    Push-Location $AppDir
    try { npm run dev }
    finally { Pop-Location }
}
