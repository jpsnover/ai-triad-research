# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Appends a doc-id to the .summarise-queue.json file.

function Add-ToSummaryQueue {
    param([string]$DocId)

    $QueueFile = Join-Path $script:RepoRoot '.summarise-queue.json'
    $Queue = @()
    if (Test-Path $QueueFile) {
        try { $Queue = Get-Content $QueueFile -Raw | ConvertFrom-Json } catch {}
        if ($null -eq $Queue) { $Queue = @() }
    }
    if ($DocId -notin $Queue) {
        $Queue += $DocId
        $Queue | ConvertTo-Json | Set-Content $QueueFile -Encoding UTF8
        Write-Info "Added to summary queue: $QueueFile"
    }
}
