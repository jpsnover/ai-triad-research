# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Show-TaxonomyEditor {
    <#
    .SYNOPSIS
        Launch the Taxonomy Editor Electron app.
    .DESCRIPTION
        Runs 'npm run dev' inside the taxonomy-editor directory.
    .EXAMPLE
        Show-TaxonomyEditor
        TaxonomyEditor
    #>
    [CmdletBinding()]
    param()
    $AppDir = Join-Path $script:RepoRoot 'taxonomy-editor'
    Push-Location $AppDir
    try { npm run dev }
    finally { Pop-Location }
}
