# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Find-Conflict {
    <#
    .SYNOPSIS
        Factual conflict detection and deduplication.
    .DESCRIPTION
        Called by Invoke-BatchSummary after each summary is generated.
        Groups conflicts by Claim ID to prevent duplicate entries.

        Logic:
            1. Read the newly generated summary JSON.
            2. For each factual_claim in the summary:
               a. Check if a conflict file with that claim_id already exists in conflicts/.
               b. If YES: append a new instance entry to the existing file.
               c. If NO:  create a new conflict file with a generated claim_id.
            3. Never delete or overwrite conflict files — append only.
    .PARAMETER DocId
        The document ID whose summary should be checked for conflicts.
    .EXAMPLE
        Find-Conflict -DocId 'some-document-id'
    .OUTPUTS
        PSCustomObject with PSTypeName 'AITriad.ConflictResult'
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$DocId
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $ConflictsDir = Get-ConflictsDir
    $SummariesDir = Get-SummariesDir

    # -- Load summary --------------------------------------------------------
    $SummaryPath = Join-Path $SummariesDir "$DocId.json"
    if (-not (Test-Path $SummaryPath)) {
        Write-Warn "Summary not found: $SummaryPath"
        return
    }

    $summaryObject = Get-Content $SummaryPath -Raw | ConvertFrom-Json -AsHashtable

    # -- Ensure conflicts/ exists --------------------------------------------
    if (-not (Test-Path $ConflictsDir)) {
        [void](New-Item -Path $ConflictsDir -ItemType Directory -Force)
        Write-Info "Created conflicts directory"
    }

    # -- Counters ------------------------------------------------------------
    $today   = Get-Date -Format "yyyy-MM-dd"
    $created  = 0
    $appended = 0
    $skipped  = 0

    $claims = @($summaryObject["factual_claims"])
    if ($claims.Count -eq 0 -or ($claims.Count -eq 1 -and $null -eq $claims[0])) {
        Write-Info "No factual claims to process for $DocId."
        return [PSCustomObject]@{
            PSTypeName      = 'AITriad.ConflictResult'
            DocId           = $DocId
            ClaimsProcessed = 0
            Appended        = 0
            Created         = 0
            Skipped         = 0
        }
    }

    $writeErrors = 0
    foreach ($claim in $claims) {
      try {
        $claimText   = $claim["claim"]
        $claimLabel  = $claim["claim_label"]
        $docPosition = $claim["doc_position"]
        $hintId      = $claim["potential_conflict_id"]
        $linkedNodes = @()
        if ($claim.Contains("linked_taxonomy_nodes") -and $claim["linked_taxonomy_nodes"]) {
            $linkedNodes = @($claim["linked_taxonomy_nodes"])
        }

        # Normalize stance value
        $stance = if ($docPosition -in @('supports','disputes','neutral','qualifies')) { $docPosition } else { 'neutral' }

        $newInstance = [ordered]@{
            doc_id       = $DocId
            stance       = $stance
            assertion    = $claimText
            date_flagged = $today
        }

        if ($hintId) {
            # --- Hint ID provided by the model ----------------------------------
            $existingPath = Join-Path $ConflictsDir "$hintId.json"

            if (Test-Path $existingPath) {
                $conflictData = Get-Content $existingPath -Raw | ConvertFrom-Json -AsHashtable
                $alreadyLogged = $conflictData["instances"] | Where-Object { $_["doc_id"] -eq $DocId }
                if ($alreadyLogged) {
                    Write-Info "  SKIP duplicate conflict instance: $hintId (doc already logged)"
                    $skipped++
                } else {
                    $conflictData["instances"] += $newInstance
                    # Merge in any new linked taxonomy nodes
                    if ($linkedNodes.Count -gt 0) {
                        $existing = @($conflictData["linked_taxonomy_nodes"])
                        $merged   = @(($existing + $linkedNodes) | Select-Object -Unique)
                        $conflictData["linked_taxonomy_nodes"] = $merged
                    }
                    Set-Content -Path $existingPath -Value ($conflictData | ConvertTo-Json -Depth 10) -Encoding UTF8
                    Write-OK "  Appended to existing conflict: $hintId"
                    $appended++
                }
            } else {
                Write-Warn "  Suggested conflict '$hintId' not found — creating new file"
                $newConflict = [ordered]@{
                    claim_id              = $hintId
                    claim_label           = if ($claimLabel) { $claimLabel } else { $claimText.Substring(0, [Math]::Min(80, $claimText.Length)) }
                    description           = $claimText
                    status                = "open"
                    linked_taxonomy_nodes = [string[]]$linkedNodes
                    instances             = @($newInstance)
                    human_notes           = @()
                }
                Set-Content -Path $existingPath -Value ($newConflict | ConvertTo-Json -Depth 10) -Encoding UTF8
                Write-OK "  Created new conflict file: $hintId.json"
                $created++
            }
        } else {
            # --- No hint — generate ID from claim text --------------------------
            $slug = $claimText.ToLower() -replace '[^\w\s]', '' -replace '\s+', '-'
            $slug = $slug.Substring(0, [Math]::Min(40, $slug.Length)).TrimEnd('-')
            $newId = "conflict-$slug-$($DocId.Substring(0,[Math]::Min(8,$DocId.Length)))"

            $existingMatch = Get-ChildItem $ConflictsDir -Filter "*.json" |
                Where-Object { $_.BaseName -like "*$($slug.Substring(0,[Math]::Min(20,$slug.Length)))*" } |
                Select-Object -First 1

            if ($existingMatch) {
                $conflictData = Get-Content $existingMatch.FullName -Raw | ConvertFrom-Json -AsHashtable
                $alreadyLogged = $conflictData["instances"] | Where-Object { $_["doc_id"] -eq $DocId }
                if ($alreadyLogged) {
                    Write-Info "  SKIP duplicate (fuzzy match): $($existingMatch.BaseName)"
                    $skipped++
                } else {
                    $conflictData["instances"] += $newInstance
                    # Merge in any new linked taxonomy nodes
                    if ($linkedNodes.Count -gt 0) {
                        $existing = @($conflictData["linked_taxonomy_nodes"])
                        $merged   = @(($existing + $linkedNodes) | Select-Object -Unique)
                        $conflictData["linked_taxonomy_nodes"] = $merged
                    }
                    Set-Content -Path $existingMatch.FullName -Value ($conflictData | ConvertTo-Json -Depth 10) -Encoding UTF8
                    Write-OK "  Appended to fuzzy-matched conflict: $($existingMatch.BaseName)"
                    $appended++
                }
            } else {
                $newConflictPath = Join-Path $ConflictsDir "$newId.json"
                $newConflict = [ordered]@{
                    claim_id              = $newId
                    claim_label           = if ($claimLabel) { $claimLabel } else { $claimText.Substring(0, [Math]::Min(80, $claimText.Length)) }
                    description           = $claimText
                    status                = "open"
                    linked_taxonomy_nodes = [string[]]$linkedNodes
                    instances             = @($newInstance)
                    human_notes           = @()
                }
                Set-Content -Path $newConflictPath -Value ($newConflict | ConvertTo-Json -Depth 10) -Encoding UTF8
                Write-OK "  Created new conflict file: $newId.json"
                $created++
            }
        }
      }
      catch {
        $writeErrors++
        Write-Warn "  Failed to write conflict file for claim — $($_.Exception.Message)"
      }
    }

    if ($writeErrors -gt 0) {
        Write-Warn "$writeErrors conflict file write(s) failed. Check disk space and permissions."
    }

    # -- Return result object ------------------------------------------------
    $processed = $created + $appended + $skipped
    Write-Info "Conflict detection complete: $processed claims — $created created, $appended appended, $skipped skipped"

    [PSCustomObject]@{
        PSTypeName      = 'AITriad.ConflictResult'
        DocId           = $DocId
        ClaimsProcessed = $processed
        Appended        = $appended
        Created         = $created
        Skipped         = $skipped
    }
}
