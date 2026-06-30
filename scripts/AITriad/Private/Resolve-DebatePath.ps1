# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Resolves a debate identifier (ID, path, or "latest") to a file path.
# Lifted from Compare-DebateQuality's inner Resolve-DebatePath and extended
# with the -Latest switch needed by Measure-DebateQuality.
# Dot-sourced by AITriad.psm1 — do NOT export.

function Resolve-DebatePath {
    <#
    .SYNOPSIS
        Resolves a debate identifier or path to an absolute file path.
    .DESCRIPTION
        Accepts either:
          - A file path (returned verbatim after Resolve-Path)
          - A debate ID (looks up debate-<id>.json in the debates dir)
          - -Latest (returns the most recently modified debate-*.json)
        Throws an ActionableError when nothing matches.
    .PARAMETER IdOrPath
        Debate ID or file path.
    .PARAMETER Latest
        Return the most recently modified debate-*.json under the debates dir.
    .EXAMPLE
        Resolve-DebatePath -IdOrPath 'abc123'
    .EXAMPLE
        Resolve-DebatePath -Latest
    #>
    [CmdletBinding(DefaultParameterSetName = 'ById')]
    param(
        [Parameter(Mandatory, ParameterSetName = 'ById', Position = 0)]
        [string]$IdOrPath,

        [Parameter(Mandatory, ParameterSetName = 'Latest')]
        [switch]$Latest
    )

    Set-StrictMode -Version Latest

    if ($Latest) {
        $DebatesDir = Get-DebatesDir
        if (-not (Test-Path $DebatesDir)) {
            New-ActionableError `
                -Goal     'Find latest debate' `
                -Problem  "Debates directory does not exist: $DebatesDir" `
                -Location 'Resolve-DebatePath -Latest' `
                -NextSteps @('Run a debate first via Show-TriadDialogue or Invoke-AITDebate') `
                -Throw
        }
        $Recent = @(Get-ChildItem $DebatesDir -Filter 'debate-*.json' -Recurse |
            Where-Object { $_.Name -notmatch 'diagnostics|harvest|transcript|partial' } |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1)
        if ($Recent.Count -eq 0) {
            New-ActionableError `
                -Goal     'Find latest debate' `
                -Problem  "No debate-*.json files found in $DebatesDir" `
                -Location 'Resolve-DebatePath -Latest' `
                -NextSteps @('Run a debate first via Show-TriadDialogue or Invoke-AITDebate') `
                -Throw
        }
        return $Recent[0].FullName
    }

    if (Test-Path $IdOrPath) { return (Resolve-Path $IdOrPath).Path }

    $DebatesDir = Get-DebatesDir
    $Direct = Join-Path $DebatesDir "debate-$IdOrPath.json"
    if (Test-Path $Direct) { return $Direct }

    $Partial = @(Get-ChildItem $DebatesDir -Filter "debate-$IdOrPath*.json" -Recurse |
        Where-Object { $_.Name -notmatch 'diagnostics|harvest|transcript|partial' } |
        Select-Object -First 1)
    if ($Partial.Count -gt 0) { return $Partial[0].FullName }

    New-ActionableError `
        -Goal     'Resolve debate identifier' `
        -Problem  "No debate found matching '$IdOrPath'" `
        -Location 'Resolve-DebatePath' `
        -NextSteps @('Verify the debate ID or file path', 'Run Get-AITDebate to list available debates') `
        -Throw
}
