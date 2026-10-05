# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function ConvertTo-LinkedNodesArray {
    <#
    .SYNOPSIS
        Invoke-POVSummary sub-helper (t/3948): normalizes a claim's
        linked_taxonomy_nodes value into a flat array.
    .DESCRIPTION
        t/3948: a leading unary comma on direct assignment (`$x = ,@(...)`)
        double-wraps the array instead of unrolling it -- that trick only
        protects pipeline OUTPUT from unrolling, not a plain assignment. The
        double-wrap made `.Count` always >= 1 and serialized conflict files
        as linked_taxonomy_nodes: [["id"]] instead of ["id"].
    .PARAMETER Value
        The raw linked_taxonomy_nodes value from a factual_claims entry
        (may be $null, a single string, or an array).
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [Parameter(Position = 0)]
        [AllowNull()]
        [object]$Value
    )

    Set-StrictMode -Version Latest

    # The unary comma IS correct here, unlike at the t/3948 call site: this is
    # a `return` (pipeline output), which unrolls a single-element array back
    # to a bare scalar unless protected. A plain assignment (`$x = @(...)`)
    # never unrolls -- that's the distinction the original bug got backwards.
    if ($null -ne $Value) { return , @($Value) }
    return , @()
}
