# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Repair-IdShapedSuggestedLabel {
    <#
    .SYNOPSIS
        Finalize-Summary sub-helper (t/3915): replaces any unmapped_concepts[]
        suggested_label that is node-ID-shaped with a free-text fallback.
    .DESCRIPTION
        suggested_label is a free-text display field -- the Summaries tab
        editor offers it verbatim as a new node's name. An ID-shaped value is
        junk regardless of source (direct model output, or a code path that
        meant the value to be traceable rather than user-facing). Mutates the
        entries in $Concepts in place.
    .PARAMETER Concepts
        The unmapped_concepts array to scan and repair in place.
    .PARAMETER Model
        Model name, for the WARN log line only.
    .OUTPUTS
        [int] -- number of labels replaced.
    #>
    [CmdletBinding()]
    [OutputType([int])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Concepts,

        [string]$Model
    )

    Set-StrictMode -Version Latest

    $NodeIdShape = '^(acc|saf|skp)-(beliefs|desires|intentions)-\d+$|^(sit|cc|pol)-\d+$'
    $ReplacedCount = 0

    foreach ($Concept in $Concepts) {
        if (-not ($Concept.PSObject.Properties['suggested_label'] -and $Concept.suggested_label -match $NodeIdShape)) {
            continue
        }
        $ReplacedCount++
        $BadLabel = $Concept.suggested_label
        $ConceptText = if ($Concept.PSObject.Properties['concept']) { $Concept.concept } else { '' }
        $Concept.suggested_label = if ($ConceptText) {
            $LabelWords = @(($ConceptText -split '\s+') | Where-Object { $_ } | Select-Object -First 8)
            ($LabelWords -join ' ') + '...'
        } else {
            'Unresolved concept'
        }
        Write-Warning "Finalize-Summary: suggested_label '$BadLabel' is node-ID-shaped, not free text -- replaced with a text fallback (t/3915, model=$Model)"
    }

    return $ReplacedCount
}
