# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Write-EdgesFile {
    <#
    .SYNOPSIS
        Serialize an edges.json object to disk per the hybrid byte contract.

    .DESCRIPTION
        Writes taxonomy/Origin/edges.json in the format defined by
        docs/edges-json-format.md: top-level structure pretty-printed at 2 spaces,
        the `edges` array compacted one edge per line at 4-space indent. Output is
        UTF-8 no-BOM, LF-only, with exactly one trailing newline.

        This is the single serialization path for edges.json in PowerShell — every
        cmdlet that writes edges must delegate here so all writers (PS, TypeScript,
        Python) stay byte-identical and the 14 MB data-repo file does not churn.

        CRLF trap (already diagnosed in the contract, do not rediscover):
        `ConvertTo-Json` without `-Compress` emits CRLF on Windows. The pretty-print
        path below normalizes to LF before re-indenting so no stray `\r` survives.

    .PARAMETER EdgesData
        The edges document object (as produced by ConvertFrom-Json). Top-level key
        order and per-edge key order are preserved exactly as read.

    .PARAMETER Path
        Destination path for edges.json.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        $EdgesData,

        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.Append("{`n")

    $props = @($EdgesData.PSObject.Properties)
    for ($i = 0; $i -lt $props.Count; $i++) {
        $prop     = $props[$i]
        $keyJson  = $prop.Name | ConvertTo-Json -Compress
        $trailing = if ($i -eq $props.Count - 1) { '' } else { ',' }

        if ($prop.Name -eq 'edges') {
            $edges = @($prop.Value)
            if ($edges.Count -eq 0) {
                # Rule 4: empty edges array is emitted inline.
                [void]$sb.Append('  ' + $keyJson + ': []' + $trailing + "`n")
            } else {
                [void]$sb.Append('  ' + $keyJson + ": [`n")
                for ($j = 0; $j -lt $edges.Count; $j++) {
                    $edgeJson  = $edges[$j] | ConvertTo-Json -Depth 20 -Compress
                    $edgeComma = if ($j -eq $edges.Count - 1) { '' } else { ',' }
                    [void]$sb.Append('    ' + $edgeJson + $edgeComma + "`n")
                }
                [void]$sb.Append('  ]' + $trailing + "`n")
            }
        } else {
            # Every non-edges value: pretty-print at 2 spaces, normalize CRLF->LF,
            # then re-indent one level (2 more spaces) to sit inside the root object.
            $pretty = ($prop.Value | ConvertTo-Json -Depth 20) -replace "`r`n", "`n"
            $lines  = $pretty -split "`n"
            $indented = $lines[0]
            for ($k = 1; $k -lt $lines.Count; $k++) {
                $indented += "`n  " + $lines[$k]
            }
            [void]$sb.Append('  ' + $keyJson + ': ' + $indented + $trailing + "`n")
        }
    }
    [void]$sb.Append('}')

    # Write-Utf8NoBom normalizes CRLF->LF and guarantees exactly one trailing newline.
    $sb.ToString() | Write-Utf8NoBom -Path $Path
}
