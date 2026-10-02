# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Shared by Invoke-EdgeDiscovery's execution-mode helpers. Promoted from a
# nested function (t/3837) so EmbeddingFirst/Batch/PerNode mode helpers can
# all call it without each needing it passed as a scriptblock parameter.

function Save-DiscoveryLog {
    <#
    .SYNOPSIS
        Writes the edge-discovery run log to disk.
    .PARAMETER Path
        Path to edge_discovery_log.json.
    .PARAMETER Entries
        Accumulated discovery-log entries for this run.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        [System.Collections.Generic.List[PSObject]]$Entries
    )

    $LogFile = [ordered]@{
        _schema_version = '1.0.0'
        _doc            = 'Edge discovery run log. Written by Invoke-EdgeDiscovery.'
        last_modified   = (Get-Date).ToString('yyyy-MM-dd')
        entries         = @($Entries)
    }
    $LogFile | ConvertTo-Json -Depth 20 | Write-Utf8NoBom -Path $Path
}
