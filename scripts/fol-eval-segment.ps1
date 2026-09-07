# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    FOL-on-debate eval — clause segmenter (design §4, CL-authoritative rules). PURE, no AI, no I/O.
.DESCRIPTION
    Increment 2a of the offline FOL-on-debate eval harness (t/3354). Implements the rule-based
    clause segmenter from the co-signed design
    (research/comp-linguist/analyses/fol-debate-eval/fol-eval-design.md §4): the unit below the
    turn and below the orthographic sentence is the FINITE CLAUSE — one classification + one
    formalization unit.

    This file defines ONLY pure functions (no top-level side effects), so it is dot-sourced by both
    the runner (run-fol-debate-eval.ps1) and the Pester tests without an execution guard.

    Segmentation is deterministic and offset-preserving: every emitted clause carries stable
    char offsets into the ORIGINAL turn text so the artifacts are double-annotation-ready
    (design §11 — a second annotator upgrades without a re-run).

    §4 rules realized here (heuristic, English surface cues — the AI clause classifier §3 does the
    semantic typing; this stage only cuts):
      2. Split coordinated finite clauses at ", and/but/or/yet ...".
      3. Split at discourse connectives (however / therefore / thus / hence / so / because) and ';'.
      4. The load-bearing rule — a trailing normative/rhetorical CLOSER never inherits the factual
         body it follows: because rule 3 cuts before "so/therefore/…", the closer becomes its own
         clause, typed on its own by the classifier.
      5. Attributed-restatement matrix vs content: "X claims that P" -> the wrapper "X claims that"
         is its own clause (is_attribution_wrapper=$true); the embedded P starts a new clause and is
         the formalization target.
      7. Enumerations: comma+coordinator splitting gives each full-proposition list item its own clause.
      8. Sub-clausal fragments (bare tokens / punctuation-only) attach to nothing and are DROPPED
         (word-count / alphanumeric heuristic; documented limitation — rule-8 NP-attachment is coarse
         here and left to CL's gold-set audit).

    KNOWN LIMITATIONS (honest, for the CL pairing pass): finiteness (rules 1/2/6) and NP-fragment
    detection (rule 8) are approximated by surface cues, not a parser. Boundaries are conservative
    (prefer over-segmentation to lost content); the classifier + blind gold set (§5) are the
    validation instrument that certifies whether these cuts are good enough.
.LINK
    run-fol-debate-eval.ps1
#>

Set-StrictMode -Version Latest

function Split-DebateTurnClauses {
    <#
    .SYNOPSIS
        Segment one debate statement turn into finite clauses (design §4). Pure; deterministic; offset-preserving.
    .PARAMETER Text
        The raw turn content (transcript[].content).
    .PARAMETER DebateId
        Stable debate id (used in the clause id).
    .PARAMETER TurnIndex
        Index of this turn within transcript[] (used in the clause id + source span).
    .OUTPUTS
        A List[object] of clause records, each:
          id                    - "<DebateId>:t<TurnIndex>:c<clause_index>" (stable, double-annotation-ready)
          debate_id, turn_index
          clause_index          - 0-based ordinal within the turn
          text                  - trimmed clause text
          char_start, char_end  - offsets into the ORIGINAL Text (char_end exclusive)
          segmentation_rule     - the §4 rule that opened this clause
          is_attribution_wrapper- $true for the "X claims that" matrix wrapper (design §4 rule 5 / §3.2)
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Generic.List[object]])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Text,

        [Parameter(Mandatory)]
        [string]$DebateId,

        [Parameter(Mandatory)]
        [int]$TurnIndex
    )
    Set-StrictMode -Version Latest

    $clauses = [System.Collections.Generic.List[object]]::new()
    if ([string]::IsNullOrWhiteSpace($Text)) { return $clauses }

    $len = $Text.Length

    # cut index (start of a new segment) -> §4 rule tag. First rule to claim an index wins.
    # Index 0 is intentionally NOT pre-seeded: the rule-5 attribution wrapper can legitimately
    # OPEN the turn (index 0), and must be allowed to tag clause 0 as the wrapper. Index 0 is
    # defaulted to 'sentence-initial' at the end only if no higher-precedence rule claimed it.
    $cuts = @{}
    $addCut = {
        param([int]$Index, [string]$Rule)
        if ($Index -ge 0 -and $Index -lt $len -and -not $cuts.ContainsKey($Index)) { $cuts[$Index] = $Rule }
    }

    # Rule 5 FIRST (attribution wrapper) — the highest-precedence, most specific cut. The wrapper span
    # [start, afterThat) is isolated so the embedded proposition P starts its own clause.
    # Attribution verbs seen in the real debate corpus (t/3354 §3.2 highest-value cell); the trailing
    # "that" complementizer marks where the wrapper ends and the embedded proposition P begins.
    $attrRe = '(?:\b(?:Accelerationist|Safetyist|Skeptic|Coordinator)\b|\b[Tt]he\s+opponent\b|\b(?:[Tt]hey|[Hh]e|[Ss]he)\b)\s+(?:claims?|argues?|proposes?|posits?|contends?|asserts?|maintains?|insists?|says?|states?|holds?|notes?|warns?|observes?|suggests?|emphasi[sz]es?|acknowledges?)\s+that\s+'
    foreach ($m in [regex]::Matches($Text, $attrRe)) {
        & $addCut $m.Index 'attribution-wrapper-start'
        & $addCut ($m.Index + $m.Length) 'attributed-content'
    }

    # Rule 1/implicit — sentence boundary: terminal punctuation + optional closing quote/paren + whitespace.
    foreach ($m in [regex]::Matches($Text, '[.!?]+["'')\]]?\s+')) {
        & $addCut ($m.Index + $m.Length) 'sentence'
    }

    # Rule 3 — semicolon.
    foreach ($m in [regex]::Matches($Text, ';\s+')) {
        & $addCut ($m.Index + $m.Length) 'semicolon-split'
    }

    # Rule 3/4 — discourse connectives; cut BEFORE the connective so a trailing closer stands alone.
    foreach ($m in [regex]::Matches($Text, '(?:,\s+|\s+)(however|therefore|thus|hence|because|so)\s+')) {
        & $addCut $m.Groups[1].Index 'connective-split'
    }

    # Rule 2/7 — coordinated finite clauses / enumerated propositions: cut at the coordinator.
    foreach ($m in [regex]::Matches($Text, ',\s+(and|but|or|yet)\s+')) {
        & $addCut $m.Groups[1].Index 'coordinator-split'
    }

    # Default the turn opening to 'sentence-initial' unless a higher-precedence rule (rule 5) claimed it.
    if (-not $cuts.ContainsKey(0)) { $cuts[0] = 'sentence-initial' }

    $boundaries = @($cuts.Keys | Sort-Object)
    $clauseIndex = 0
    for ($i = 0; $i -lt $boundaries.Count; $i++) {
        $segStart = [int]$boundaries[$i]
        $segEnd = if ($i + 1 -lt $boundaries.Count) { [int]$boundaries[$i + 1] } else { $len }
        $rawLen = $segEnd - $segStart
        if ($rawLen -le 0) { continue }
        $raw = $Text.Substring($segStart, $rawLen)

        # Trim to non-whitespace and carry the adjusted offsets (double-annotation-ready spans).
        $leadWs = $raw.Length - $raw.TrimStart().Length
        $trimmed = $raw.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }

        # Rule 8 — drop sub-clausal fragments: punctuation-only, or a single short token with no
        # internal whitespace (a bare NP / stray connective remnant). Conservative: keep anything
        # that has >=2 tokens or a reasonably long single token.
        $hasAlnum = $trimmed -match '[A-Za-z0-9]'
        $tokenCount = @($trimmed -split '\s+' | Where-Object { $_ -ne '' }).Count
        if (-not $hasAlnum) { continue }
        if ($tokenCount -lt 2 -and $trimmed.Length -lt 4) { continue }

        $charStart = $segStart + $leadWs
        $charEnd = $charStart + $trimmed.Length
        $rule = [string]$cuts[$segStart]

        $clauses.Add([PSCustomObject]@{
                id                     = "${DebateId}:t${TurnIndex}:c${clauseIndex}"
                debate_id              = $DebateId
                turn_index             = $TurnIndex
                clause_index           = $clauseIndex
                text                   = $trimmed
                char_start             = $charStart
                char_end               = $charEnd
                segmentation_rule      = $rule
                is_attribution_wrapper = ($rule -eq 'attribution-wrapper-start')
            })
        $clauseIndex++
    }

    return $clauses
}
