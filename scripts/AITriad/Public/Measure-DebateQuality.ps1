# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Measure-DebateQuality {
    <#
    .SYNOPSIS
        Analyzes the quality of a single debate from its saved JSON.
    .DESCRIPTION
        Pure-compute quality report over a saved debate's calibration_log.
        Returns a PSCustomObject with per-dimension scores, an overall 0-100
        rating, and a tier (Excellent/Good/Fair/Poor).

        For pairwise debate comparison, use Compare-DebateQuality instead.

        OverallRating weights the engine's already-computed signals:
          crux_addressed_ratio     × 20    (argument depth: addresses key cruxes)
          taxonomy_mapped_ratio    × 15    (claim coverage: anchored to nodes)
          situation_crux_alignment × 15    (rebuttal effectiveness: focused engagement)
          avg_branch_cohesion      × 10    (POV balance: coherent per-camp threads)
          topic_alignment_rate     × 15    (on-topic discipline)
          (1 - repetition_rate)    × 10    (no recycled arguments)
          (1 - claims_forgotten)   × 10    (claim retention)
          (1 - draft_repair_rate)  ×  5    (rhetorical quality: minimal repair)
        Tiers: ≥75 Excellent · ≥60 Good · ≥40 Fair · <40 Poor.

        Debates missing a calibration_log return OverallRating=$null with a
        warning (the JSON is still parsed; header fields are returned).
    .PARAMETER Path
        File path to a debate JSON.
    .PARAMETER DebateId
        Debate ID (looks up debate-<id>.json under the debates directory).
    .PARAMETER Latest
        Analyze the most recently modified debate JSON.
    .PARAMETER PassThruMetrics
        Include the full raw metrics hashtable in the output (not just the
        summary). Useful for piping into Compare-DebateQuality or custom analysis.
    .EXAMPLE
        Measure-DebateQuality -Latest
    .EXAMPLE
        Measure-DebateQuality -Path debate-abc123.json
    .EXAMPLE
        Measure-DebateQuality -DebateId abc123
    .EXAMPLE
        Get-AITDebate | Measure-DebateQuality
    .EXAMPLE
        Measure-DebateQuality -Latest -PassThruMetrics |
            Select-Object OverallRating, Tier, Metrics
    #>
    [CmdletBinding(DefaultParameterSetName = 'ByPath')]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory, ParameterSetName = 'ByPath', Position = 0, ValueFromPipeline, ValueFromPipelineByPropertyName)]
        [Alias('FullName')]
        [string]$Path,

        [Parameter(Mandatory, ParameterSetName = 'ById')]
        [string]$DebateId,

        [Parameter(Mandatory, ParameterSetName = 'Latest')]
        [switch]$Latest,

        [switch]$PassThruMetrics
    )

    begin {
        Set-StrictMode -Version Latest
        $ErrorActionPreference = 'Stop'
    }

    process {
        # ── Resolve input to a path ──────────────────────────────────────
        $ResolvedPath = switch ($PSCmdlet.ParameterSetName) {
            'ByPath' { Resolve-DebatePath -IdOrPath $Path }
            'ById'   { Resolve-DebatePath -IdOrPath $DebateId }
            'Latest' { Resolve-DebatePath -Latest }
        }

        # ── Extract metrics ──────────────────────────────────────────────
        $Metrics = Get-DebateQualityMetrics -Path $ResolvedPath

        # ── Score ────────────────────────────────────────────────────────
        $OverallRating = $null
        $Tier          = 'Unrated'
        if ($Metrics['has_calibration_log']) {
            $C = $Metrics['calibration']
            $Score =
                ($C['crux_addressed_ratio']      * 20) +
                ($C['taxonomy_mapped_ratio']     * 15) +
                ($C['situation_crux_alignment']  * 15) +
                ($C['avg_branch_cohesion']       * 10) +
                ($C['topic_alignment_rate']      * 15) +
                ((1 - $C['repetition_rate'])     * 10) +
                ((1 - $C['claims_forgotten_rate']) * 10) +
                ((1 - $C['draft_repair_rate'])   *  5)

            # Clamp to [0, 100]: each component is a 0-1 ratio in well-formed data,
            # but defensively guard against malformed values outside that range.
            $OverallRating = [Math]::Round([Math]::Max(0, [Math]::Min(100, $Score)), 1)
            $Tier = if     ($OverallRating -ge 75) { 'Excellent' }
                    elseif ($OverallRating -ge 60) { 'Good' }
                    elseif ($OverallRating -ge 40) { 'Fair' }
                    else                            { 'Poor' }
        } else {
            Write-Warning "Debate '$ResolvedPath' has no calibration_log; OverallRating unavailable."
        }

        # ── Build dimensions surface ─────────────────────────────────────
        # Map calibration metrics onto the human-readable dimensions in the ticket.
        $C = $Metrics['calibration']
        $Dimensions = [ordered]@{
            ArgumentDepth        = $C['crux_addressed_ratio']
            ClaimCoverage        = $C['taxonomy_mapped_ratio']
            RebuttalEffectiveness = $C['situation_crux_alignment']
            POVBalance           = $C['avg_branch_cohesion']
            RhetoricalQuality    = [Math]::Round((1 - $C['draft_repair_rate']), 4)
            TopicAlignment       = $C['topic_alignment_rate']
            RepetitionResistance = [Math]::Round((1 - $C['repetition_rate']), 4)
            ClaimRetention       = [Math]::Round((1 - $C['claims_forgotten_rate']), 4)
        }

        # ── Output ───────────────────────────────────────────────────────
        $Header = $Metrics['header']
        $Output = [ordered]@{
            Path          = $ResolvedPath
            Topic         = $Header['topic']
            Model         = $Header['model']
            Protocol      = $Header['protocol']
            CreatedAt     = $Header['created_at']
            TotalRounds   = $Header['total_rounds']
            OverallRating = $OverallRating
            Tier          = $Tier
            Dimensions    = [PSCustomObject]$Dimensions
        }
        if ($PassThruMetrics) {
            $Output['Metrics'] = $Metrics
        }
        [PSCustomObject]$Output
    }
}
