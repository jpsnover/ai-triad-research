# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Prepends a provenance header to a document snapshot.
.DESCRIPTION
    Generates an HTML comment block with provenance metadata (title, source URL,
    source type, capture date) followed by a Markdown header section, and prepends
    it to the converted Markdown content.  The HTML comment preserves machine-readable
    provenance; the Markdown header provides human-readable context in POViewer and
    summary pipelines.
.PARAMETER Markdown
    The converted Markdown body of the document (output of ConvertFrom-Html,
    ConvertFrom-Pdf, etc.).
.PARAMETER Title
    Document title for the header.
.PARAMETER SourceUrl
    Original URL of the source document.  Defaults to empty string.
.PARAMETER SourceType
    Format of the original document (e.g., 'pdf', 'html', 'docx').  Defaults to
    empty string.
.PARAMETER CapturedAt
    ISO date string for when the snapshot was captured.  Defaults to today.
.EXAMPLE
    $Body = ConvertFrom-Html -Html $raw
    $Full = Add-SnapshotHeader -Markdown $Body -Title 'AI Safety Report' -SourceUrl 'https://example.com/report.html' -SourceType 'html'

    Prepends provenance metadata to an HTML-converted snapshot.
.EXAMPLE
    Add-SnapshotHeader -Markdown $md -Title 'Policy Brief' -CapturedAt '2026-01-15'

    Creates a header with a specific capture date.
#>
function Add-SnapshotHeader {
    param(
        [string]$Markdown,
        [string]$Title,
        [string]$SourceUrl  = '',
        [string]$SourceType = '',
        [string]$CapturedAt = (Get-Date -Format 'yyyy-MM-dd')
    )

    $Header = @"
<!--
  AI Triad Research Project — Document Snapshot
  Title      : $Title
  Source     : $SourceUrl
  Type       : $SourceType
  Captured   : $CapturedAt
  This file is a Markdown shadow copy for AI summarisation and POViewer display.
  The original file lives in raw/ for fidelity (charts, tables, exact layout).
-->

# $Title

> **Snapshot captured:** $CapturedAt
> **Source:** $SourceUrl
> **Type:** $SourceType

---

"@
    return $Header + $Markdown
}
