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
    .LINK
        Show-AITriadHelp
    .LINK
        Get-Tax
    .LINK
        Get-GraphNode
    .LINK
        Get-TaxonomyHealth
    .LINK
        Compare-Taxonomy
    .LINK
        Test-TaxonomyIntegrity
    .LINK
        Test-OntologyCompliance
    #>
    [CmdletBinding()]
    param()

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $EmbedScript = Join-Path (Join-Path $script:RepoRoot 'scripts') 'embed_taxonomy.py'
    if (-not (Test-Path $EmbedScript)) { $EmbedScript = Join-Path $script:ModuleRoot 'embed_taxonomy.py' }
    if (-not (Test-Path $EmbedScript)) {
        Write-Error "embed_taxonomy.py not found at $EmbedScript"
        return
    }

    Write-Host "Generating taxonomy embeddings..." -ForegroundColor Cyan
    if (Get-Command python -ErrorAction SilentlyContinue) { $PythonCmd = 'python' } else { $PythonCmd = 'python3' }

    # Let a non-zero exit be handled by our own check below rather than a
    # terminating NativeCommandError (PS 7.4+ default under -ErrorActionPreference Stop),
    # so the real stderr can be captured and surfaced (t/1653).
    $PSNativeCommandUseErrorActionPreference = $false

    # Capture the Python subprocess stderr verbatim. A bare exit-code message
    # masked the real traceback (e.g. an AttributeError at embed_taxonomy.py:204
    # was misdiagnosed as a missing sentence-transformers install — t/1653).
    # stdout still streams to the host so live progress remains visible.
    $StderrFile = [System.IO.Path]::GetTempFileName()
    try {
        & $PythonCmd $EmbedScript generate 2> $StderrFile
        $ExitCode = $LASTEXITCODE
        $StderrText = if (Test-Path $StderrFile) { Get-Content -Raw -Path $StderrFile } else { '' }
    }
    finally {
        Remove-Item -Path $StderrFile -Force -ErrorAction SilentlyContinue
    }

    if ($ExitCode -ne 0) {
        if ([string]::IsNullOrWhiteSpace($StderrText)) {
            $Problem = "embed_taxonomy.py generate exited with code $ExitCode (no stderr was captured from the Python subprocess)."
        } else {
            $Problem = "embed_taxonomy.py generate exited with code $ExitCode. Python stderr (verbatim):`n$($StderrText.TrimEnd())"
        }
        New-ActionableError `
            -Goal 'Regenerate taxonomy/embeddings.json from the POV JSON files' `
            -Problem $Problem `
            -Location "Update-TaxEmbeddings -> $EmbedScript generate" `
            -NextSteps @(
                'Read the Python traceback above — it names the failing file, line, and exception.',
                'If it is a ModuleNotFoundError/ImportError, install the dependency: pip install sentence-transformers==4.1.0',
                "To see full unbuffered output, run the script directly: $PythonCmd `"$EmbedScript`" generate"
            )
        return
    }
    Write-Host "Embeddings updated successfully." -ForegroundColor Green
}
