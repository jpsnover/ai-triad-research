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

    # t/2945 Arm 1 (warn-first) — edge-rationale-regression guard. Every PS edge write funnels
    # through this sink, so guarding here covers all in-repo PS writers + the pipeline re-emit
    # (Invoke-EdgeDiscovery append-preserves an upstream-stripped set and re-writes it here).
    # Best-effort: skip cleanly if the guard isn't loaded (Build-Module standalone dot-sources
    # this file without the guard chain, like the t/2902 sink). Fail-open on any baseline miss.
    # Phase 1 = WARN (does not throw); $env:AI_TRIAD_EDGE_RATIONALE_GATE=Block promotes it.
    if (Get-Command Test-EdgeRationaleRegression -ErrorAction SilentlyContinue) {
        $null = Test-EdgeRationaleRegression -EdgesData $EdgesData -Path $Path
    }

    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.Append("{`n")

    # Top-level shape normalization (t/2955 AC#4): iterate a uniform [{Name;Value}] list whether
    # the document is the usual PSCustomObject (ConvertFrom-Json) OR a raw [IDictionary]/[hashtable].
    # Without this branch a hashtable document's `.PSObject.Properties` yields Count/Keys/Values
    # (NOT its entries), so the whole document would mis-serialize — the "half-support" the
    # edge-rationale guard's document-level IDictionary branch would otherwise protect but this
    # sink could not honor. Use [ordered]@{} upstream for deterministic key order (a bare hashtable
    # has no defined order). Per-edge shape is already handled below via ConvertTo-Json.
    $props =
        if ($EdgesData -is [System.Collections.IDictionary]) {
            @($EdgesData.Keys | ForEach-Object { [PSCustomObject]@{ Name = $_; Value = $EdgesData[$_] } })
        } else {
            @($EdgesData.PSObject.Properties)
        }
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
