# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-DocSummaryWithCapture {
    <#
    .SYNOPSIS
        Runs Invoke-DocumentSummary for one document, capturing any throw as a
        structured failure record instead of propagating it.
    .DESCRIPTION
        The single "process one doc, or record a failure" step shared by both
        Invoke-BatchSummary paths — the sequential loop and the
        `ForEach-Object -Parallel` block (t/1774, extracted from the inline
        try/catch added in t/1728). Centralizing it means both paths recover
        identically, and — because this is a named function rather than an inline
        `-Parallel` scriptblock — the resilience path is directly unit-testable
        (a test mocks Invoke-DocumentSummary to throw; Pester mocks do NOT reach
        into `-Parallel` runspaces, so the old inline block could only be tested
        against a replica).

        Never re-throws: one document's failure must not sink the batch (ADR-001
        partial recovery). On failure the returned record embeds
        $_.ScriptStackTrace — the real failing line — which PowerShell otherwise
        swallows by re-attributing a runspace throw to the outer parallel line.
    .PARAMETER Doc
        The document object to summarize (must expose .DocId).
    .PARAMETER Params
        Splatted through to Invoke-DocumentSummary (already includes any per-doc
        preprocessing the caller applied, e.g. debate-context injection).
    .OUTPUTS
        On success: whatever Invoke-DocumentSummary returns, normalized to
        [PSCustomObject] (hashtable keys aren't PSObject properties in PS 5.1).
        On failure: [PSCustomObject]@{ Success=$false; DocId; Error } where Error
        is "<message> | Stack: <ScriptStackTrace>".
    #>
    [CmdletBinding()]
    [OutputType([PSObject])]
    param(
        [Parameter(Mandatory)]
        $Doc,

        [Parameter(Mandatory)]
        [hashtable]$Params
    )

    try {
        $Result = Invoke-DocumentSummary -Doc $Doc @Params
        if ($Result -is [hashtable]) { $Result = [PSCustomObject]$Result }
        return $Result
    }
    catch {
        return [PSCustomObject]@{
            Success = $false
            DocId   = $Doc.DocId
            Error   = "$($_.Exception.Message) | Stack: $($_.ScriptStackTrace)"
        }
    }
}
