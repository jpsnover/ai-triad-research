# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-GroundingNodeScope {
    <#
    .SYNOPSIS
        Splits a taxonomy node description into its core prose and
        Encompasses:/Excludes: scope carve-outs.
    .DESCRIPTION
        Mirrors lib/oped/generate.ts's parseNodeScope (PR #2649) exactly, so the
        PS and TS op-ed grounding paths stay in lockstep (t/3827, t/3834, t/3835).
        Splits on the first "`nEncompasses:" / "`nExcludes:" marker (whichever
        comes first); everything before that is Core. Each scope value runs from
        just after its marker to the next newline (or end of string), trimmed.
    .PARAMETER Description
        The raw node description, as returned by Get-RelevantTaxonomyNodes.
    .OUTPUTS
        [PSCustomObject] with Core, Encompasses, Excludes (Encompasses/Excludes
        are '' when the marker is absent).
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Description
    )

    $eIdx = $Description.IndexOf("`nEncompasses:")
    $xIdx = $Description.IndexOf("`nExcludes:")
    $firstMarker = [int]::MaxValue
    if ($eIdx -ge 0 -and $eIdx -lt $firstMarker) { $firstMarker = $eIdx }
    if ($xIdx -ge 0 -and $xIdx -lt $firstMarker) { $firstMarker = $xIdx }
    $core = if ($firstMarker -eq [int]::MaxValue) { $Description } else { $Description.Substring(0, $firstMarker) }

    $extractScope = {
        param([string]$Marker, [int]$After)
        if ($After -lt 0) { return '' }
        $valueStart = $After + $Marker.Length
        $nextNewline = $Description.IndexOf("`n", $valueStart)
        $raw = if ($nextNewline -eq -1) { $Description.Substring($valueStart) } else { $Description.Substring($valueStart, $nextNewline - $valueStart) }
        return $raw.Trim()
    }

    [PSCustomObject]@{
        Core        = $core
        Encompasses = & $extractScope "`nEncompasses:" $eIdx
        Excludes    = & $extractScope "`nExcludes:" $xIdx
    }
}
