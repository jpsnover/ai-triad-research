# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Prepends a provenance HTML-comment + Markdown header to a snapshot.

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
