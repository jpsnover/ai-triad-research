# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Update-AITSBOMPythonMetadata {
    <#
    .SYNOPSIS
        Enriches python entries in place via a single batched `pip show` call
        (license, author, summary, resolved version). Extracted verbatim
        from Get-AITSBOM (t/3910) -- no behavior change.
    .PARAMETER Entries
        The full SBOM entries list (mutated in place for python rows).
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory)]
        [System.Collections.Generic.List[PSObject]]$Entries
    )

    Set-StrictMode -Version Latest

    $PyEntries = @($Entries | Where-Object { $_.Type -eq 'python' })
    if ($PyEntries.Count -eq 0) { return }

    $PyCmd = if (Get-Command pip -ErrorAction SilentlyContinue) { 'pip' } else { 'pip3' }
    $PyNames = @($PyEntries | ForEach-Object { $_.Name -replace '\[.*\]', '' })
    try {
        $PipOutput = & $PyCmd show @PyNames 2>$null
        if ($PipOutput) {
            $PipBlocks = ConvertFrom-PipShowOutput -PipOutput $PipOutput
            foreach ($PyEntry in $PyEntries) {
                $LookupName = ($PyEntry.Name -replace '\[.*\]', '').ToLower()
                if ($PipBlocks.ContainsKey($LookupName)) {
                    Set-AITSBOMPythonEntryFromPipInfo -Entry $PyEntry -Info $PipBlocks[$LookupName]
                }
            }
        }
    }
    catch {
        Write-Verbose "pip show failed: $($_.Exception.Message)"
    }
}
