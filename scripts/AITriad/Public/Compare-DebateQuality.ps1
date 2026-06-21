# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Compare-DebateQuality {
    <#
    .SYNOPSIS
        Side-by-side quality comparison of two debate sessions.
    .DESCRIPTION
        Accepts debate IDs (resolved via Get-AITDebate) or file paths.
        Compares header metadata, calibration metrics, PRM statistics,
        per-agent utilities, and flags confounds (model/temperature/protocol).
    .PARAMETER Baseline
        Debate ID or path to the baseline debate JSON file.
    .PARAMETER Treatment
        Debate ID or path to the treatment (changed) debate JSON file.
    .PARAMETER Format
        Output format: Table (default), Json, or Csv.
    .PARAMETER PassThru
        Return structured comparison object for pipeline use.
    .EXAMPLE
        Compare-DebateQuality -Baseline debate-abc.json -Treatment debate-xyz.json
    .EXAMPLE
        Compare-DebateQuality -Baseline abc123 -Treatment xyz456 -Format Json
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Baseline,
        [Parameter(Mandatory)][string]$Treatment,
        [ValidateSet('Table', 'Json', 'Csv')][string]$Format = 'Table',
        [switch]$PassThru
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    function Resolve-DebatePath([string]$IdOrPath) {
        if (Test-Path $IdOrPath) { return (Resolve-Path $IdOrPath).Path }

        $DebatesDir = Get-DebatesDir
        $Direct = Join-Path $DebatesDir "debate-$IdOrPath.json"
        if (Test-Path $Direct) { return $Direct }

        $Partial = Get-ChildItem $DebatesDir -Filter "debate-$IdOrPath*.json" -Recurse |
            Where-Object { $_.Name -notmatch 'diagnostics|harvest|transcript' } |
            Select-Object -First 1
        if ($Partial) { return $Partial.FullName }

        throw (New-ActionableError `
            -Goal "Resolve debate identifier" `
            -Problem "No debate found matching '$IdOrPath'" `
            -Location "Compare-DebateQuality" `
            -NextSteps @("Verify the debate ID or file path", "Run Get-AITDebate to list available debates"))
    }

    function Get-SafeProp($Obj, [string]$Name, $Default = $null) {
        if ($null -eq $Obj) { return $Default }
        if ($Obj.PSObject.Properties[$Name]) { return $Obj.$Name }
        return $Default
    }

    function Extract-QualityMetrics([string]$Path) {
        $S = Get-Content $Path -Raw | ConvertFrom-Json

        $Header = [ordered]@{
            topic       = Get-SafeProp $S 'title'
            model       = Get-SafeProp $S 'debate_model'
            temperature = Get-SafeProp $S 'debate_temperature'
            protocol    = Get-SafeProp $S 'protocol_id'
            app_version = Get-SafeProp $S 'app_version'
            created_at  = Get-SafeProp $S 'created_at'
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
            header         = $Header
            calibration    = $Calibration
            prm            = $PRM
            prm_components = $PRMComponents
            agents         = $Agents
        }
    }

    $PathA = Resolve-DebatePath $Baseline
    $PathB = Resolve-DebatePath $Treatment

    $MA = Extract-QualityMetrics $PathA
    $MB = Extract-QualityMetrics $PathB

    # Confound detection
    $Confounds = [System.Collections.Generic.List[string]]::new()
    if ($MA.header.model -ne $MB.header.model) {
        $Confounds.Add("Model differs: $($MA.header.model) vs $($MB.header.model)")
    }
    if ($MA.header.temperature -ne $MB.header.temperature) {
        $Confounds.Add("Temperature differs: $($MA.header.temperature) vs $($MB.header.temperature)")
    }
    if ($MA.header.protocol -ne $MB.header.protocol) {
        $Confounds.Add("Protocol differs: $($MA.header.protocol) vs $($MB.header.protocol)")
    }

    $Result = [ordered]@{
        baseline   = [ordered]@{ path = $PathA; metrics = $MA }
        treatment  = [ordered]@{ path = $PathB; metrics = $MB }
        confounds  = @($Confounds)
        deltas     = [ordered]@{}
    }

    foreach ($Key in $MA.calibration.Keys) {
        $VA = $MA.calibration[$Key]; $VB = $MB.calibration[$Key]
        $Delta = [Math]::Round($VB - $VA, 4)
        $Pct = if ($VA -ne 0) { [Math]::Round(($Delta / [Math]::Abs($VA)) * 100, 1) } else { $null }
        $Result.deltas[$Key] = [ordered]@{ baseline = $VA; treatment = $VB; delta = $Delta; pct = $Pct }
    }
    foreach ($Key in $MA.prm.Keys) {
        $VA = $MA.prm[$Key]; $VB = $MB.prm[$Key]
        $Delta = [Math]::Round($VB - $VA, 4)
        $Pct = if ($VA -ne 0) { [Math]::Round(($Delta / [Math]::Abs($VA)) * 100, 1) } else { $null }
        $Result.deltas["prm_$Key"] = [ordered]@{ baseline = $VA; treatment = $VB; delta = $Delta; pct = $Pct }
    }

    if ($PassThru) { return $Result }

    if ($Format -eq 'Json') {
        return ($Result | ConvertTo-Json -Depth 10)
    }
    if ($Format -eq 'Csv') {
        $Rows = [System.Collections.Generic.List[PSObject]]::new()
        foreach ($Key in $Result.deltas.Keys) {
            $D = $Result.deltas[$Key]
            $Rows.Add([PSCustomObject]@{
                Metric    = $Key
                Baseline  = $D.baseline
                Treatment = $D.treatment
                Delta     = $D.delta
                PctChange = $D.pct
            })
        }
        return ($Rows | ConvertTo-Csv -NoTypeInformation)
    }

    # Table format
    foreach ($C in $Confounds) { Write-Warning $C }

    Write-Host ""
    Write-Host "  DEBATE QUALITY COMPARISON" -ForegroundColor White
    Write-Host "  $('─' * 80)" -ForegroundColor DarkGray

    # Header
    Write-Host ('  {0,-28} {1,-24} {2,-24}' -f '', 'Baseline', 'Treatment') -ForegroundColor Cyan
    foreach ($Key in $MA.header.Keys) {
        $VA = $MA.header[$Key] ?? '—'
        $VB = $MB.header[$Key] ?? '—'
        Write-Host ('  {0,-28} {1,-24} {2,-24}' -f $Key, $VA, $VB) -ForegroundColor Gray
    }

    Write-Host "  $('─' * 80)" -ForegroundColor DarkGray
    Write-Host ('  {0,-28} {1,10} {2,10} {3,8} {4,8}' -f 'Metric', 'Baseline', 'Treatment', 'Delta', '%Chg') -ForegroundColor Cyan

    $LowerIsBetter = @('repetition_rate', 'claims_forgotten_rate', 'concession_cascades', 'prm_stddev')

    foreach ($Key in $Result.deltas.Keys) {
        $D = $Result.deltas[$Key]
        $DeltaStr = if ($D.delta -gt 0) { "+$($D.delta)" } elseif ($D.delta -eq 0) { '=' } else { "$($D.delta)" }
        $PctStr = if ($null -ne $D.pct) { "$($D.pct)%" } else { '—' }

        $Color = if ($Key -in $LowerIsBetter) {
            if ($D.delta -le 0) { 'Green' } else { 'Yellow' }
        } else {
            if ($D.delta -gt 0) { 'Green' } elseif ($D.delta -lt 0) { 'Yellow' } else { 'Gray' }
        }

        Write-Host ('  {0,-28} {1,10} {2,10} ' -f $Key, $D.baseline, $D.treatment) -ForegroundColor Gray -NoNewline
        Write-Host ('{0,8} {1,8}' -f $DeltaStr, $PctStr) -ForegroundColor $Color
    }

    # PRM components
    $AllCompKeys = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($K in $MA.prm_components.Keys) { [void]$AllCompKeys.Add($K) }
    foreach ($K in $MB.prm_components.Keys) { [void]$AllCompKeys.Add($K) }

    if ($AllCompKeys.Count -gt 0) {
        Write-Host "  $('─' * 80)" -ForegroundColor DarkGray
        Write-Host "  PRM COMPONENTS" -ForegroundColor White
        foreach ($Key in ($AllCompKeys | Sort-Object)) {
            $VA = if ($MA.prm_components.Contains($Key)) { $MA.prm_components[$Key] } else { 0 }
            $VB = if ($MB.prm_components.Contains($Key)) { $MB.prm_components[$Key] } else { 0 }
            $Delta = [Math]::Round($VB - $VA, 4)
            $DeltaStr = if ($Delta -gt 0) { "+$Delta" } elseif ($Delta -eq 0) { '=' } else { "$Delta" }
            $Color = if ($Delta -gt 0) { 'Green' } elseif ($Delta -lt 0) { 'Yellow' } else { 'Gray' }
            Write-Host ('  {0,-28} {1,10} {2,10} ' -f "  $Key", $VA, $VB) -ForegroundColor Gray -NoNewline
            Write-Host ('{0,8}' -f $DeltaStr) -ForegroundColor $Color
        }
    }

    # Per-agent
    $AllAgents = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($K in $MA.agents.Keys) { [void]$AllAgents.Add($K) }
    foreach ($K in $MB.agents.Keys) { [void]$AllAgents.Add($K) }

    if ($AllAgents.Count -gt 0) {
        Write-Host "  $('─' * 80)" -ForegroundColor DarkGray
        Write-Host "  PER-AGENT UTILITIES" -ForegroundColor White
        foreach ($Agent in ($AllAgents | Sort-Object)) {
            Write-Host "    $Agent" -ForegroundColor Cyan
            $SubA = if ($MA.agents.Contains($Agent)) { $MA.agents[$Agent] } else { [ordered]@{ composite = 0; crux_engagement = 0; topic_coherence = 0 } }
            $SubB = if ($MB.agents.Contains($Agent)) { $MB.agents[$Agent] } else { [ordered]@{ composite = 0; crux_engagement = 0; topic_coherence = 0 } }
            foreach ($Metric in @('composite', 'crux_engagement', 'topic_coherence')) {
                $VA = $SubA[$Metric]; $VB = $SubB[$Metric]
                $Delta = [Math]::Round($VB - $VA, 4)
                $DeltaStr = if ($Delta -gt 0) { "+$Delta" } elseif ($Delta -eq 0) { '=' } else { "$Delta" }
                $Color = if ($Delta -gt 0) { 'Green' } elseif ($Delta -lt 0) { 'Yellow' } else { 'Gray' }
                Write-Host ('  {0,-28} {1,10} {2,10} ' -f "    $Metric", $VA, $VB) -ForegroundColor Gray -NoNewline
                Write-Host ('{0,8}' -f $DeltaStr) -ForegroundColor $Color
            }
        }
    }

    Write-Host "  $('─' * 80)" -ForegroundColor DarkGray
    Write-Host ""
}
