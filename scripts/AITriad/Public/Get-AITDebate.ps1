# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AITDebate {
    <#
    .SYNOPSIS
        Lists and filters debate sessions from the AI Triad data store.
    .DESCRIPTION
        Reads debate JSON files and returns typed AITDebate objects. Supports
        filtering by ID, topic text, audience, protocol, source type, debater,
        model, origin (gui/cli), phase, date range, and adaptive staging.
    .PARAMETER Id
        Filter by debate ID (exact match or wildcard).
    .PARAMETER Topic
        Filter by topic text (substring match, case-insensitive).
    .PARAMETER Audience
        Filter by audience type.
    .PARAMETER Protocol
        Filter by debate protocol.
    .PARAMETER SourceType
        Filter by source type (topic, document, situations, url).
    .PARAMETER Debater
        Filter to debates that include this speaker.
    .PARAMETER Model
        Filter by AI model used.
    .PARAMETER Origin
        Filter by origin (gui or cli).
    .PARAMETER Phase
        Filter by debate phase (opening, debate, synthesis, complete).
    .PARAMETER AdaptiveStaging
        Filter to debates with adaptive staging enabled.
    .PARAMETER HasSynthesis
        Filter to debates that have a synthesis entry.
    .PARAMETER HasDiagnostics
        Filter to debates that have a diagnostics file.
    .PARAMETER HasHarvest
        Filter to debates that have a harvest file.
    .PARAMETER After
        Filter to debates created after this date.
    .PARAMETER Before
        Filter to debates created before this date.
    .PARAMETER MinRounds
        Filter to debates with at least this many statement rounds.
    .PARAMETER Latest
        Return only the N most recent debates.
    .PARAMETER IncludeTranscript
        Include the full transcript array on each result (large; off by default).
    .EXAMPLE
        Get-AITDebate
    .EXAMPLE
        Get-AITDebate -Topic "regulation" -Audience policymakers
    .EXAMPLE
        Get-AITDebate -AdaptiveStaging -HasSynthesis -Latest 5
    .EXAMPLE
        Get-AITDebate -Origin cli -After "2026-05-01" | Format-Table Id, Title, Phase, Rounds
    .EXAMPLE
        Get-AITDebate -Debater cassandra -Protocol deliberation
    #>
    [CmdletBinding()]
    param(
        [string]$Id,

        [string]$Topic,

        [ValidateSet('policymakers', 'technical_researchers', 'industry_leaders', 'academic_community', 'general_public')]
        [string]$Audience,

        [ValidateSet('structured', 'socratic', 'deliberation')]
        [string]$Protocol,

        [ValidateSet('topic', 'document', 'situations', 'url')]
        [string]$SourceType,

        [ValidateSet('prometheus', 'sentinel', 'cassandra')]
        [string]$Debater,

        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [string]$Model,

        [ValidateSet('gui', 'cli')]
        [string]$Origin,

        [string]$Phase,

        [switch]$AdaptiveStaging,

        [switch]$HasSynthesis,

        [switch]$HasDiagnostics,

        [switch]$HasHarvest,

        [DateTime]$After,

        [DateTime]$Before,

        [ValidateRange(1, 100)]
        [int]$MinRounds,

        [ValidateRange(1, 1000)]
        [int]$Latest,

        [switch]$IncludeTranscript
    )

    Set-StrictMode -Version Latest

    $DebatesDir = Get-DebatesDir
    if (-not (Test-Path $DebatesDir)) {
        Write-Warning "Debates directory not found: $DebatesDir"
        return
    }

    $Files = Get-ChildItem $DebatesDir -Filter 'debate-*.json' -Recurse |
        Where-Object { $_.Name -notmatch 'diagnostics|harvest|transcript' }

    if ($Files.Count -eq 0) {
        Write-Verbose "No debate files found in $DebatesDir"
        return
    }

    $Results = [System.Collections.Generic.List[object]]::new()

    foreach ($File in $Files) {
        try {
            $Raw = Get-Content $File.FullName -Raw | ConvertFrom-Json
        }
        catch {
            Write-Verbose "Skipping malformed file: $($File.Name)"
            continue
        }

        # Extract metadata
        $DebateId    = $Raw.id
        $Title       = $Raw.title
        $TopicText   = if ($Raw.PSObject.Properties['topic'] -and $Raw.topic.PSObject.Properties['original']) { $Raw.topic.original } elseif ($Raw.PSObject.Properties['topic'] -and $Raw.topic -is [string]) { $Raw.topic } else { '' }
        $CreatedAt   = if ($Raw.PSObject.Properties['created_at']) { [DateTime]$Raw.created_at } else { $File.CreationTime }
        $UpdatedAt   = if ($Raw.PSObject.Properties['updated_at']) { [DateTime]$Raw.updated_at } else { $File.LastWriteTime }
        $DebatePhase = if ($Raw.PSObject.Properties['phase']) { $Raw.phase } else { 'unknown' }
        $Aud         = if ($Raw.PSObject.Properties['audience']) { $Raw.audience } else { '' }
        $Proto       = if ($Raw.PSObject.Properties['protocol_id']) { $Raw.protocol_id } else { '' }
        $SrcType     = if ($Raw.PSObject.Properties['source_type']) { $Raw.source_type } else { '' }
        $SrcRef      = if ($Raw.PSObject.Properties['source_ref']) { $Raw.source_ref } else { '' }
        $Debaters    = if ($Raw.PSObject.Properties['active_povers']) { @($Raw.active_povers) } else { @() }
        $Temp        = if ($Raw.PSObject.Properties['debate_temperature']) { $Raw.debate_temperature } else { 0.0 }

        # Origin and model
        $OriginMode = 'unknown'
        $DebateModel = ''
        if ($Raw.PSObject.Properties['origin'] -and $null -ne $Raw.origin) {
            if ($Raw.origin.PSObject.Properties['mode']) { $OriginMode = $Raw.origin.mode }
            if ($Raw.origin.PSObject.Properties['model']) { $DebateModel = $Raw.origin.model }
        }

        # Adaptive staging
        $IsAdaptive = $false
        $PacingVal  = ''
        if ($Raw.PSObject.Properties['adaptive_staging'] -and $null -ne $Raw.adaptive_staging) {
            if ($Raw.adaptive_staging.PSObject.Properties['enabled']) { $IsAdaptive = [bool]$Raw.adaptive_staging.enabled }
            if ($Raw.adaptive_staging.PSObject.Properties['pacing']) { $PacingVal = $Raw.adaptive_staging.pacing }
        }

        # Transcript stats
        $Transcript = if ($Raw.PSObject.Properties['transcript']) { @($Raw.transcript) } else { @() }
        $StmtCount  = @($Transcript | Where-Object { $_.type -eq 'statement' }).Count
        $IntCount   = @($Transcript | Where-Object { $_.type -eq 'intervention' }).Count
        $HasSynth   = @($Transcript | Where-Object { $_.type -eq 'synthesis' }).Count -gt 0

        # Round count: count distinct rounds from statements (3 speakers per round)
        $RoundCount = if ($Debaters.Count -gt 0 -and $StmtCount -gt 0) { [Math]::Ceiling($StmtCount / $Debaters.Count) } else { 0 }

        # Companion files
        $BaseName = $File.BaseName -replace '^debate-', ''
        $Dir = $File.DirectoryName
        $DiagExists   = Test-Path (Join-Path $Dir "*$BaseName*diagnostics*")
        $HarvestExists = Test-Path (Join-Path $Dir "*$BaseName*harvest*")

        # ── Apply filters ──────────────────────────────────────────────────
        if ($Id -and $DebateId -notlike $Id) { continue }
        if ($Topic -and $TopicText -notmatch [regex]::Escape($Topic)) { continue }
        if ($Audience -and $Aud -ne $Audience) { continue }
        if ($Protocol -and $Proto -ne $Protocol) { continue }
        if ($SourceType -and $SrcType -ne $SourceType) { continue }
        if ($Debater -and $Debater -notin $Debaters) { continue }
        if ($Model -and $DebateModel -ne $Model) { continue }
        if ($Origin -and $OriginMode -ne $Origin) { continue }
        if ($Phase -and $DebatePhase -ne $Phase) { continue }
        if ($PSBoundParameters.ContainsKey('AdaptiveStaging') -and $AdaptiveStaging -ne $IsAdaptive) { continue }
        if ($PSBoundParameters.ContainsKey('HasSynthesis') -and $HasSynthesis -ne $HasSynth) { continue }
        if ($PSBoundParameters.ContainsKey('HasDiagnostics') -and $HasDiagnostics -ne $DiagExists) { continue }
        if ($PSBoundParameters.ContainsKey('HasHarvest') -and $HasHarvest -ne $HarvestExists) { continue }
        if ($After -and $CreatedAt -lt $After) { continue }
        if ($Before -and $CreatedAt -gt $Before) { continue }
        if ($MinRounds -and $RoundCount -lt $MinRounds) { continue }

        # ── Build result ───────────────────────────────────────────────────
        $Obj = [AITDebate]::new()
        $Obj.Id               = $DebateId
        $Obj.Title            = $Title
        $Obj.Topic            = $TopicText
        $Obj.CreatedAt        = $CreatedAt
        $Obj.UpdatedAt        = $UpdatedAt
        $Obj.Phase            = $DebatePhase
        $Obj.Audience         = $Aud
        $Obj.Protocol         = $Proto
        $Obj.SourceType       = $SrcType
        $Obj.SourceRef        = $SrcRef
        $Obj.Debaters         = $Debaters
        $Obj.Temperature      = $Temp
        $Obj.Model            = $DebateModel
        $Obj.Origin           = $OriginMode
        $Obj.AdaptiveStaging  = $IsAdaptive
        $Obj.Pacing           = $PacingVal
        $Obj.TranscriptCount  = $Transcript.Count
        $Obj.Rounds           = $RoundCount
        $Obj.Statements       = $StmtCount
        $Obj.Interventions    = $IntCount
        $Obj.HasSynthesis     = $HasSynth
        $Obj.HasDiagnostics   = $DiagExists
        $Obj.HasHarvest       = $HarvestExists
        $Obj.FilePath         = $File.FullName

        if ($IncludeTranscript) {
            $Obj | Add-Member -NotePropertyName 'Transcript' -NotePropertyValue $Transcript -Force
        }

        $Results.Add($Obj)
    }

    # Sort by CreatedAt descending (newest first)
    $Sorted = $Results | Sort-Object CreatedAt -Descending

    if ($Latest) {
        $Sorted | Select-Object -First $Latest
    }
    else {
        $Sorted
    }
}
