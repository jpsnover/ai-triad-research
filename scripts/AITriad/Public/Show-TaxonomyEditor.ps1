# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Show-TaxonomyEditor {
    <#
    .SYNOPSIS
        Launch the Taxonomy Editor Electron app.
    .DESCRIPTION
        Before launching, checks that the AI Triad data repository is present,
        that Node.js/npm is installed, and that node_modules exist in the
        taxonomy-editor directory. Offers to install each missing prerequisite
        interactively before proceeding.
    .EXAMPLE
        Show-TaxonomyEditor
        TaxonomyEditor
    #>
    [CmdletBinding()]
    param()

    Set-StrictMode -Version Latest

    $AppDir = Join-Path $script:RepoRoot 'taxonomy-editor'
    if (-not (Test-Path $AppDir)) {
        Write-Fail "App directory not found: $AppDir"
        return
    }

    # ── 1. Check data ─────────────────────────────────────────────────────────
    $TaxDir  = Get-TaxonomyDir
    $DataOk  = Test-Path (Join-Path $TaxDir 'accelerationist.json')

    if (-not $DataOk) {
        Write-Warn "AI Triad data not found at: $TaxDir"
        $Choice = $Host.UI.PromptForChoice(
            'Missing Data',
            'Run Install-AITriadData to clone the data repository?',
            @('&Yes', '&No'),
            0
        )
        if ($Choice -eq 0) {
            Install-AITriadData
            if (-not (Test-Path (Join-Path $TaxDir 'accelerationist.json'))) {
                Write-Fail 'Data installation did not complete. Cannot launch Taxonomy Editor.'
                return
            }
        }
        else {
            Write-Warn 'Launching without data — the app may not function correctly.'
        }
    }

    # ── 2. Check npm ──────────────────────────────────────────────────────────
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Warn 'npm not found — Node.js is required to run the Taxonomy Editor.'
        $Choice = $Host.UI.PromptForChoice(
            'Missing Dependency',
            'Run Install-AIDependencies to install Node.js and other dependencies?',
            @('&Yes', '&No'),
            0
        )
        if ($Choice -eq 0) {
            Install-AIDependencies -SkipPython
        }
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
            Write-Fail 'npm still not found after install attempt. Cannot launch Taxonomy Editor.'
            return
        }
    }

    # ── 3. Check node_modules ─────────────────────────────────────────────────
    $NodeModules = Join-Path $AppDir 'node_modules'
    if (-not (Test-Path $NodeModules)) {
        Write-Warn "Node modules not installed in taxonomy-editor/."
        $Choice = $Host.UI.PromptForChoice(
            'Missing Node Modules',
            "Run 'npm install' in the taxonomy-editor directory?",
            @('&Yes', '&No'),
            0
        )
        if ($Choice -eq 0) {
            Write-Step 'Installing Node modules'
            Push-Location $AppDir
            try {
                npm install
                if ($LASTEXITCODE -ne 0) {
                    Write-Fail "npm install failed (exit code $LASTEXITCODE)."
                    return
                }
                Write-OK 'Node modules installed.'
            }
            finally { Pop-Location }
        }
        else {
            Write-Warn "Proceeding without node_modules — 'npm run dev' will likely fail."
        }
    }

    # ── Launch ────────────────────────────────────────────────────────────────
    Push-Location $AppDir
    try {
        npm run dev
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "npm run dev exited with code $LASTEXITCODE."
        }
    }
    finally { Pop-Location }
}
