# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Show-DebateHarvest {
    <#
    .SYNOPSIS
        Opens the debate harvest review tool on a harvest file.
    .DESCRIPTION
        Launches the harvest review tool pre-loaded with harvest candidates
        from a previous Invoke-AITDebate run. Allows reviewing, editing,
        and applying harvest items (conflicts, steelmans, verdicts, concepts)
        to the taxonomy.
    .PARAMETER Path
        Path to the harvest JSON file (e.g., ./debates/my-debate-harvest.json).
    .EXAMPLE
        Show-DebateHarvest -Path ./debates/burden-of-proof-harvest.json
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
    Write-Host "[harvest] Opening: $ResolvedPath" -ForegroundColor Cyan

    # Launch the taxonomy editor in harvest-file mode
    $TaxEditorDir = Join-Path $script:ModuleRoot '..' '..' 'taxonomy-editor'
    $Electron = Join-Path $TaxEditorDir 'node_modules' '.bin' 'electron'

    if (-not (Test-Path $Electron)) {
        $Electron = 'npx'
        $ElectronArgs = @('electron', '.', "--harvest-file=$ResolvedPath")
    } else {
        $ElectronArgs = @('.', "--harvest-file=$ResolvedPath")
    }

    $StartInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $StartInfo.FileName = $Electron
    $StartInfo.Arguments = $ElectronArgs -join ' '
    $StartInfo.WorkingDirectory = $TaxEditorDir
    $StartInfo.UseShellExecute = $false

    try {
        $Proc = [System.Diagnostics.Process]::Start($StartInfo)
        Write-Host "[harvest] Review tool launched (PID: $($Proc.Id))" -ForegroundColor Green
    }
    catch {
        Write-Warning "Could not launch Electron viewer: $_"
        Write-Host "Opening harvest file in default editor..." -ForegroundColor Yellow
        if ($IsMacOS) { & open $ResolvedPath }
        elseif ($IsWindows) { & start $ResolvedPath }
        else { & xdg-open $ResolvedPath }
    }
}
