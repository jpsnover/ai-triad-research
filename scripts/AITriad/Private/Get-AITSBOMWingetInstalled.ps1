# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AITSBOMWingetInstalled {
    <#
    .SYNOPSIS
        Parses `winget list` into a {wingetId -> version} hashtable, or @{} if
        winget is unavailable or fails. Extracted verbatim from Get-AITSBOM
        (t/3910) -- no behavior change.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param()

    Set-StrictMode -Version Latest
    $WingetInstalled = @{}
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        try {
            $WingetRaw = winget list 2>$null
            if ($WingetRaw) {
                foreach ($WLine in $WingetRaw) {
                    if ($WLine -match '^\s*(\S.+?)\s{2,}(\S+\.\S+)\s{2,}(\S+)') {
                        $WingetInstalled[$Matches[2]] = $Matches[3]
                    }
                }
            }
        }
        catch { }
    }
    return $WingetInstalled
}
