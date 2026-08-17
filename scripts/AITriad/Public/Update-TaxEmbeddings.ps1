# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Update-TaxEmbeddings {
    <#
    .SYNOPSIS
        Regenerates taxonomy/embeddings.json from all POV JSON files.
    .DESCRIPTION
        Calls embed_taxonomy.py generate to rebuild the semantic embeddings
        used by Get-Tax -Similar. Requires Python with sentence-transformers.
    .PARAMETER AutoCommit
        On success, git-add + commit taxonomy/Origin/embeddings.json to the DATA repo
        with a machine-attributed message, so a run never leaves unattributed churn in
        the shared data checkout (t/2753). Default $true. Pipeline callers that own the
        broader commit pass -AutoCommit:$false. No-op when the file is unchanged, git is
        absent, or the data root is not a git work tree (warns, never throws).
    .EXAMPLE
        Update-TaxEmbeddings
    .EXAMPLE
        Update-TaxEmbeddings -AutoCommit:$false   # pipeline owns the commit
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
    param(
        [switch]$AutoCommit = $true
    )

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

    # ── Auto-commit to the DATA repo (t/2753) ────────────────────────────────
    # Prevent shared-data-checkout drift: a regen must never leave unattributed
    # embeddings.json churn in the shared data tree (the t/2750 incident). Commit it
    # here with machine attribution unless the pipeline owns the broader commit
    # (-AutoCommit:$false). Narrow staging (embeddings.json only), no-change guard,
    # and graceful degradation (warn, never throw — the embeddings are already written).
    if ($AutoCommit) {
        $DataRoot = Get-DataRoot
        $EmbFile  = Join-Path (Get-TaxonomyDir) 'embeddings.json'
        $GitCmd   = Get-Command git -ErrorAction SilentlyContinue

        if (-not $GitCmd) {
            Write-Warning "Update-TaxEmbeddings: -AutoCommit skipped — git not found on PATH. Commit embeddings.json manually to avoid shared-checkout drift (t/2753)."
        }
        elseif (-not $DataRoot -or ((& git -C $DataRoot rev-parse --is-inside-work-tree 2>$null) -ne 'true')) {
            Write-Warning "Update-TaxEmbeddings: -AutoCommit skipped — data root '$DataRoot' is not a git work tree. Commit embeddings.json manually (t/2753)."
        }
        elseif (-not (Test-Path $EmbFile)) {
            Write-Warning "Update-TaxEmbeddings: -AutoCommit skipped — embeddings.json not found at '$EmbFile'."
        }
        else {
            $Status = (& git -C $DataRoot status --porcelain -- $EmbFile 2>$null) -join "`n"
            if ([string]::IsNullOrWhiteSpace($Status)) {
                Write-Host "AutoCommit: embeddings.json unchanged — nothing to commit." -ForegroundColor DarkGray
            }
            else {
                & git -C $DataRoot add -- $EmbFile 2>&1 | Out-Null
                $CommitMsg = "chore(embed): auto-commit embeddings [Update-TaxEmbeddings]`n`nCo-Authored-By: PowerShell (Orca) <main.scripts@ai-triad-research.orca.local>"
                & git -C $DataRoot commit -m $CommitMsg 2>&1 | Out-Null
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "AutoCommit: committed embeddings.json to '$DataRoot'." -ForegroundColor Green
                }
                else {
                    Write-Warning "Update-TaxEmbeddings: -AutoCommit commit failed (git exit $LASTEXITCODE) — embeddings.json is staged but uncommitted. Finish manually: git -C `"$DataRoot`" commit (t/2753)."
                }
            }
        }
    }
}
