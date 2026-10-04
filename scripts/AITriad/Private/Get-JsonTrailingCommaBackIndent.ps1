# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-JsonTrailingCommaBackIndent {
    <#
    .SYNOPSIS
        Get-JsonAdjacentCommaSpan sub-helper (t/3878 decomposition, extracted
        verbatim): when absorbing a trailing comma, also absorb the preceding
        newline+indent so no orphan blank line is left.
    .DESCRIPTION
        Walks back from DelStart past spaces/tabs to the newline character (if
        any); if found, extends the deletion start to include that newline
        (handling a preceding CR for CRLF).
    .PARAMETER RawText
        The raw JSON text.
    .PARAMETER DelStart
        The current deletion start (the member's KeyStart).
    .PARAMETER ParentStart
        Start index of the parent container's span ('{').
    .OUTPUTS
        [int] the (possibly extended) deletion start.
    #>
    [CmdletBinding()]
    [OutputType([int])]
    param(
        [Parameter(Mandatory)][string]$RawText,
        [Parameter(Mandatory)][int]$DelStart,
        [Parameter(Mandatory)][int]$ParentStart
    )

    Set-StrictMode -Version Latest

    $q = $DelStart - 1
    while ($q -ge $ParentStart + 1 -and ($RawText[$q] -eq ' ' -or $RawText[$q] -eq "`t")) { $q-- }
    if ($q -ge $ParentStart + 1 -and $RawText[$q] -eq "`n") {
        $result = if ($q -gt $ParentStart -and $RawText[$q - 1] -eq "`r") { $q - 1 } else { $q }
        return $result
    }
    return $DelStart
}
