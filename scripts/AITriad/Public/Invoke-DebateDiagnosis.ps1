# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-DebateDiagnosis {
    <#
    .SYNOPSIS
        Structured debate-issue analysis from a flight recorder JSONL dump (t/3768).

    .DESCRIPTION
        Diagnosing debate bugs by hand means grepping the dump ~15-20 times to assemble a
        picture of phase/round progression, which POVer got which moderator intervention, and
        what actually failed. This cmdlet does that in one pass.

        Field shapes below are verified against a REAL 2877-event debate dump (t/3768#2), not
        assumed from the ticket sketch or the debate engine source alone — three of the
        originally-proposed field locations (an.commit, debate.opening_added, a literal
        debate.closure event) turned out not to carry what was expected; see the caveats below.

        A single dump can contain MULTIPLE run_ids under one debate_id (confirmed in the real
        dump — situation-debate sub-runs share a container debate but each gets its own
        run_id), so CommitState/ClosureAnalysis group by RunId.

          Runs              — {RunId, DebateId, Topic, Povers, Model, Audience}, from the first
                              debate.phase event per run_id that carries data.povers.
          PhaseProgression  — ordered distinct data.phase values (from debate.phase +
                              debate.round events) with first-seen Seq + entry count.
          RoundSummary      — debate.round events that carry data.round (the "crossRespond
                              entered" marker event does not, and is skipped): RunId, Round,
                              Phase, Speakers, Message, Seq.
          CommitState       — debate.moderate events with data.intervention_move -eq 'COMMIT',
                              grouped by (RunId, data.responder — the targeted POVer): CommitCount,
                              Rounds (the debate.round-tracked current round at COMMIT time for
                              that RunId, best-effort — null if no round event preceded it).
          ClosureAnalysis   — DERIVED, not a literal event lookup: no debate.closure/
                              debate.lifecycle event fires in the real dump, so "did closure
                              fire" is computed as all-of-Runs[RunId].Povers having >=1 COMMIT
                              in CommitState for that RunId. MissingPovers lists who has not.
          Errors            — level in {error, fatal}, any event type (not just system.error).
          Warnings          — level -eq 'warn', any event type, DEDUPED by message (Count +
                              first/last Seq) — there is no dedicated system.warn type; ai.retry,
                              turn.repair, system.error itself, etc. all fire at level=warn.
          SteelmanSummary   — BEST-EFFORT text scan, not a structured field. steelman_of /
                              prior_steelmans never appear as clean JSON fields in the real
                              dump — they only leak as raw substrings inside a parse-failure
                              system.error event's discarded_head/discarded_tail/response_head/
                              response_tail text blobs (confirmed: the real dump's seq 2721/2722
                              parseAIJson-exhausted-recovery failure). Reports the Seq/Type of
                              any event whose serialized payload contains "steelman_of" or
                              "prior_steelmans", with a short context snippet — inspect the raw
                              event for the actual value; this is not parsed structurally
                              because the field is not logged structurally.

    .PARAMETER DumpPath
        Path to the flight recorder JSONL dump file.
    .PARAMETER RunId
        Restrict all per-run sections (Runs/RoundSummary/CommitState/ClosureAnalysis) to this
        run_id. Errors/Warnings/SteelmanSummary are never restricted (a bug can span runs).
    .PARAMETER AsObject
        Return structured output instead of formatted text.
    .OUTPUTS
        [pscustomobject] { BuildDate; Runs; PhaseProgression; RoundSummary; CommitState;
        ClosureAnalysis; Errors; Warnings; SteelmanSummary }
    .EXAMPLE
        Invoke-DebateDiagnosis -DumpPath ./flight-recorder-dump.jsonl
    .EXAMPLE
        Get-FlightRecorderDump -Last 1 | Invoke-DebateDiagnosis -AsObject |
            Select-Object -ExpandProperty ClosureAnalysis
    .LINK
        Get-FlightRecorderDump
    .LINK
        Get-FlightRecorderReport
    .LINK
        Read-FlightRecorderDump
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory, ValueFromPipeline, ValueFromPipelineByPropertyName)]
        [Alias('FullName')]
        [string]$DumpPath,

        [Parameter()]
        [string]$RunId,

        [Parameter()]
        [switch]$AsObject
    )

    process {
        if (-not (Test-Path -LiteralPath $DumpPath)) {
            New-ActionableError `
                -Goal 'Diagnose a debate flight recorder dump' `
                -Problem "File not found: $DumpPath" `
                -Location 'Invoke-DebateDiagnosis' `
                -NextSteps @(
                    'Verify the dump file path is correct'
                    'Run Get-FlightRecorderDump to list available dumps'
                ) `
                -Throw
        }

        $header = $null
        $dictionary = @{}
        $events = [System.Collections.Generic.List[object]]::new()

        foreach ($line in [System.IO.File]::ReadLines($DumpPath)) {
            if (-not $line.Trim()) { continue }
            try { $obj = $line | ConvertFrom-Json } catch { continue }

            $recType = if ($obj.PSObject.Properties['_type']) { $obj._type } else { $null }
            switch ($recType) {
                'header' { $header = $obj }
                'dictionary' {
                    if ($obj.PSObject.Properties['entries']) {
                        foreach ($entry in $obj.entries) { $dictionary["$($entry.handle)"] = $entry.value }
                    }
                }
                'event' {
                    $componentName = $obj.component
                    $compKey = "$componentName"
                    if ($dictionary.ContainsKey($compKey)) { $componentName = $dictionary[$compKey] }
                    $obj | Add-Member -NotePropertyName '_resolvedComponent' -NotePropertyValue ([string]$componentName) -Force

                    if ($obj.PSObject.Properties['speaker']) {
                        $spk = $obj.speaker
                        $spkKey = "$spk"
                        if ($dictionary.ContainsKey($spkKey)) { $spk = $dictionary[$spkKey] }
                        $obj | Add-Member -NotePropertyName '_resolvedSpeaker' -NotePropertyValue ([string]$spk) -Force
                    }
                    $events.Add($obj)
                }
            }
        }

        if ($RunId) { $events = @($events | Where-Object { $_.PSObject.Properties['run_id'] -and $_.run_id -eq $RunId }) }

        function script:Get-EventWallIso([object]$Evt) {
            if ($Evt.PSObject.Properties['_wall'] -and $Evt._wall) {
                return [DateTimeOffset]::FromUnixTimeMilliseconds([long]$Evt._wall).UtcDateTime.ToString('o')
            }
            return $null
        }
        function script:Get-EventType([object]$Evt) { if ($Evt.PSObject.Properties['type'] -and $Evt.type) { [string]$Evt.type } else { '' } }
        function script:Get-EventLevel([object]$Evt) { if ($Evt.PSObject.Properties['level'] -and $Evt.level) { [string]$Evt.level } else { 'info' } }
        function script:Get-EventRunId([object]$Evt) { if ($Evt.PSObject.Properties['run_id'] -and $Evt.run_id) { [string]$Evt.run_id } else { '(no run_id)' } }
        function script:Get-EventData([object]$Evt) { if ($Evt.PSObject.Properties['data']) { $Evt.data } else { $null } }

        # ── Runs — first debate.phase event per run_id carrying data.povers ─────────
        $runs = [ordered]@{}
        foreach ($evt in $events) {
            if ((script:Get-EventType $evt) -ne 'debate.phase') { continue }
            $rid = script:Get-EventRunId $evt
            if ($runs.Contains($rid)) { continue }
            $d = script:Get-EventData $evt
            if (-not $d -or -not $d.PSObject.Properties['povers']) { continue }
            $runs[$rid] = [PSCustomObject]@{
                RunId    = $rid
                DebateId = if ($evt.PSObject.Properties['debate_id']) { [string]$evt.debate_id } else { $null }
                Topic    = if ($d.PSObject.Properties['topic']) { [string]$d.topic } else { $null }
                Povers   = @($d.povers)
                Model    = if ($d.PSObject.Properties['model']) { [string]$d.model } else { $null }
                Audience = if ($d.PSObject.Properties['audience']) { [string]$d.audience } else { $null }
            }
        }

        # ── PhaseProgression — ordered distinct data.phase from debate.phase/round ──
        $phaseOrder = [System.Collections.Generic.List[object]]::new()
        $phaseSeen = @{}
        foreach ($evt in $events) {
            $etype = script:Get-EventType $evt
            if ($etype -ne 'debate.phase' -and $etype -ne 'debate.round') { continue }
            $d = script:Get-EventData $evt
            if (-not $d -or -not $d.PSObject.Properties['phase'] -or -not $d.phase) { continue }
            $ph = [string]$d.phase
            if ($phaseSeen.ContainsKey($ph)) { $phaseSeen[$ph].Count++; continue }
            $rec = [PSCustomObject]@{ Phase = $ph; FirstSeq = if ($evt.PSObject.Properties['_seq']) { $evt._seq } else { $null }; Count = 1 }
            $phaseSeen[$ph] = $rec
            $phaseOrder.Add($rec)
        }

        # ── RoundSummary + a running current-round-per-run_id tracker for CommitState ─
        $roundSummary = [System.Collections.Generic.List[object]]::new()
        $currentRound = @{}   # run_id -> last-seen round number
        foreach ($evt in $events) {
            if ((script:Get-EventType $evt) -ne 'debate.round') { continue }
            $d = script:Get-EventData $evt
            if (-not $d -or -not $d.PSObject.Properties['round'] -or $null -eq $d.round) { continue }
            $rid = script:Get-EventRunId $evt
            $currentRound[$rid] = $d.round
            $roundSummary.Add([PSCustomObject]@{
                RunId   = $rid
                Round   = $d.round
                Phase   = if ($d.PSObject.Properties['phase']) { [string]$d.phase } else { $null }
                Speakers = if ($d.PSObject.Properties['speakers']) { @($d.speakers) } else { @() }
                Message = if ($evt.PSObject.Properties['message']) { [string]$evt.message } else { $null }
                Seq     = if ($evt.PSObject.Properties['_seq']) { $evt._seq } else { $null }
            })
        }

        # ── CommitState — debate.moderate / intervention_move=='COMMIT' ─────────────
        $commitGroups = @{}   # "runId|pover" -> accumulator
        foreach ($evt in $events) {
            if ((script:Get-EventType $evt) -ne 'debate.moderate') { continue }
            $d = script:Get-EventData $evt
            if (-not $d -or -not $d.PSObject.Properties['intervention_move'] -or $d.intervention_move -ne 'COMMIT') { continue }
            if (-not $d.PSObject.Properties['responder'] -or -not $d.responder) { continue }
            $rid = script:Get-EventRunId $evt
            $pover = [string]$d.responder
            $key = "$rid|$pover"
            if (-not $commitGroups.ContainsKey($key)) {
                $commitGroups[$key] = [PSCustomObject]@{ RunId = $rid; Pover = $pover; CommitCount = 0; Rounds = [System.Collections.Generic.List[object]]::new(); Seqs = [System.Collections.Generic.List[object]]::new() }
            }
            $g = $commitGroups[$key]
            $g.CommitCount++
            $g.Rounds.Add($(if ($currentRound.ContainsKey($rid)) { $currentRound[$rid] } else { $null }))
            $g.Seqs.Add($(if ($evt.PSObject.Properties['_seq']) { $evt._seq } else { $null }))
        }
        $commitState = @($commitGroups.Values | ForEach-Object {
            [PSCustomObject]@{ RunId = $_.RunId; Pover = $_.Pover; CommitCount = $_.CommitCount; Rounds = @($_.Rounds); Seqs = @($_.Seqs) }
        })

        # ── ClosureAnalysis — DERIVED (no literal closure event exists) ─────────────
        $closureAnalysis = [System.Collections.Generic.List[object]]::new()
        foreach ($rid in $runs.Keys) {
            $allPovers = @($runs[$rid].Povers)
            $committed = @($commitState | Where-Object { $_.RunId -eq $rid } | ForEach-Object { $_.Pover })
            $missing = @($allPovers | Where-Object { $_ -notin $committed })
            $closureAnalysis.Add([PSCustomObject]@{
                RunId         = $rid
                AllCommitted  = ($missing.Count -eq 0)
                MissingPovers = $missing
                Note          = 'Derived from all-povers-committed — no debate.closure/debate.lifecycle event exists in practice to check directly (t/3768#2).'
            })
        }

        # ── Errors / Warnings ────────────────────────────────────────────────────────
        $errorRecords = [System.Collections.Generic.List[object]]::new()
        $warnGroups = @{}
        foreach ($evt in $events) {
            $level = script:Get-EventLevel $evt
            $seq = if ($evt.PSObject.Properties['_seq']) { $evt._seq } else { $null }
            if ($level -eq 'error' -or $level -eq 'fatal') {
                $errorRecords.Add([PSCustomObject]@{
                    Seq          = $seq
                    TimestampUtc = script:Get-EventWallIso $evt
                    RunId        = script:Get-EventRunId $evt
                    Component    = $evt._resolvedComponent
                    Type         = script:Get-EventType $evt
                    Message      = if ($evt.PSObject.Properties['message']) { [string]$evt.message } else { $null }
                    Error        = if ($evt.PSObject.Properties['error']) { $evt.error } else { $null }
                })
            } elseif ($level -eq 'warn') {
                $msg = if ($evt.PSObject.Properties['message']) { [string]$evt.message } else { '(no message)' }
                if (-not $warnGroups.ContainsKey($msg)) {
                    $warnGroups[$msg] = [PSCustomObject]@{ Message = $msg; Count = 0; FirstSeq = $seq; LastSeq = $seq; Types = [System.Collections.Generic.HashSet[string]]::new() }
                }
                $wg = $warnGroups[$msg]
                $wg.Count++
                $wg.LastSeq = $seq
                [void]$wg.Types.Add((script:Get-EventType $evt))
            }
        }
        $warnings = @($warnGroups.Values | ForEach-Object {
            [PSCustomObject]@{ Message = $_.Message; Count = $_.Count; FirstSeq = $_.FirstSeq; LastSeq = $_.LastSeq; Types = @($_.Types) }
        } | Sort-Object Count -Descending)

        # ── SteelmanSummary — best-effort text scan, not a structured field ─────────
        $steelmanHits = [System.Collections.Generic.List[object]]::new()
        foreach ($evt in $events) {
            $d = script:Get-EventData $evt
            if (-not $d) { continue }
            $serialized = $d | ConvertTo-Json -Compress -Depth 10
            if ($serialized -notmatch 'steelman_of|prior_steelmans') { continue }
            $matchInfo = [regex]::Match($serialized, '.{0,40}(steelman_of|prior_steelmans).{0,60}')
            $steelmanHits.Add([PSCustomObject]@{
                Seq     = if ($evt.PSObject.Properties['_seq']) { $evt._seq } else { $null }
                RunId   = script:Get-EventRunId $evt
                Type    = script:Get-EventType $evt
                Snippet = if ($matchInfo.Success) { $matchInfo.Value } else { $null }
            })
        }

        $result = [PSCustomObject]@{
            # PS7 ConvertFrom-Json coerces an ISO-8601 header.timestamp string to [datetime] —
            # [string]-casting that renders a culture-formatted date, not the original ISO text.
            # Round-trip ('o') back to ISO so BuildDate is always parseable/comparable ISO-8601.
            BuildDate        = if ($header -and $header.PSObject.Properties['timestamp']) {
                if ($header.timestamp -is [datetime]) { $header.timestamp.ToString('o') } else { [string]$header.timestamp }
            } else { $null }
            Runs             = @($runs.Values)
            PhaseProgression = @($phaseOrder)
            RoundSummary     = @($roundSummary)
            CommitState      = $commitState
            ClosureAnalysis  = @($closureAnalysis)
            Errors           = @($errorRecords)
            Warnings         = $warnings
            SteelmanSummary  = @($steelmanHits)
        }

        if ($AsObject) { $result } else { _Format-DebateDiagnosis $result }
    }
}

function _Format-DebateDiagnosis {
    param([object]$Result)

    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine("=== Debate Diagnosis ===")
    [void]$sb.AppendLine("Build: $($Result.BuildDate ?? 'n/a')")

    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("--- Runs ($($Result.Runs.Count)) ---")
    foreach ($r in $Result.Runs) {
        [void]$sb.AppendLine("  $($r.RunId): `"$($r.Topic)`" povers=[$($r.Povers -join ', ')] model=$($r.Model)")
    }

    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("--- Phase Progression ---")
    foreach ($p in $Result.PhaseProgression) { [void]$sb.AppendLine("  $($p.Phase): first@seq $($p.FirstSeq), $($p.Count) entries") }

    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("--- Round Summary ($($Result.RoundSummary.Count)) ---")
    foreach ($rd in $Result.RoundSummary) { [void]$sb.AppendLine("  [$($rd.RunId)] round $($rd.Round) ($($rd.Phase)): $($rd.Speakers -join ', ')") }

    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("--- Commit State ---")
    foreach ($c in $Result.CommitState) { [void]$sb.AppendLine("  [$($c.RunId)] $($c.Pover): $($c.CommitCount) COMMIT(s) at round(s) $($c.Rounds -join ', ')") }

    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("--- Closure Analysis ---")
    foreach ($cl in $Result.ClosureAnalysis) {
        $status = if ($cl.AllCommitted) { 'ALL COMMITTED' } else { "MISSING: $($cl.MissingPovers -join ', ')" }
        [void]$sb.AppendLine("  [$($cl.RunId)] $status")
    }

    if ($Result.Errors.Count -gt 0) {
        [void]$sb.AppendLine("")
        [void]$sb.AppendLine("--- Errors ($($Result.Errors.Count)) ---")
        foreach ($e in $Result.Errors) { [void]$sb.AppendLine("  [$($e.TimestampUtc)] $($e.Component)/$($e.Type): $($e.Message)") }
    }

    if ($Result.Warnings.Count -gt 0) {
        [void]$sb.AppendLine("")
        [void]$sb.AppendLine("--- Warnings (deduped, $($Result.Warnings.Count) distinct) ---")
        foreach ($w in $Result.Warnings) { [void]$sb.AppendLine("  x$($w.Count): $($w.Message)") }
    }

    if ($Result.SteelmanSummary.Count -gt 0) {
        [void]$sb.AppendLine("")
        [void]$sb.AppendLine("--- Steelman mentions (best-effort text scan, $($Result.SteelmanSummary.Count) hit(s)) ---")
        foreach ($s in $Result.SteelmanSummary) { [void]$sb.AppendLine("  seq $($s.Seq) [$($s.Type)]: $($s.Snippet)") }
    }

    $sb.ToString()
}
