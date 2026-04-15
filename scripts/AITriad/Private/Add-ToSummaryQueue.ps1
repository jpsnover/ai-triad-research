# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Enqueues a document for AI summarization.
.DESCRIPTION
    Appends a document ID to the .summarise-queue.json file in the data root.
    The queue is consumed by Invoke-BatchSummary to process documents that need
    new or updated POV summaries.  Duplicate IDs are silently ignored.  If the
    queue file is corrupt or unreadable, it is reset to an empty queue with a
    warning.
.PARAMETER DocId
    The slug-format document identifier (e.g., 'ai-safety-report-2026') to add
    to the summary queue.
.EXAMPLE
    Add-ToSummaryQueue -DocId 'ai-safety-report-2026'

    Adds the document to the summary queue for later batch processing.
.EXAMPLE
    Import-AITriadDocument -Url 'https://example.com/paper.pdf'
    # Internally calls Add-ToSummaryQueue after successful ingestion.
#>
function Add-ToSummaryQueue {
    param([string]$DocId)

    $QueueFile = Get-QueueFile
    $Queue = @()
    if (Test-Path $QueueFile) {
        try {
            $Raw = Get-Content $QueueFile -Raw | ConvertFrom-Json
            $Queue = @($Raw)
        }
        catch {
            Write-Warn "Failed to read summary queue ($QueueFile) — $($_.Exception.Message). Starting fresh."
            $Queue = @()
        }
    }
    if ($DocId -notin $Queue) {
        $Queue += $DocId
        try {
            @($Queue) | ConvertTo-Json | Write-Utf8NoBom $QueueFile 
            Write-Info "Added to summary queue: $QueueFile"
        }
        catch {
            Write-Warn "Failed to write summary queue — $($_.Exception.Message)"
        }
    }
}
