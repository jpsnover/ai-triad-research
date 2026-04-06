# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Update-TaxEmbeddings {
    <#
    .SYNOPSIS
        Regenerates taxonomy/embeddings.json from all POV JSON files.
    .DESCRIPTION
        Calls embed_taxonomy.py generate to rebuild the semantic embeddings
        used by Get-Tax -Similar. Requires Python with sentence-transformers.
    .EXAMPLE
        Update-TaxEmbeddings
    #>
    [CmdletBinding()]
    param()

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $EmbedScript = Join-Path (Join-Path $script:ModuleRoot '..') 'embed_taxonomy.py'
    if (-not (Test-Path $EmbedScript)) {
        Write-Error "embed_taxonomy.py not found at $EmbedScript"
        return
    }

    Write-Host "Generating taxonomy embeddings..." -ForegroundColor Cyan
    if (Get-Command python -ErrorAction SilentlyContinue) { $PythonCmd = 'python' } else { $PythonCmd = 'python3' }
    & $PythonCmd $EmbedScript generate
    if ($LASTEXITCODE -ne 0) {
        Write-Error "embed_taxonomy.py generate failed (exit code $LASTEXITCODE). Is sentence-transformers installed?"
        return
    }
    Write-Host "Embeddings updated successfully." -ForegroundColor Green
}
