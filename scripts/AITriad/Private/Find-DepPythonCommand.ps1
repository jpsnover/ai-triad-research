# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Find-DepPythonCommand {
    <#
    .SYNOPSIS
        Detects a working Python 3 interpreter for Invoke-DependencyCheck's section 6
        (t/3910). Extracted verbatim. Tries 'python3' then 'python', in that order.
    .OUTPUTS
        [string] the command name to use ('python3' or 'python'), or $null if none works.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)][hashtable]$Ctx)

    foreach ($Cmd in @('python3', 'python')) {
        if (Get-Command $Cmd -ErrorAction SilentlyContinue) {
            try {
                $PyVer = & $Cmd --version 2>&1
                $PyMajor = [int](("$PyVer" -replace 'Python ', '') -split '\.' | Select-Object -First 1)
                if ($PyMajor -ge 3) {
                    $PyTest = & $Cmd -c "import json; print(json.dumps({'ok': True}))" 2>&1
                    $PyJson = $PyTest | ConvertFrom-Json
                    if ($PyJson.ok) { Write-DepPass -Ctx $Ctx -Message "$Cmd — $PyVer"; return $Cmd }
                }
            }
            catch { }
        }
    }
    return $null
}
