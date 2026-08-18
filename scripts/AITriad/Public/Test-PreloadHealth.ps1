# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-PreloadHealth {
    <#
    .SYNOPSIS
        Validate the built taxonomy-editor preload.cjs artifact before launch.
    .DESCRIPTION
        Diagnosing a missing `window.electronAPI` (t/2772) required launching the app,
        attaching CDP, and polling for seconds. This verifies the preload BUILD ARTIFACT
        offline in well under a second:
          - preload.cjs exists under taxonomy-editor/dist/main
          - it calls contextBridge.exposeInMainWorld (the bridge that sets electronAPI)
          - preloadBuffer.cjs is present alongside it
          - (optional) `node --check` syntax-validates it

        Emits a structured Healthy/Checks object matching the diagnostic-cmdlet family
        (Test-AnalyticsBlobHealth, Test-AzureHealth). Suitable as an Invoke-TaxEditorSmokeTest
        pre-launch gate. No AI calls.
    .PARAMETER CodeRoot
        Repo root containing taxonomy-editor/. Default: module-resolved code root.
    .PARAMETER CheckSyntax
        Also run `node --check` on preload.cjs to catch a corrupt/partial build.
    .OUTPUTS
        [PSCustomObject] with Healthy, PreloadPath, Checks (Name/Pass/Detail), Timestamp.
    .EXAMPLE
        Test-PreloadHealth
    .EXAMPLE
        Test-PreloadHealth -CheckSyntax
    .LINK
        Show-AITriadHelp
    .LINK
        Invoke-TaxEditorSmokeTest
    .LINK
        Test-TaxEditorHealth
    .LINK
        Show-TaxonomyEditor
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter()]
        [string]$CodeRoot,

        [Parameter()]
        [switch]$CheckSyntax
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    if (-not $CodeRoot) {
        $CodeRoot = Get-CodeRoot
        if (-not $CodeRoot) {
            throw (New-ActionableError `
                    -Goal     'Validate the taxonomy-editor preload artifact' `
                    -Problem  'Cannot resolve the ai-triad-research code root' `
                    -Location 'Test-PreloadHealth' `
                    -NextSteps @(
                        'Set $env:AI_TRIAD_CODE_ROOT to the repo path',
                        'Or cd into the ai-triad-research directory',
                        'Or pass -CodeRoot explicitly'
                    ))
        }
    }

    $DistMain = Join-Path $CodeRoot 'taxonomy-editor/dist/main'
    $Checks   = [System.Collections.Generic.List[PSCustomObject]]::new()
    $AddCheck = {
        param($Name, $Pass, $Detail)
        $Checks.Add([PSCustomObject]@{ Name = $Name; Pass = [bool]$Pass; Detail = $Detail })
    }

    # ── Check 1: preload.cjs exists (nesting under dist/main varies, so recurse) ──
    $Preload = $null
    if (Test-Path $DistMain) {
        $Preload = @(Get-ChildItem -Path $DistMain -Recurse -Filter 'preload.cjs' -File -ErrorAction SilentlyContinue) |
            Select-Object -First 1
    }
    $PreloadExists = $null -ne $Preload
    & $AddCheck 'preload.cjs built' $PreloadExists $(if ($PreloadExists) { $Preload.FullName } else { "not found under $DistMain — build first (npm run build in taxonomy-editor/)" })

    # ── Check 2: contextBridge.exposeInMainWorld present ─────────────────────────
    $HasBridge = $false
    if ($PreloadExists) {
        $Content = Get-Content -Raw -Path $Preload.FullName
        $HasBridge = $Content -match 'contextBridge\.exposeInMainWorld'
    }
    & $AddCheck 'exposes electronAPI (contextBridge.exposeInMainWorld)' $HasBridge $(if ($HasBridge) { 'bridge call present' } elseif ($PreloadExists) { 'bridge call MISSING — preload will not set window.electronAPI (t/2772)' } else { 'skipped (no preload.cjs)' })

    # ── Check 3: preloadBuffer.cjs alongside ─────────────────────────────────────
    $BufferExists = $false
    $BufferPath = $null
    if ($PreloadExists) {
        $BufferPath = Join-Path $Preload.Directory.FullName 'preloadBuffer.cjs'
        $BufferExists = Test-Path $BufferPath
    }
    & $AddCheck 'preloadBuffer.cjs present' $BufferExists $(if ($BufferExists) { $BufferPath } elseif ($PreloadExists) { "missing alongside preload.cjs ($($Preload.Directory.FullName))" } else { 'skipped (no preload.cjs)' })

    # ── Check 4 (optional): node --check syntax validation ───────────────────────
    if ($CheckSyntax) {
        if (-not $PreloadExists) {
            & $AddCheck 'node --check syntax' $false 'skipped (no preload.cjs)'
        }
        elseif (-not (Get-Command node -ErrorAction SilentlyContinue)) {
            & $AddCheck 'node --check syntax' $false 'node not found on PATH'
        }
        else {
            & node --check $Preload.FullName 2>$null
            $SyntaxOk = ($LASTEXITCODE -eq 0)
            & $AddCheck 'node --check syntax' $SyntaxOk $(if ($SyntaxOk) { 'valid CommonJS' } else { "node --check exited $LASTEXITCODE — corrupt/partial build?" })
        }
    }

    $Healthy = @($Checks | Where-Object { -not $_.Pass }).Count -eq 0

    # ── Report ───────────────────────────────────────────────────────────────────
    Write-Host "`nPreload Health — taxonomy-editor/dist/main" -ForegroundColor Cyan
    foreach ($C in $Checks) {
        $Icon  = if ($C.Pass) { '[PASS]' } else { '[FAIL]' }
        $Color = if ($C.Pass) { 'Green' } else { 'Red' }
        Write-Host "  $Icon $($C.Name) — $($C.Detail)" -ForegroundColor $Color
    }
    Write-Host ''

    [PSCustomObject]@{
        Healthy     = $Healthy
        PreloadPath = if ($PreloadExists) { $Preload.FullName } else { $null }
        Checks      = @($Checks)
        Timestamp   = (Get-Date).ToUniversalTime().ToString('o')
    }
}
