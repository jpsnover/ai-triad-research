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
    .PARAMETER Status
        Pre-filter edges by status when the viewer opens.
        Valid values: proposed, approved, rejected.
    .EXAMPLE
        Show-EdgeViewer
    .EXAMPLE
        Show-EdgeViewer -Status proposed
    .EXAMPLE
        EdgeViewer -Status approved
    #>
    [CmdletBinding()]
    param(
        [ValidateSet('proposed', 'approved', 'rejected')]
        [string]$Status
    )
    $AppDir = Join-Path $script:RepoRoot 'edge-viewer'
    if (-not (Test-Path $AppDir)) {
        Write-Fail "App directory not found: $AppDir"
        return
    }
    if ($Status) {
        $env:EDGE_VIEWER_STATUS = $Status
    } else {
        $env:EDGE_VIEWER_STATUS = $null
    }
    Push-Location $AppDir
    try {
        npm run dev
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "npm run dev exited with code $LASTEXITCODE. Check that dependencies are installed (npm install)."
        }
    }
    finally {
        $env:EDGE_VIEWER_STATUS = $null
        Pop-Location
    }
}
