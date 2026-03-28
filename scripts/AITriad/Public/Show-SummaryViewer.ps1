# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Show-SummaryViewer {
    <#
    .SYNOPSIS
        Launch the Summary Viewer Electron app.
    .DESCRIPTION
        Runs 'npm run dev' inside the summary-viewer directory.
    .EXAMPLE
        Show-SummaryViewer
        SummaryViewer
    #>
    [CmdletBinding()]
    param()

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'
    $AppDir = Join-Path $script:RepoRoot 'summary-viewer'
    if (-not (Test-Path $AppDir)) {
        Write-Fail "App directory not found: $AppDir"
        return
    }
    Push-Location $AppDir
    try {
        $NodeModules = Join-Path $AppDir 'node_modules'
        if (-not (Test-Path $NodeModules)) {
            Write-Warn "node_modules/ not found — running npm install first"
            npm install
            if ($LASTEXITCODE -ne 0) {
                Write-Fail "npm install failed (exit code $LASTEXITCODE) in $AppDir"
                return
            }
        }
        npm run dev
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "npm run dev failed (exit code $LASTEXITCODE). Try: cd $AppDir && npm install && npm run dev"
        }
    }
    finally { Pop-Location }
}
