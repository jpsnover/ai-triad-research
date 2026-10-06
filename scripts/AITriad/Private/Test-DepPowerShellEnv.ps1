# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-DepPowerShellEnv {
    <#
    .SYNOPSIS
        Section 1 of Invoke-DependencyCheck (t/3910): PowerShell version + module load check.
        Extracted verbatim.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param([Parameter(Mandatory)][hashtable]$Ctx, [switch]$Quiet)

    Write-DepSection 'POWERSHELL (required)'

    $PsVer = $PSVersionTable.PSVersion
    if ($PsVer.Major -ge 7) {
        Write-DepPass -Ctx $Ctx -Quiet:$Quiet -Message "PowerShell $PsVer"
    }
    else {
        Write-DepWarn -Ctx $Ctx -Message "PowerShell $PsVer — PS 7+ recommended for full features. Install from https://aka.ms/powershell"
    }

    # Module check — we're already running inside the module, just verify commands exist
    $CmdCount = (Get-Command -Module AITriad -ErrorAction SilentlyContinue).Count
    if ($CmdCount -gt 0) { Write-DepPass -Ctx $Ctx -Quiet:$Quiet -Message "AITriad module loaded ($CmdCount commands)" }
    else { Write-DepWarn -Ctx $Ctx -Message 'AITriad module not loaded in current session' }
}
