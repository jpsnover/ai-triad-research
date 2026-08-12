# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-PandocHtmlArgs {
    <#
    .SYNOPSIS
        Builds the pandoc argument list for rendering untrusted Markdown to HTML.
    .DESCRIPTION
        Centralises the pandoc invocation so the security-relevant flags are in
        one testable place. The input Markdown is treated as untrusted, so
        --sandbox is always passed first: it stops pandoc from reading arbitrary
        local files the document references (e.g. via image/include paths) while
        still allowing the explicitly-listed header file (t/2530 L4).
    .PARAMETER InputPath
        Path to the source Markdown file.
    .PARAMETER OutputPath
        Path for the generated HTML file.
    .PARAMETER Title
        Document title (metadata).
    .PARAMETER HeaderFile
        Path to an HTML fragment injected via --include-in-header (our own style).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$InputPath,
        [Parameter(Mandatory)][string]$OutputPath,
        [Parameter(Mandatory)][string]$Title,
        [Parameter(Mandatory)][string]$HeaderFile
    )

    Set-StrictMode -Version Latest

    return @(
        # --sandbox MUST lead: the markdown is untrusted; block pandoc from
        # reading arbitrary local files it references (t/2530 L4).
        '--sandbox'
        $InputPath
        '-o', $OutputPath
        '--standalone'
        '--embed-resources'
        '--metadata', "title=$Title"
        '--include-in-header', $HeaderFile
    )
}
