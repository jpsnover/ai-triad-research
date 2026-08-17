# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-PolarityGatePass {
    <#
    .SYNOPSIS
        Polarity/contradiction gate for the summary finalize stage (t/2739 P1).
    .DESCRIPTION
        Runs AFTER Invoke-RetrievalConfidencePass. For each key_point whose claimed
        stance is aligned-family, whose assigned taxonomy_node_id is non-null, and
        whose topical match is in the HIGH band (NOT retrieval_low_confidence), it
        asks the shared directional-agreement engine whether the claim OPPOSES the
        ASSIGNED node's proposition — the residual that similarity + the LLM prompt
        cannot catch (t/2737/t/2738; run-B acc-074 mismap, CL t/2739#1).

        BINDINGS (TL design review t/2739#3):
        1. Consumes the shared Private wrapper Test-DirectionalAgreement (PS2 #1175)
           over the merged engine scripts/nli_classify.py (#1180). This pass does NOT
           frame, call NLI, or threshold — framing is single-sourced in the engine
           (t/2744#3). node_prop is built label + Core with Encompasses:/Excludes:
           tails stripped, IDENTICAL to V1 (Invoke-OrgClaimMatching) per condition #3.
        2. Opposition-only contract (t/2751#2): the engine reliably recovers
           contradiction but rates genuine agreement 'unrelated', not 'entailment'.
           So this fires ONLY on 'opposes'. 'agrees' / 'unrelated' / 'unresolved' all
           KEEP the LLM's mapping. FAIL-SAFE: 'unresolved' KEEPS (never demote) — a
           missed inversion beats a false demote that nukes recall and flakes a
           blocking gate.
        3. Emits per-run counts {opposes, agrees, unrelated, unresolved} over the
           gated key_points — also the silent-degradation detector (all-'unresolved'
           = engine down).

        On 'opposes': sets stance = 'strongly_opposed' (opposed-family) and
        stance_polarity_flag = $true on the key_point — surfaced, never silent. The
        node mapping is preserved (the source disputes THAT node's proposition);
        this is the opposed-family branch of the spec disposition (opposed-family OR
        unmap), chosen over unmap to preserve the node association and avoid
        synthesizing an unmapped_concept post-hoc.
    .PARAMETER KeyPoints
        Array of items shaped @{ KeyPoint = <kp object>; POV = <camp> } (mirrors the
        Mechanism-5 pass collection). Empty is a no-op.
    .PARAMETER DirectionalTauContra
        Contradiction margin floor forwarded to the engine. Default 1.0 (FINAL, the
        engine's τ; CL t/2751#3). Introduces NO new threshold of its own.
    .PARAMETER SkipDirectionalGate
        Bypass the gate entirely (returns zeroed counts, mutates nothing).
    .OUTPUTS
        [hashtable] per-run counts { opposes; agrees; unrelated; unresolved; gated }.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$KeyPoints,

        [Parameter()]
        [ValidateRange(0.0, 1000.0)]
        [double]$DirectionalTauContra = 1.0,

        [Parameter()]
        [switch]$SkipDirectionalGate
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $counts = @{ opposes = 0; agrees = 0; unrelated = 0; unresolved = 0; gated = 0 }
    $items = @($KeyPoints)
    if ($SkipDirectionalGate -or $items.Count -eq 0) { return $counts }

    # ── node_prop lookup: label + Core, Encompasses:/Excludes: tails stripped ──
    # IDENTICAL construction to V1 (Invoke-OrgClaimMatching) — TL GV condition #3.
    $povByPrefix  = @{ acc = 'accelerationist'; saf = 'safetyist'; skp = 'skeptic' }
    $nodeTextById = @{}
    foreach ($pov in $script:TaxonomyData.Values) {
        if (-not $pov.PSObject.Properties['nodes']) { continue }
        foreach ($n in @($pov.nodes)) {
            if (-not $n.PSObject.Properties['id']) { continue }
            $lbl = if ($n.PSObject.Properties['label']) { [string]$n.label } else { '' }
            $dsc = if ($n.PSObject.Properties['description'] -and $n.description) { [string]$n.description } else { '' }
            $dsc = $dsc -replace '(?s)\s*(Encompasses|Excludes)\s*:.*$', ''
            $nodeTextById[[string]$n.id] = if ($dsc) { "$lbl — $($dsc.Trim())" } else { $lbl }
        }
    }

    # ── Select gated key_points ────────────────────────────────────────────────
    # aligned-family stance + non-null assigned node + HIGH topical band.
    $alignedFamily = @('aligned', 'strongly_aligned')
    $gated = [System.Collections.Generic.List[PSObject]]::new()
    foreach ($item in $items) {
        $kp = & { if ($item -is [System.Collections.IDictionary]) { $item['KeyPoint'] } else { $item.KeyPoint } }
        $pov = & { if ($item -is [System.Collections.IDictionary]) { $item['POV'] } else { $item.POV } }
        if ($null -eq $kp) { continue }

        $nodeId = if ($kp.PSObject.Properties['taxonomy_node_id']) { $kp.taxonomy_node_id } else { $null }
        if ([string]::IsNullOrWhiteSpace([string]$nodeId)) { continue }

        $stance = if ($kp.PSObject.Properties['stance']) { [string]$kp.stance } else { '' }
        if ($stance -notin $alignedFamily) { continue }

        # HIGH topical band: reuse the existing retrieval-confidence band — gate only
        # where the assigned node is NOT retrieval_low_confidence (no new threshold).
        $low = if ($kp.PSObject.Properties['retrieval_low_confidence']) { [bool]$kp.retrieval_low_confidence } else { $false }
        if ($low) { continue }

        $gated.Add([PSCustomObject]@{ KeyPoint = $kp; POV = $pov; NodeId = [string]$nodeId })
    }
    $counts.gated = $gated.Count
    if ($gated.Count -eq 0) { return $counts }

    # ── Build directional pairs (claim vs ASSIGNED node) ───────────────────────
    $pairs = [System.Collections.Generic.List[PSObject]]::new()
    for ($i = 0; $i -lt $gated.Count; $i++) {
        $kp = $gated[$i].KeyPoint
        $claimProp = if ($kp.PSObject.Properties['canonical_proposition'] -and $kp.canonical_proposition) {
            [string]$kp.canonical_proposition
        } elseif ($kp.PSObject.Properties['attribution_text'] -and $kp.attribution_text) {
            [string]$kp.attribution_text
        } else { '' }

        $nid      = $gated[$i].NodeId
        $nodeText = if ($nodeTextById.ContainsKey($nid)) { $nodeTextById[$nid] } else { '' }
        $prefix   = if ($nid -match '^(acc|saf|skp)-') { $Matches[1] } else { '' }
        $nodePov  = if ($prefix -and $povByPrefix.ContainsKey($prefix)) { $povByPrefix[$prefix] } else { '' }
        $claimPov = [string]$gated[$i].POV

        $pairs.Add([PSCustomObject]@{
            Id = $i; ClaimProp = $claimProp; NodeProp = $nodeText; ClaimPov = $claimPov; NodePov = $nodePov
        })
    }

    # ── Directional verdicts via the shared wrapper ────────────────────────────
    $verdicts = Test-DirectionalAgreement -Pair @($pairs) -TauContra $DirectionalTauContra
    $byIdx = @{}
    foreach ($v in @($verdicts)) { $byIdx[[int]$v.Id] = $v }

    for ($i = 0; $i -lt $gated.Count; $i++) {
        $kp = $gated[$i].KeyPoint
        $v  = if ($byIdx.ContainsKey($i)) { $byIdx[$i] } else { $null }
        $direction = if ($v) { [string]$v.Direction } else { 'unresolved' }
        if ($counts.ContainsKey($direction)) { $counts[$direction]++ } else { $counts['unresolved']++ }

        if ($direction -eq 'opposes') {
            # Claim asserts ¬(node proposition): surface the inversion + flip to
            # opposed-family. Node mapping preserved (it disputes THAT node).
            $kp | Add-Member -NotePropertyName 'stance'               -NotePropertyValue 'strongly_opposed' -Force
            $kp | Add-Member -NotePropertyName 'stance_polarity_flag' -NotePropertyValue $true              -Force
            $conf = if ($v -and $v.PSObject.Properties['Confidence']) { $v.Confidence } else { 0.0 }
            $kp | Add-Member -NotePropertyName 'stance_polarity_confidence' -NotePropertyValue $conf -Force
        }
        # agrees / unrelated / unresolved → KEEP the LLM's mapping (opposition-only,
        # fail-safe = do not demote).
    }

    return $counts
}
