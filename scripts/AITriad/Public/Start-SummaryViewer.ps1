function Start-SummaryViewer {
    <#
    .SYNOPSIS
        Launch the Summary Viewer Electron app.
    .DESCRIPTION
        Runs 'npm run dev' inside the summary-viewer directory.
    .EXAMPLE
        Start-SummaryViewer
        SummaryViewer
    #>
    [CmdletBinding()]
    param()
    $AppDir = Join-Path $script:RepoRoot 'summary-viewer'
    Push-Location $AppDir
    try { npm run dev }
    finally { Pop-Location }
}
