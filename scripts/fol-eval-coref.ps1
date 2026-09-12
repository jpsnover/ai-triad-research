# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    FOL-on-debate eval — COREFERENCE / attribution resolution (design §6, the hard prerequisite). Increment 3.
.DESCRIPTION
    Resolves cross-turn referential dependencies in the ASSERTORIC clause subset so each clause is a
    self-contained proposition before FOL extraction (§7). Per the co-signed design §6, ~40% of assertoric
    clauses carry a demonstrative / topic-ellipsis / attributed-restatement dependency that isolated-turn
    formalization would break — and the most contradiction-relevant sub-class (attributed opponent
    restatements) is also the most anaphora-dependent, so coref gates the whole value case.

    Only assertoric clauses reach this stage. A `self-contained` clause (per the classifier's §3.2
    anaphora_dependency attribute) passes through with NO model call — resolution is needed only for the
    demonstrative / topic-ellipsis / attributed-restatement clauses. Coverage loss (how many assertoric
    clauses stay `partial`/`unresolved`) is REPORTED, keyed on anaphora_dependency (§6). A clause is never
    dropped: an unresolved clause keeps its original text with resolution_status 'unresolved'.

    Structure mirrors fol-eval-classify.ps1: pure transforms (Format-CorefContextBlock /
    Format-CorefClauseBlock / ConvertTo-CorefResolved / Measure-CorefCoverage) are dot-source unit-tested
    with NO AI; the impure calls (Resolve-FolClauseCorefBatch / Invoke-FolCorefResolveDebate) render
    fol-clause-coref.prompt via Get-Prompt and call Invoke-AIByUsage. A total batch failure skips the
    per-clause retry (no call storm on a missing key).

    NOTE: Get-Prompt is module-PRIVATE — the runner dot-sources it + sets $script:ModuleRoot before
    calling the impure functions (same handling as the classifier, t/3302). Invoke-AIByUsage IS exported.
.LINK
    fol-eval-classify.ps1
.LINK
    run-fol-debate-eval.ps1
#>

Set-StrictMode -Version Latest

# Closed resolution-status set (design §6). A model status outside these is treated as 'unresolved'.
$script:FOL_COREF_STATUS = @('self_contained', 'resolved', 'partial', 'unresolved')

# The anaphora_dependency values that need resolution (everything except self-contained).
$script:FOL_ANAPHORA_NEEDS_COREF = @('demonstrative', 'topic-ellipsis', 'attributed-restatement')

# Statuses that leave a clause usable (self-contained enough) for FOL extraction.
$script:FOL_COREF_USABLE = @('self_contained', 'resolved')

function Format-CorefContextBlock {
    <#
    .SYNOPSIS
        Render prior debate statement turns into the prompt's {{context_block}} (earliest first). Pure.
    .DESCRIPTION
        Bounds the context to the last -MaxTurns statements (token guard) — a debate referent is almost
        always introduced within a few turns, and the cap keeps the call cost predictable (design §10 spirit).
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Statements,
        [int]$MaxTurns = 12
    )
    Set-StrictMode -Version Latest
    $ordered = @($Statements | Sort-Object { [int]$_.turn_index })
    if ($ordered.Count -gt $MaxTurns) { $ordered = @($ordered | Select-Object -Last $MaxTurns) }
    $sb = [System.Text.StringBuilder]::new()
    foreach ($s in $ordered) {
        [void]$sb.AppendLine("[turn $([int]$s.turn_index)] $([string]$s.content)")
    }
    return $sb.ToString().TrimEnd()
}

function Format-CorefClauseBlock {
    <#
    .SYNOPSIS
        Render clauses (with their anaphora hint) into the prompt's {{clauses_block}}. Pure.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Clauses)
    Set-StrictMode -Version Latest
    $sb = [System.Text.StringBuilder]::new()
    foreach ($c in $Clauses) {
        $dep = if ($c.PSObject.Properties['anaphora_dependency']) { [string]$c.anaphora_dependency } else { 'unknown' }
        [void]$sb.AppendLine("### $([string]$c.id)  (dependency: $dep)")
        [void]$sb.AppendLine("TEXT: $([string]$c.text)")
        [void]$sb.AppendLine('')
    }
    return $sb.ToString().TrimEnd()
}

function ConvertTo-CorefResolved {
    <#
    .SYNOPSIS
        Join coref resolutions onto the assertoric clauses. Pure; no AI, no I/O. Never drops a clause.
    .DESCRIPTION
        - anaphora_dependency 'self-contained' -> passthrough (resolved_text = text, status 'self_contained').
        - otherwise, from the results map -> resolved_text + status; a clause missing from the map keeps its
          original text with status 'unresolved' (method 'missing').
        Preserves the classification fields so the artifact stays double-annotation-ready (§11).
    .PARAMETER Clauses
        The ASSERTORIC classified clauses (is_assertoric = true).
    .PARAMETER Results
        Resolution map: id -> @{ resolved_text; resolution_status; confidence }.
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
        $dep = if ($c.PSObject.Properties['anaphora_dependency']) { [string]$c.anaphora_dependency } else { 'unknown' }
        if ($dep -eq 'self-contained') {
            $resolvedText = [string]$c.text; $status = 'self_contained'; $conf = 1.0; $method = 'passthrough'
        }
        elseif ($Results.ContainsKey($id)) {
            $r = $Results[$id]
            $resolvedText = [string]$r['resolved_text']; $status = [string]$r['resolution_status']
            $conf = [double]$r['confidence']; $method = 'llm'
        }
        else {
            $resolvedText = [string]$c.text; $status = 'unresolved'; $conf = 0.0; $method = 'missing'
        }
        $usable = $status -in $script:FOL_COREF_USABLE
        $out.Add([PSCustomObject]@{
                id                  = $id
                debate_id           = $c.debate_id
                turn_index          = $c.turn_index
                clause_index        = $c.clause_index
                text                = $c.text
                char_start          = $c.char_start
                char_end            = $c.char_end
                segmentation_rule   = $c.segmentation_rule
                primary_type        = $c.primary_type
                attribution         = $c.attribution
                anaphora_dependency = $dep
                polarity            = $c.polarity
                resolved_text       = $resolvedText
                resolution_status   = $status
                coref_usable        = $usable
                coref_confidence    = $conf
                coref_method        = $method
            })
    }
    return @($out)
}

function Measure-CorefCoverage {
    <#
    .SYNOPSIS
        Coverage-loss metrics over the resolved assertoric clauses, keyed on anaphora_dependency (§6). Pure.
    .DESCRIPTION
        Reports, over the assertoric subset: per-status counts, the usable fraction (self_contained + resolved
        -> reach FOL), the coverage-loss fraction (partial + unresolved), and a per-anaphora_dependency
        breakdown so the attributed-restatement / demonstrative / topic-ellipsis cells are visible (design §6
        central tension). This is a measurement report, not a gate.
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Resolved)
    Set-StrictMode -Version Latest

    $total = @($Resolved).Count
    $statusCounts = @{}
    foreach ($s in $script:FOL_COREF_STATUS) { $statusCounts[$s] = 0 }
    $byDep = @{}
    $usableCount = 0
    foreach ($c in $Resolved) {
        $st = [string]$c.resolution_status
        if ($statusCounts.ContainsKey($st)) { $statusCounts[$st]++ } else { $statusCounts[$st] = 1 }
        if ($st -in $script:FOL_COREF_USABLE) { $usableCount++ }
        $dep = [string]$c.anaphora_dependency
        if (-not $byDep.ContainsKey($dep)) { $byDep[$dep] = [ordered]@{ total = 0; usable = 0 } }
        $byDep[$dep]['total']++
        if ($st -in $script:FOL_COREF_USABLE) { $byDep[$dep]['usable']++ }
    }

    $perDep = [System.Collections.Generic.List[object]]::new()
    foreach ($dep in @($byDep.Keys | Sort-Object)) {
        $t = $byDep[$dep]['total']; $u = $byDep[$dep]['usable']
        $perDep.Add([PSCustomObject]@{
                anaphora_dependency = $dep
                total               = $t
                usable              = $u
                usable_fraction     = if ($t -gt 0) { [Math]::Round($u / [double]$t, 4) } else { 0.0 }
            })
    }

    $usableFrac = if ($total -gt 0) { [Math]::Round($usableCount / [double]$total, 4) } else { 0.0 }
    $lossCount = $total - $usableCount
    return [PSCustomObject]@{
        total                 = $total
        status_counts         = $statusCounts
        usable_count          = $usableCount
        usable_fraction       = $usableFrac
        coverage_loss_count   = $lossCount
        coverage_loss_fraction = if ($total -gt 0) { [Math]::Round($lossCount / [double]$total, 4) } else { 0.0 }
        by_anaphora_dependency = @($perDep)
    }
}

function Resolve-FolClauseCorefBatch {
    <#
    .SYNOPSIS
        Resolve one batch of clauses against a rendered context block via the AI backend (design §6). IMPURE.
    .DESCRIPTION
        Returns a validated map id -> @{ resolved_text; resolution_status; confidence }, or $null on failure.
        Only entries with a resolved_text and a status in the closed §6 set survive — an invalid status is a
        miss (the caller emits 'unresolved'/'missing'), never silently trusted.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)][string]$ContextBlock,
        [Parameter(Mandatory)][object[]]$Clauses,
        [double]$Temperature = 0.0
    )
    Set-StrictMode -Version Latest
    if (-not $Clauses -or @($Clauses).Count -eq 0) { return @{} }
    try {
        $clauseBlock = Format-CorefClauseBlock -Clauses $Clauses
        $rendered = Get-Prompt -Name 'fol-clause-coref' -Replacements @{ context_block = $ContextBlock; clauses_block = $clauseBlock }
        $resp = Invoke-AIByUsage -UsageId 'enrichment.fol-clause-coref' `
            -Values @{ prompt = $rendered } -Override @{ temperature = $Temperature } -ErrorAction Stop
        if (-not $resp -or -not $resp.PSObject.Properties['Text'] -or [string]::IsNullOrWhiteSpace($resp.Text)) {
            Write-Warning "fol-clause-coref: backend returned no Text for $(@($Clauses).Count) clause(s) — check the model/key for usage 'enrichment.fol-clause-coref'."
            return $null
        }
        # Tolerant extraction (t/3354#29) — same contract-drift hardening as the classifier: accept a bare
        # array / alt-keyed object / fenced body; on genuine failure log a raw snippet for diagnosability.
        $results = ConvertFrom-FolResultsJson -Text $resp.Text
        if ($null -eq $results) {
            $snip = [string]$resp.Text; if ($snip.Length -gt 200) { $snip = $snip.Substring(0, 200) }
            Write-Warning "fol-clause-coref: could not extract a results[] array from backend Text (first 200 chars): $snip"
            return $null
        }
        $map = @{}
        foreach ($r in @($results)) {
            # Positive guard only (no `continue` inside a function — Pester #2669 escapes to the caller's loop).
            if ($r.PSObject.Properties['id'] -and $r.PSObject.Properties['resolution_status'] -and $r.PSObject.Properties['resolved_text']) {
                $st = [string]$r.resolution_status
                $txt = [string]$r.resolved_text
                if ($st -in $script:FOL_COREF_STATUS -and -not [string]::IsNullOrWhiteSpace($txt)) {
                    $conf = if ($r.PSObject.Properties['confidence']) { [double]$r.confidence } else { 0.0 }
                    $map[[string]$r.id] = @{ resolved_text = $txt; resolution_status = $st; confidence = [Math]::Round($conf, 4) }
                }
            }
        }
        return $map
    }
    catch {
        # Log the WHY (project rule: log every fallback path + reason). Usually a missing/invalid key or an
        # unregistered model for usage 'enrichment.fol-clause-coref'.
        Write-Warning "fol-clause-coref: model call failed: $($_.Exception.Message)"
        return $null
    }
}

function Invoke-FolCorefResolveDebate {
    <#
    .SYNOPSIS
        Resolve one debate's non-self-contained assertoric clauses against that debate's context. IMPURE.
    .DESCRIPTION
        Renders the shared context once (bounded by -MaxContextTurns), then batches the clauses (batch-first,
        per-clause fallback for misses; a total batch failure skips the per-clause retry). Returns the map
        id -> resolution for this debate's clauses. Self-contained clauses are NOT passed here (the join
        passes them through with no call).
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$ContextStatements,
        [Parameter(Mandatory)][object[]]$Clauses,
        [int]$BatchSize = 10,
        [int]$MaxContextTurns = 12,
        [double]$Temperature = 0.0
    )
    Set-StrictMode -Version Latest
    $map = @{}
    if (-not $Clauses -or @($Clauses).Count -eq 0) { return $map }
    $contextBlock = Format-CorefContextBlock -Statements @($ContextStatements) -MaxTurns $MaxContextTurns

    $batch = [System.Collections.Generic.List[object]]::new()
    $flush = {
        param($items)
        if (@($items).Count -eq 0) { return }
        $r = Resolve-FolClauseCorefBatch -ContextBlock $contextBlock -Clauses @($items) -Temperature $Temperature
        if ($null -eq $r) {
            Write-Warning "fol-clause-coref: batch of $(@($items).Count) clause(s) failed entirely — skipping per-clause fallback (backend unavailable); these clauses emit 'unresolved'."
            return
        }
        foreach ($k in $r.Keys) { $map[$k] = $r[$k] }
        foreach ($it in @($items)) {
            $cid = [string]$it.id
            if (-not $map.ContainsKey($cid)) {
                $single = Resolve-FolClauseCorefBatch -ContextBlock $contextBlock -Clauses @($it) -Temperature $Temperature
                if ($null -ne $single -and $single.ContainsKey($cid)) { $map[$cid] = $single[$cid] }
                else { Write-Warning "fol-clause-coref: clause '$cid' unresolved after batch + per-clause fallback — emitting 'unresolved'." }
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
