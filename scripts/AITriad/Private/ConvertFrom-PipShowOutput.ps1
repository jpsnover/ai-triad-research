# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function ConvertFrom-PipShowOutput {
    <#
    .SYNOPSIS
        Parses `pip show` (multiple packages, `---`-separated blocks) text
        into a {lowercased package name -> {field -> value}} hashtable.
        Split out of Update-AITSBOMPythonMetadata (t/3910) to bring both
        functions under the complexity ratchet -- no behavior change.
    .PARAMETER PipOutput
        The raw lines of `pip show <pkg1> <pkg2> ...` output.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [string[]]$PipOutput
    )

    Set-StrictMode -Version Latest

    $PipBlocks = @{}
    $CurrentName = $null
    $CurrentBlock = @{}
    foreach ($PipLine in $PipOutput) {
        if ($PipLine -match '^---') {
            if ($CurrentName) { $PipBlocks[$CurrentName.ToLower()] = $CurrentBlock }
            $CurrentName = $null
            $CurrentBlock = @{}
            continue
        }
        if ($PipLine -match '^([^:]+):\s*(.*)$') {
            $FieldName = $Matches[1].Trim()
            $FieldVal  = $Matches[2].Trim()
            $CurrentBlock[$FieldName] = $FieldVal
            if ($FieldName -eq 'Name') { $CurrentName = $FieldVal }
        }
    }
    if ($CurrentName) { $PipBlocks[$CurrentName.ToLower()] = $CurrentBlock }

    return $PipBlocks
}
