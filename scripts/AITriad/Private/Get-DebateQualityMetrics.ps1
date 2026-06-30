# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Pure-compute quality metrics extraction from a saved debate JSON file.
# Lifted from the inner Extract-QualityMetrics function in Compare-DebateQuality
# so Measure-DebateQuality can reuse the same shape.
# Dot-sourced by AITriad.psm1 — do NOT export.

function Get-DebateQualityMetrics {
    <#
    .SYNOPSIS
        Extracts quality metrics from a saved debate JSON file.
    .DESCRIPTION
        Returns an ordered hashtable with five sections:
          header          — topic, model, temperature, protocol, version, timestamp, round count
          calibration     — crux/taxonomy/coherence ratios from calibration_log
          prm             — process-reward mean/stddev/min
          prm_components  — averaged per-component PRM scores
          agents          — per-agent utility scores

        Pure compute against the debate JSON; no LLM call. Missing fields
        default to zero so the shape is stable across debate-engine versions.
    .PARAMETER Path
        Absolute path to the debate JSON.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    Set-StrictMode -Version Latest

    function Get-SafeProp($Obj, [string]$Name, $Default = $null) {
        if ($null -eq $Obj) { return $Default }
        if ($Obj.PSObject.Properties[$Name]) { return $Obj.$Name }
        return $Default
    }

    $S = Get-Content $Path -Raw | ConvertFrom-Json

    $Header = [ordered]@{
        topic        = Get-SafeProp $S 'title'
        model        = Get-SafeProp $S 'debate_model'
        temperature  = Get-SafeProp $S 'debate_temperature'
        protocol     = Get-SafeProp $S 'protocol_id'
        app_version  = Get-SafeProp $S 'app_version'
        created_at   = Get-SafeProp $S 'created_at'
        total_rounds = if ($S.PSObject.Properties['transcript'] -and $S.transcript) { @($S.transcript).Count } else { 0 }
    }

    $CL = Get-SafeProp $S 'calibration_log'
    $Calibration = [ordered]@{
        crux_addressed_ratio      = if ($CL) { [Math]::Round((Get-SafeProp $CL 'crux_addressed_ratio' 0), 4) } else { 0 }
        repetition_rate           = if ($CL) { [Math]::Round((Get-SafeProp $CL 'repetition_rate' 0), 4) } else { 0 }
        claims_forgotten_rate     = if ($CL) { [Math]::Round((Get-SafeProp $CL 'claims_forgotten_rate' 0), 4) } else { 0 }
        taxonomy_mapped_ratio     = if ($CL) { [Math]::Round((Get-SafeProp $CL 'taxonomy_mapped_ratio' 0), 4) } else { 0 }
        avg_utilization_rate      = if ($CL) { [Math]::Round((Get-SafeProp $CL 'avg_utilization_rate' 0), 4) } else { 0 }
        situation_crux_alignment  = if ($CL) { [Math]::Round((Get-SafeProp $CL 'situation_crux_alignment' 0), 4) } else { 0 }
        avg_branch_cohesion       = if ($CL) { [Math]::Round((Get-SafeProp $CL 'avg_branch_cohesion' 0), 4) } else { 0 }
        draft_repair_rate         = if ($CL) { [Math]::Round((Get-SafeProp $CL 'draft_repair_rate' 0), 4) } else { 0 }
        concession_cascades       = if ($CL) { [int](Get-SafeProp $CL 'concession_cascades' 0) } else { 0 }
        topic_alignment_rate      = if ($CL) { [Math]::Round((Get-SafeProp $CL 'topic_alignment_rate' 0), 4) } else { 0 }
    }

    $PRM = [ordered]@{
        mean   = if ($CL) { [Math]::Round((Get-SafeProp $CL 'process_reward_mean' 0), 4) } else { 0 }
        stddev = if ($CL) { [Math]::Round((Get-SafeProp $CL 'process_reward_stddev' 0), 4) } else { 0 }
        min    = if ($CL) { [Math]::Round((Get-SafeProp $CL 'process_reward_min' 0), 4) } else { 0 }
    }

    $PRMComponents = [ordered]@{}
    if ($S.PSObject.Properties['process_rewards'] -and $S.process_rewards) {
        $CompSums = @{}; $CompCounts = @{}
        foreach ($PR in @($S.process_rewards)) {
            if ($null -eq $PR) { continue }
            $Comps = Get-SafeProp $PR 'components'
            if ($null -eq $Comps) { continue }
            foreach ($Prop in $Comps.PSObject.Properties) {
                if (-not $CompSums.ContainsKey($Prop.Name)) {
                    $CompSums[$Prop.Name] = 0.0
                    $CompCounts[$Prop.Name] = 0
                }
                $CompSums[$Prop.Name] += [double]$Prop.Value
                $CompCounts[$Prop.Name]++
            }
        }
        foreach ($Key in ($CompSums.Keys | Sort-Object)) {
            $PRMComponents[$Key] = [Math]::Round($CompSums[$Key] / $CompCounts[$Key], 4)
        }
    }

    $Agents = [ordered]@{}
    if ($CL -and $CL.PSObject.Properties['agent_utilities'] -and $CL.agent_utilities) {
        foreach ($Prop in $CL.agent_utilities.PSObject.Properties) {
            $AU = $Prop.Value
            $Agents[$Prop.Name] = [ordered]@{
                composite       = [Math]::Round((Get-SafeProp $AU 'composite' 0), 4)
                crux_engagement = [Math]::Round((Get-SafeProp $AU 'crux_engagement' 0), 4)
                topic_coherence = [Math]::Round((Get-SafeProp $AU 'topic_coherence' 0), 4)
            }
        }
    }
    if ($CL -and $CL.PSObject.Properties['topic_coherence_per_speaker'] -and $CL.topic_coherence_per_speaker) {
        foreach ($Prop in $CL.topic_coherence_per_speaker.PSObject.Properties) {
            if (-not $Agents.Contains($Prop.Name)) {
                $Agents[$Prop.Name] = [ordered]@{ composite = 0; crux_engagement = 0; topic_coherence = 0 }
            }
            $Agents[$Prop.Name]['topic_coherence'] = [Math]::Round([double]$Prop.Value, 4)
        }
    }

    return [ordered]@{
        header              = $Header
        calibration         = $Calibration
        prm                 = $PRM
        prm_components      = $PRMComponents
        agents              = $Agents
        has_calibration_log = ($null -ne $CL)
    }
}
