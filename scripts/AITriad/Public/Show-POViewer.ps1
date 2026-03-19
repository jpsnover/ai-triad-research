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
    if (-not (Test-Path $AppDir)) {
        Write-Fail "App directory not found: $AppDir"
        return
    }
    Push-Location $AppDir
    try {
        npm run dev
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "npm run dev exited with code $LASTEXITCODE. Check that dependencies are installed (npm install)."
        }
    }
    finally { Pop-Location }
}
