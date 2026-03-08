# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Show-EdgeViewer {
    <#
    .SYNOPSIS
        Launch the Edge Viewer Electron app.
    .DESCRIPTION
        Runs 'npm run dev' inside the edge-viewer directory.
        The Edge Viewer lets you browse, filter, and approve/reject
        AI-discovered edges between taxonomy nodes.
    .EXAMPLE
        Show-EdgeViewer
        EdgeViewer
    #>
    [CmdletBinding()]
    param()
    $AppDir = Join-Path $script:RepoRoot 'edge-viewer'
    Push-Location $AppDir
    try { npm run dev }
    finally { Pop-Location }
}
