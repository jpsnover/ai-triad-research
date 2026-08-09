# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-OutOfScopeGuardPass {
    <#
    .SYNOPSIS
        Flags key_points whose topic has no valid home in the POV taxonomy (t/2370).
    .DESCRIPTION
        Runs after Invoke-Mechanism5RetrievalPass. Applies a three-arm bar to identify
        key_points that are genuinely out-of-scope for their POV taxonomy, where the
        correct disposition is "unmapped / human review" rather than a forced assignment.

        A key_point is flagged (out_of_scope_flag = $true) iff ALL three hold:
          Arm A — best POV candidate is absolutely weak:
                  mechanism5_candidates[0].score < Ceiling (default 0.30)
          Arm B — already a flagged misfire:
                  mechanism5_flag = $true
          Arm C — no rescue candidate (false-positive guard):
                  no POV-filtered top-3 candidate reaches GoodAlternativeFloor (default 0.45)

        Ships FLAG-ONLY (no nulling of taxonomy_node_id). Calibration gate per t/2370#1:
        reproduce the two named adjudication misfires empirically before enabling actuation.
        Mirrors the Mechanism #5 surface-first discipline (t/2357).

        Degrades gracefully — no-op when M5 did not run; never throws; never modifies
        fields other than out_of_scope_flag and out_of_scope_top1_score.

    .PARAMETER KeyPointItems
        Array of hashtables @{KeyPoint=<PSObject>; POV='accelerationist'|'safetyist'|'skeptic'}.
        Same format as Invoke-Mechanism5RetrievalPass.
    .PARAMETER Ceiling
        Arm A threshold: top-1 POV-filtered cosine must be below this to qualify.
        Default 0.30 — provisional, calibration-gated (t/2370#1).
        Registered: metric-provenance-register out_of_scope_ceiling (provisional).
    .PARAMETER GoodAlternativeFloor
        Arm C threshold: if any top-3 candidate meets or exceeds this score, the misfire
        is retrieval-fixable (t/2341's lever) — not out-of-scope.
        Default 0.45 — reuses RetrievalConfidenceThreshold.
        Registered: metric-provenance-register good_alternative_floor (provisional).
    #>
    [CmdletBinding()]
    param(
        [object[]]$KeyPointItems,
        [double]$Ceiling = 0.30,
        [double]$GoodAlternativeFloor = 0.45
    )

    if (-not $KeyPointItems -or $KeyPointItems.Count -eq 0) { return }

    $FlaggedCount = 0
    foreach ($Item in $KeyPointItems) {
        $kp = $Item.KeyPoint

        # Arm B: only examine kps that M5 already flagged as misfires
        $M5Flag = $false
        if ($kp.PSObject.Properties['mechanism5_flag'] -and $kp.mechanism5_flag -eq $true) {
            $M5Flag = $true
        }
        if (-not $M5Flag) { continue }

        # Arm A: top-1 POV-filtered candidate score must be absolutely weak
        $Top1Score = $null
        if ($kp.PSObject.Properties['mechanism5_candidates'] -and $kp.mechanism5_candidates) {
            $Cands = @($kp.mechanism5_candidates)
            if ($Cands.Count -gt 0 -and $Cands[0].PSObject.Properties['score']) {
                $Top1Score = [double]$Cands[0].score
            }
        }
        if ($null -eq $Top1Score) { continue }  # M5 ran but no candidates — skip
        if ($Top1Score -ge $Ceiling) { continue }  # Strong enough best candidate → not OOS

        # Arm C: false-positive guard — no rescue candidate at or above good_alternative_floor
        $Cands = @($kp.mechanism5_candidates)
        $HasRescue = @($Cands | Where-Object {
            $_.PSObject.Properties['score'] -and [double]$_.score -ge $GoodAlternativeFloor
        }).Count -gt 0
        if ($HasRescue) { continue }  # Retrieval-fixable misfire — leave for t/2341's lever

        # All three arms pass: flag as out-of-scope
        Set-KeyPointField $kp 'out_of_scope_flag'       $true
        Set-KeyPointField $kp 'out_of_scope_top1_score' $Top1Score
        $FlaggedCount++
    }

    if ($FlaggedCount -gt 0) {
        Write-Host "  │  oos-guard: $FlaggedCount key_point(s) flagged out-of-scope (flag-only, t/2370)" -ForegroundColor DarkYellow
    }
}
