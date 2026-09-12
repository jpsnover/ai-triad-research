# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    FOL-on-debate eval — clause CLASSIFIER (design §3, CL-authoritative taxonomy). Increment 2b.
.DESCRIPTION
    Types each segmented clause (from fol-eval-segment.ps1) into the closed 5-type taxonomy plus the
    three orthogonal attributes, per the co-signed design §3
    (research/comp-linguist/analyses/fol-debate-eval/fol-eval-design.md). The classifier is a NEW AI
    INSTRUMENT (TL condition 3 / §5): its labels anchor NO conclusion until spot-validated against
    CL's blind gold set (fol-eval-classifier-gold.jsonl). The per-class distribution vs the §3.3 bands
    is a SANITY GATE, not a threshold.

    Structure mirrors invoke-contradiction-classifier.ps1: pure transforms (Format-FolClauseBlock /
    ConvertFrom-FolClauseClassification / Measure-FolClauseDistribution) are dot-source unit-tested with
    NO AI; the single impure call (Invoke-FolClauseClassifier) renders fol-clause-classify.prompt via
    Get-Prompt and calls Invoke-AIByUsage. A clause is NEVER dropped: an unclassifiable clause gets
    primary_type 'unclassified' (method 'missing'), which downstream stages exclude from the FOL subset.

    NOTE: Get-Prompt is a module-PRIVATE helper (Import-Module does not expose it), so the runner
    dot-sources it + sets $script:ModuleRoot before calling Invoke-FolClauseClassifier (same handling
    as invoke-contradiction-classifier.ps1, t/3302). Invoke-AIByUsage IS exported.
.LINK
    fol-eval-segment.ps1
.LINK
    run-fol-debate-eval.ps1
#>

Set-StrictMode -Version Latest

# Closed label sets (design §3). A model label outside these is treated as unclassified (never trusted).
$script:FOL_PRIMARY_TYPES = @('assertoric-factual', 'assertoric-causal', 'normative-deontic', 'speech-act-belief-revision-meta', 'rhetorical-evaluative')
$script:FOL_ATTRIBUTION = @('own', 'attributed-opponent', 'attributed-third-party')
$script:FOL_ANAPHORA = @('self-contained', 'demonstrative', 'topic-ellipsis', 'attributed-restatement')
$script:FOL_POLARITY = @('asserted', 'negated')

# The assertoric subset that reaches FOL extraction (design §2/§7).
$script:FOL_ASSERTORIC_TYPES = @('assertoric-factual', 'assertoric-causal')

# §3.3 distribution sanity bands (fraction lo/hi). SANITY, not thresholds — outside => inspect, not fail.
# speech-act band is widened to 0.30 hi because it rises to ~25-30% in later rounds (design §3.3).
$script:FOL_DISTRIBUTION_BANDS = @{
    'assertoric-factual'              = @(0.20, 0.25)
    'assertoric-causal'               = @(0.35, 0.40)
    'normative-deontic'               = @(0.15, 0.20)
    'speech-act-belief-revision-meta' = @(0.10, 0.30)
    'rhetorical-evaluative'           = @(0.08, 0.12)
}

function Format-FolClauseBlock {
    <#
    .SYNOPSIS
        Render clauses into the prompt's {{clauses_block}}. PS string only (no shell) — text with quotes
        / newlines is safe. Pure; no AI, no I/O.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Clauses)
    Set-StrictMode -Version Latest
    $sb = [System.Text.StringBuilder]::new()
    foreach ($c in $Clauses) {
        [void]$sb.AppendLine("### $([string]$c.id)")
        [void]$sb.AppendLine("TEXT: $([string]$c.text)")
        [void]$sb.AppendLine('')
    }
    return $sb.ToString().TrimEnd()
}

function ConvertFrom-FolClauseClassification {
    <#
    .SYNOPSIS
        Join model classifications (keyed by clause id) back onto the segmented clauses. Pure; no AI, no I/O.
    .DESCRIPTION
        Every input clause is returned exactly once (never dropped). A clause with no valid result gets
        primary_type 'unclassified' + attributes 'unknown' + classify_method 'missing'. The original
        segmentation fields (id/text/spans/rule) are preserved so the artifact stays double-annotation-ready.
    .PARAMETER Clauses
        The segmented clause objects (from Split-DebateTurnClauses).
    .PARAMETER Results
        Validated classification map: id -> @{ primary_type; attribution; anaphora_dependency; polarity; confidence }.
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Clauses,
        [Parameter(Mandatory)][hashtable]$Results
    )
    Set-StrictMode -Version Latest
    $out = [System.Collections.Generic.List[object]]::new()
    foreach ($c in $Clauses) {
        $id = [string]$c.id
        if ($Results.ContainsKey($id)) {
            $r = $Results[$id]
            $primary = [string]$r['primary_type']
            $attribution = [string]$r['attribution']
            $anaphora = [string]$r['anaphora_dependency']
            $polarity = [string]$r['polarity']
            $confidence = [double]$r['confidence']
            $method = 'llm'
            $isAssertoric = $primary -in $script:FOL_ASSERTORIC_TYPES
        }
        else {
            $primary = 'unclassified'; $attribution = 'unknown'; $anaphora = 'unknown'; $polarity = 'unknown'
            $confidence = 0.0; $method = 'missing'; $isAssertoric = $false
        }
        $out.Add([PSCustomObject]@{
                id                  = $id
                debate_id           = $c.debate_id
                turn_index          = $c.turn_index
                clause_index        = $c.clause_index
                text                = $c.text
                char_start          = $c.char_start
                char_end            = $c.char_end
                segmentation_rule   = $c.segmentation_rule
                primary_type        = $primary
                attribution         = $attribution
                anaphora_dependency = $anaphora
                polarity            = $polarity
                is_assertoric       = $isAssertoric
                classify_confidence = $confidence
                classify_method     = $method
            })
    }
    return @($out)
}

function Measure-FolClauseDistribution {
    <#
    .SYNOPSIS
        Per-primary-type distribution + §3.3 band sanity flags. Pure; no AI, no I/O.
    .DESCRIPTION
        Returns a summary: total, per-type count/fraction/within_band, assertoric_total fraction, and
        unclassified count. within_band is the §3.3 SANITY check (outside => inspect the classifier /
        segmenter before trusting labels — NOT a pass/fail gate).
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Classified)
    Set-StrictMode -Version Latest

    $total = @($Classified).Count
    $counts = @{}
    foreach ($t in $script:FOL_PRIMARY_TYPES) { $counts[$t] = 0 }
    $unclassified = 0
    foreach ($c in $Classified) {
        $t = [string]$c.primary_type
        if ($counts.ContainsKey($t)) { $counts[$t]++ } else { $unclassified++ }
    }

    $perType = [System.Collections.Generic.List[object]]::new()
    $assertoricCount = 0
    foreach ($t in $script:FOL_PRIMARY_TYPES) {
        $n = $counts[$t]
        if ($t -in $script:FOL_ASSERTORIC_TYPES) { $assertoricCount += $n }
        $frac = if ($total -gt 0) { [Math]::Round($n / [double]$total, 4) } else { 0.0 }
        $band = $script:FOL_DISTRIBUTION_BANDS[$t]
        $within = if ($band) { ($frac -ge $band[0] -and $frac -le $band[1]) } else { $true }
        $perType.Add([PSCustomObject]@{
                primary_type = $t
                count        = $n
                fraction     = $frac
                band_lo      = if ($band) { $band[0] } else { $null }
                band_hi      = if ($band) { $band[1] } else { $null }
                within_band  = $within
            })
    }

    $assertoricFrac = if ($total -gt 0) { [Math]::Round($assertoricCount / [double]$total, 4) } else { 0.0 }
    return [PSCustomObject]@{
        total                   = $total
        per_type                = @($perType)
        assertoric_count        = $assertoricCount
        assertoric_fraction     = $assertoricFrac
        assertoric_within_band  = ($assertoricFrac -ge 0.55 -and $assertoricFrac -le 0.65)
        unclassified_count      = $unclassified
    }
}

function Invoke-FolClauseClassifier {
    <#
    .SYNOPSIS
        Classify one batch of clauses via the AI backend (design §3). IMPURE — renders the prompt +
        calls Invoke-AIByUsage. Returns a validated map id -> classification, or $null on failure.
    .DESCRIPTION
        Requires the module (Invoke-AIByUsage) loaded and Get-Prompt dot-sourced with $script:ModuleRoot
        set (the runner does this). Only entries whose primary_type + all three attributes are in the
        closed §3 sets survive into the map — an invalid label is a miss (the caller emits 'missing'),
        never a silently-trusted junk label.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param([Parameter(Mandatory)][object[]]$Clauses, [double]$Temperature = 0.0)
    Set-StrictMode -Version Latest
    if (-not $Clauses -or @($Clauses).Count -eq 0) { return @{} }
    try {
        $block = Format-FolClauseBlock -Clauses $Clauses
        $rendered = Get-Prompt -Name 'fol-clause-classify' -Replacements @{ clauses_block = $block }
        $resp = Invoke-AIByUsage -UsageId 'enrichment.fol-clause-classify' `
            -Values @{ prompt = $rendered } -Override @{ temperature = $Temperature } -ErrorAction Stop
        if (-not $resp -or -not $resp.PSObject.Properties['Text'] -or [string]::IsNullOrWhiteSpace($resp.Text)) {
            Write-Warning "fol-clause-classify: backend returned no Text for $(@($Clauses).Count) clause(s) — check the model/key for usage 'enrichment.fol-clause-classify'."
            return $null
        }
        # Tolerant extraction (t/3354#29): gemini-flash-lite returned valid-but-unwrapped JSON (bare array /
        # alt key / fenced) that the old strict `.results` parse rejected, starving the eval. Accept any of
        # those shapes; on genuine failure log a raw snippet so the next contract drift is diagnosable.
        $results = ConvertFrom-FolResultsJson -Text $resp.Text
        if ($null -eq $results) {
            $snip = [string]$resp.Text; if ($snip.Length -gt 200) { $snip = $snip.Substring(0, 200) }
            Write-Warning "fol-clause-classify: could not extract a results[] array from backend Text (first 200 chars): $snip"
            return $null
        }
        $map = @{}
        foreach ($r in @($results)) {
            # Positive guard only (no `continue` inside a function — Pester #2669 escapes to the caller's loop).
            if ($r.PSObject.Properties['id'] -and $r.PSObject.Properties['primary_type']) {
                $pt = [string]$r.primary_type
                $attr = if ($r.PSObject.Properties['attribution']) { [string]$r.attribution } else { '' }
                $ana = if ($r.PSObject.Properties['anaphora_dependency']) { [string]$r.anaphora_dependency } else { '' }
                $pol = if ($r.PSObject.Properties['polarity']) { [string]$r.polarity } else { '' }
                if ($pt -in $script:FOL_PRIMARY_TYPES -and $attr -in $script:FOL_ATTRIBUTION -and
                    $ana -in $script:FOL_ANAPHORA -and $pol -in $script:FOL_POLARITY) {
                    $conf = if ($r.PSObject.Properties['confidence']) { [double]$r.confidence } else { 0.0 }
                    $map[[string]$r.id] = @{
                        primary_type        = $pt
                        attribution         = $attr
                        anaphora_dependency = $ana
                        polarity            = $pol
                        confidence          = [Math]::Round($conf, 4)
                    }
                }
            }
        }
        return $map
    }
    catch {
        # Log the WHY (project rule: log every fallback path + reason). Usually a missing/invalid key or
        # an unregistered model for usage 'enrichment.fol-clause-classify'.
        Write-Warning "fol-clause-classify: model call failed: $($_.Exception.Message)"
        return $null
    }
}

function Invoke-FolClauseClassifyBatched {
    <#
    .SYNOPSIS
        Classify all clauses in fixed-size batches, batch-first with a per-clause fallback for any id the
        batch missed (never drops a clause). Returns the validated map id -> classification.
    .DESCRIPTION
        Mirrors invoke-contradiction-classifier's batch+fallback: an id absent from the batch response is
        re-classified alone; still-missing ids are left out of the map (the join emits them as 'missing').
        IMPURE (calls Invoke-FolClauseClassifier). Separated so the batching policy is one place.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param([Parameter(Mandatory)][object[]]$Clauses, [int]$BatchSize = 15, [double]$Temperature = 0.0)
    Set-StrictMode -Version Latest
    $map = @{}
    $batch = [System.Collections.Generic.List[object]]::new()
    $flush = {
        param($items)
        if (@($items).Count -eq 0) { return }
        $r = Invoke-FolClauseClassifier -Clauses @($items) -Temperature $Temperature
        if ($null -eq $r) {
            # TOTAL batch failure (backend unavailable / non-JSON) — do NOT per-clause-retry the whole
            # batch (that would fire N more doomed calls on e.g. a missing key). Leave these ids missing.
            Write-Warning "fol-clause-classify: batch of $(@($items).Count) clause(s) failed entirely — skipping per-clause fallback (backend unavailable); these clauses emit 'missing'."
            return
        }
        foreach ($k in $r.Keys) { $map[$k] = $r[$k] }
        # Per-clause fallback ONLY for the ids a (partially) successful batch missed.
        foreach ($it in @($items)) {
            $cid = [string]$it.id
            if (-not $map.ContainsKey($cid)) {
                $single = Invoke-FolClauseClassifier -Clauses @($it) -Temperature $Temperature
                if ($null -ne $single -and $single.ContainsKey($cid)) { $map[$cid] = $single[$cid] }
                else { Write-Warning "fol-clause-classify: clause '$cid' unresolved after batch + per-clause fallback — emitting 'missing' (no assertoric membership)." }
            }
        }
    }
    foreach ($c in $Clauses) {
        $batch.Add($c)
        if ($batch.Count -ge $BatchSize) { & $flush $batch; $batch = [System.Collections.Generic.List[object]]::new() }
    }
    & $flush $batch
    return $map
}
