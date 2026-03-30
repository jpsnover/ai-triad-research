# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Show-DebateDiagnostics {
    <#
    .SYNOPSIS
        Opens the debate diagnostics viewer on a captured diagnostics file.
    .DESCRIPTION
        Launches the Taxonomy Editor's diagnostics window in file-read mode,
        pre-loaded with the diagnostics JSON from a previous Invoke-AITDebate run.
    .PARAMETER Path
        Path to the diagnostics JSON file (e.g., ./debates/my-debate-diagnostics.json).
    .EXAMPLE
        Show-DebateDiagnostics -Path ./debates/burden-of-proof-diagnostics.json
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [ValidateScript({ Test-Path $_ })]
        [string]$Path
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $ResolvedPath = Resolve-Path $Path
    Write-Host "[diagnostics] Opening: $ResolvedPath" -ForegroundColor Cyan

    # Launch the taxonomy editor in diagnostics-file mode
    $TaxEditorDir = Join-Path $script:ModuleRoot '..' '..' 'taxonomy-editor'

    # Ensure production build exists
    $RendererIndex = Join-Path $TaxEditorDir 'dist' 'renderer' 'index.html'
    if (-not (Test-Path $RendererIndex)) {
        Write-Host "[diagnostics] Building taxonomy editor (first time only)..." -ForegroundColor Yellow
        Push-Location $TaxEditorDir
        npm run build 2>&1 | ForEach-Object { Write-Verbose $_ }
        Pop-Location
    }

    $Electron = Join-Path $TaxEditorDir 'node_modules' '.bin' 'electron'

    if (-not (Test-Path $Electron)) {
        # Try npx electron
        $Electron = 'npx'
        $ElectronArgs = @('electron', '.', "--diagnostics-file=$ResolvedPath")
    } else {
        $ElectronArgs = @('.', "--diagnostics-file=$ResolvedPath")
    }

    $StartInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $StartInfo.FileName = $Electron
    $StartInfo.Arguments = $ElectronArgs -join ' '
    $StartInfo.WorkingDirectory = $TaxEditorDir
    $StartInfo.UseShellExecute = $false

    try {
        $Proc = [System.Diagnostics.Process]::Start($StartInfo)
        Write-Host "[diagnostics] Viewer launched (PID: $($Proc.Id))" -ForegroundColor Green
    }
    catch {
        # Fallback: open the JSON file directly for inspection
        Write-Warning "Could not launch Electron viewer: $_"
        Write-Host "Opening diagnostics file in default editor..." -ForegroundColor Yellow
        if ($IsMacOS) { & open $ResolvedPath }
        elseif ($IsWindows) { & start $ResolvedPath }
        else { & xdg-open $ResolvedPath }
    }
}
