# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-BatchDebateSystemPrompt {
    <#
    .SYNOPSIS
        The sequential-path system prompt for Invoke-BatchSummary (t/3910): the base
        template, plus a DEBATE CONTEXT block naming each contested node when there are any.
    .DESCRIPTION
        Identical for every doc in a run, so it is built once rather than per doc. Only the
        sequential path uses it; the FIRE and parallel paths never injected debate context.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [AllowEmptyString()][string]$BaseTemplate,
        [Parameter(Mandatory)][hashtable]$DebateContext
    )

    if ($DebateContext.Count -eq 0) { return $BaseTemplate }

    $DebateNotes = @()
    foreach ($NodeId in $DebateContext.Keys) {
        $DebateNotes += "Node $NodeId has been contested in debates: $($DebateContext[$NodeId] -join ', '). Pay close attention to claims about this node."
    }
    return $BaseTemplate + "`n`nDEBATE CONTEXT: The following taxonomy nodes have been the subject of structured debates. When this document makes claims relevant to these nodes, note whether the document provides evidence that could resolve the identified disagreements.`n" + ($DebateNotes -join "`n")
}
