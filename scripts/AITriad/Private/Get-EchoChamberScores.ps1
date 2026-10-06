# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-EchoChamberScores {
    <#
    .SYNOPSIS
        Per-POV ratio of same-POV SUPPORTS to same-POV CONTRADICTS edges (t/3910 extraction
        from Get-TaxonomyHealthData's GraphMode metrics). A POV with supports and no
        contradicts gets [Positive Infinity]; no supports and no contradicts gets 0.0.
    .OUTPUTS
        [hashtable] POV -> [ordered]{ SamePovSupports; SamePovContradicts; Ratio }.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$ApprovedEdges,
        [Parameter(Mandatory)][hashtable]$NodePovLookup
    )

    Set-StrictMode -Version Latest

    $EchoChamberScores = @{}
    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic')) {
        $SamePovSupports    = 0
        $SamePovContradicts = 0
        foreach ($Edge in $ApprovedEdges) {
            $SPov = $NodePovLookup[$Edge.source]
            $TPov = $NodePovLookup[$Edge.target]
            if ($SPov -ne $PovKey -or $TPov -ne $PovKey) { continue }
            if ($Edge.type -eq 'SUPPORTS')    { $SamePovSupports++ }
            if ($Edge.type -eq 'CONTRADICTS') { $SamePovContradicts++ }
        }

        if ($SamePovContradicts -gt 0) {
            $EchoRatio = [Math]::Round($SamePovSupports / $SamePovContradicts, 2)
        } elseif ($SamePovSupports -gt 0) {
            $EchoRatio = [double]::PositiveInfinity
        } else {
            $EchoRatio = 0.0
        }

        $EchoChamberScores[$PovKey] = [ordered]@{
            SamePovSupports    = $SamePovSupports
            SamePovContradicts = $SamePovContradicts
            Ratio              = $EchoRatio
        }
    }

    return $EchoChamberScores
}
