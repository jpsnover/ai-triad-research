# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Approve-Edge {
    <#
    .SYNOPSIS
        Approves or rejects proposed edges in the taxonomy graph.
    .DESCRIPTION
        Changes the status of edges in edges.json from 'proposed' to 'approved'
        or 'rejected'. Can operate on individual edges by index, or interactively
        review all proposed edges.
    .PARAMETER Index
        Zero-based index of the edge in edges.json to approve/reject.
        Use Get-GraphNode or review edges.json to find the index.
    .PARAMETER Approve
        Set the edge status to 'approved'.
    .PARAMETER Reject
        Set the edge status to 'rejected'.
    .PARAMETER Interactive
        Interactively review all proposed edges one by one.
    .PARAMETER BulkApprove
        Approve all proposed edges that meet the MinConfidence threshold.
    .PARAMETER MinConfidence
        Minimum confidence score for bulk approval (0.0-1.0). Default: 0.8.
        Only used with -BulkApprove.
    .PARAMETER RepoRoot
        Path to the repository root.
    .EXAMPLE
        Approve-Edge -Index 0 -Approve
    .EXAMPLE
        Approve-Edge -Index 5 -Reject
    .EXAMPLE
        Approve-Edge -Interactive
    .EXAMPLE
        Approve-Edge -BulkApprove -MinConfidence 0.8
    .EXAMPLE
        Approve-Edge -BulkApprove -MinConfidence 0.9
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [int]$Index = -1,

        [switch]$Approve,

        [switch]$Reject,

        [switch]$Interactive,

        [switch]$BulkApprove,

        [ValidateRange(0.0, 1.0)]
        [double]$MinConfidence = 0.8,

        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $TaxDir = Get-TaxonomyDir
    $EdgesPath = Join-Path $TaxDir 'edges.json'

    if (-not (Test-Path $EdgesPath)) {
        Write-Fail 'No edges.json found. Run Invoke-EdgeDiscovery first.'
        return
    }

    $EdgesData = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json

    if ($Interactive) {
        $Proposed = @()
        for ($i = 0; $i -lt $EdgesData.edges.Count; $i++) {
            if ($EdgesData.edges[$i].status -eq 'proposed') {
                $Proposed += [PSCustomObject]@{ Index = $i; Edge = $EdgesData.edges[$i] }
            }
        }

        if ($Proposed.Count -eq 0) {
            Write-OK 'No proposed edges to review.'
            return
        }

        Write-Host ''
        Write-Host "=== Interactive Edge Review: $($Proposed.Count) proposed edge(s) ===" -ForegroundColor Cyan
        Write-Host ''

        $ApprovedCount = 0
        $RejectedCount = 0
        $SkippedCount  = 0

        foreach ($Item in $Proposed) {
            $E = $Item.Edge
            Write-Host "[$($Item.Index)] " -NoNewline -ForegroundColor DarkGray
            Write-Host "$($E.source)" -NoNewline -ForegroundColor Green
            Write-Host " --[$($E.type)]--> " -NoNewline -ForegroundColor Yellow
            Write-Host "$($E.target)" -ForegroundColor Green
            Write-Host "    Confidence: $($E.confidence)  Strength: $(if ($E.PSObject.Properties['strength']) { $E.strength } else { 'n/a' })" -ForegroundColor DarkGray
            Write-Host "    Rationale:  $($E.rationale)" -ForegroundColor White
            if ($E.PSObject.Properties['notes'] -and $E.notes) {
                Write-Host "    Notes:      $($E.notes)" -ForegroundColor DarkGray
            }
            Write-Host ''

            $Choice = Read-Host '  (a)pprove / (r)eject / (s)kip / (q)uit'
            switch ($Choice.ToLower()) {
                'a' {
                    $EdgesData.edges[$Item.Index].status = 'approved'
                    $ApprovedCount++
                    Write-OK 'Approved'
                }
                'r' {
                    $EdgesData.edges[$Item.Index].status = 'rejected'
                    $RejectedCount++
                    Write-OK 'Rejected'
                }
                'q' {
                    Write-Info 'Quitting review.'
                    break
                }
                default {
                    $SkippedCount++
                    Write-Info 'Skipped'
                }
            }
            Write-Host ''

            if ($Choice.ToLower() -eq 'q') { break }
        }

        Write-Host ''
        Write-Host "Review complete: $ApprovedCount approved, $RejectedCount rejected, $SkippedCount skipped" -ForegroundColor Cyan
    } elseif ($BulkApprove) {
        $Candidates = @()
        for ($i = 0; $i -lt $EdgesData.edges.Count; $i++) {
            $E = $EdgesData.edges[$i]
            if ($E.status -eq 'proposed' -and $E.confidence -ge $MinConfidence) {
                $Candidates += [PSCustomObject]@{ Index = $i; Edge = $E }
            }
        }

        if ($Candidates.Count -eq 0) {
            Write-OK "No proposed edges with confidence >= $MinConfidence"
            return
        }

        if ($PSCmdlet.ShouldProcess("$($Candidates.Count) edges with confidence >= $MinConfidence", 'Bulk approve')) {
            foreach ($Item in $Candidates) {
                $EdgesData.edges[$Item.Index].status = 'approved'
            }
            Write-OK "Bulk approved $($Candidates.Count) edges (confidence >= $MinConfidence)"
        }
    } elseif ($Index -ge 0) {
        if ($Index -ge $EdgesData.edges.Count) {
            Write-Fail "Edge index $Index out of range (0-$($EdgesData.edges.Count - 1))"
            return
        }

        if ($Approve -and $Reject) {
            Write-Fail 'Specify either -Approve or -Reject, not both.'
            return
        }
        if (-not $Approve -and -not $Reject) {
            Write-Fail 'Specify either -Approve or -Reject.'
            return
        }

        if ($Approve) { $NewStatus = 'approved' } else { $NewStatus = 'rejected' }
        $E = $EdgesData.edges[$Index]

        if ($PSCmdlet.ShouldProcess("Edge $Index ($($E.source) → $($E.target))", "Set status to '$NewStatus'")) {
            $EdgesData.edges[$Index].status = $NewStatus
            Write-OK "Edge $Index ($($E.source) --[$($E.type)]--> $($E.target)): $NewStatus"
        }
    } else {
        Write-Fail 'Specify -Index with -Approve/-Reject, -Interactive, or -BulkApprove.'
        return
    }

    # Save
    if ($PSCmdlet.ShouldProcess($EdgesPath, 'Write updated edges file')) {
        $EdgesData.last_modified = (Get-Date).ToString('yyyy-MM-dd')
        $Json = $EdgesData | ConvertTo-Json -Depth 20
        try {
            Set-Content -Path $EdgesPath -Value $Json -Encoding UTF8
            Write-OK "Saved $EdgesPath"
        }
        catch {
            Write-Fail "Failed to write edges.json — $($_.Exception.Message)"
            Write-Info "Approval changes were NOT saved. Check file permissions and try again."
            throw
        }
    }
}
