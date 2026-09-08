# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    FOL-on-debate eval — FOL EXTRACTION (design §7). Increment 4. Reuses LogicalFormPass core, NO fork.
.DESCRIPTION
    Formalizes the RESOLVED, usable assertoric clause subset (from fol-eval-coref.ps1) into neo-Davidsonian
    first-order logical forms — the SAME instrument the summary FOL corpus uses, so the §8 cross-corpus
    contradiction check is apples-to-apples (design §7, TL condition: no fork).

    Reuse (no fork): each clause's resolved_text is formalized through the identical path
    Invoke-LogicalFormPass uses for a summary claim —
      Get-Prompt 'logical-form-formalization'  ->  Invoke-AIByUsage 'enrichment.logical-form-formalization'
      ->  ConvertTo-GroundedLogicalForm  ->  Test-LogicalFormStructure.
    The grounding/validation helpers (ConvertTo-GroundedLogicalForm / Test-LogicalFormStructure /
    Get-LogicalFormRefTable / ConvertTo-EntityRefsPromptJson) are module-PRIVATE, so they are reached
    through the AITriad module session state (`& $Module { ... }`) — the same reliable mechanism the
    runner uses for the data-root helpers, NOT a reimplementation.

    Debate clauses carry NO entity_refs[], so the ref table is empty and every participant becomes a
    lit:"…" (the -IncludeUngrounded case). Clauses are formalized as CLAIM_CATEGORY 'factual' with an
    empty CAMP (modality:null) — the clause's own attribution/camp is kept as clause metadata, NOT baked
    into modality, so a debate logical_form is shape-identical to a summary factual_claim logical_form
    (the apples-to-apples requirement). Genericity/value-load of an assertoric-causal generic is carried
    by the predicate + polarity the model emits, exactly as for summary causal claims.

    Only coref-USABLE clauses (self_contained | resolved) are formalized; partial/unresolved clauses are
    excluded (fol_status 'skipped-unresolved') — formalizing an under-specified clause would inject noise
    into §8. A clause is never dropped from the record: every assertoric clause appears in the output with
    a fol_status. An invalid/failed formalization is recorded (status), never a fabricated logical_form.
.LINK
    fol-eval-coref.ps1
.LINK
    run-fol-debate-eval.ps1
#>

Set-StrictMode -Version Latest

# Extraction outcome for a clause that was ATTEMPTED (usable). Join adds 'skipped-unresolved' / 'missing'.
$script:FOL_EXTRACT_STATUS = @('formalized', 'invalid', 'failed')

function Invoke-FolClauseFormalize {
    <#
    .SYNOPSIS
        Formalize ONE resolved clause proposition into a grounded logical form, reusing the LogicalFormPass
        core via the AITriad module session state (design §7, no fork). IMPURE.
    .DESCRIPTION
        Renders the shared logical-form-formalization prompt (CLAIM_CATEGORY 'factual', empty CAMP, empty
        ENTITY_REFS), calls enrichment.logical-form-formalization, then grounds + validates through the
        module-private helpers. Returns @{ status; logical_form?; reason? }:
          status 'formalized' -> logical_form present (validated);
          status 'invalid'    -> the model form failed Test-LogicalFormStructure (reason set), no form;
          status 'failed'     -> no/empty/unparseable model output (reason set), no form.
    .PARAMETER Module
        The imported AITriad module (Get-Module AITriad) — session state for the private grounders.
    .PARAMETER Text
        The resolved, self-contained clause proposition to formalize.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)][System.Management.Automation.PSModuleInfo]$Module,
        [Parameter(Mandatory)][string]$Text,
        [double]$Temperature = 0.1
    )
    Set-StrictMode -Version Latest

    # Empty ref table (debate clauses have no entity_refs) -> ENTITY_REFS "[]"; every arg becomes a lit:.
    $refsJson = & $Module { ConvertTo-EntityRefsPromptJson -RefTable @() }

    $rendered = Get-Prompt -Name 'logical-form-formalization' -Replacements @{
        CLAIM_CATEGORY = 'factual'
        CAMP           = ''
        PROPOSITION    = $Text
        ENTITY_REFS    = $refsJson
    }

    try {
        $ai = Invoke-AIByUsage -UsageId 'enrichment.logical-form-formalization' `
            -Values @{ prompt = $rendered } -Override @{ temperature = $Temperature } -ErrorAction Stop
    }
    catch {
        # Fallback-path logging (docs/error-handling.md): usually a missing/invalid key or unregistered model.
        Write-Warning "fol-extract: model call failed: $($_.Exception.Message)"
        return @{ status = 'failed'; reason = $_.Exception.Message }
    }
    if ($null -eq $ai -or -not $ai.PSObject.Properties['Text'] -or [string]::IsNullOrWhiteSpace($ai.Text)) {
        Write-Warning 'fol-extract: empty model response.'
        return @{ status = 'failed'; reason = 'empty model response' }
    }

    # Defensive fence-strip + parse (prompt says raw JSON, but models sometimes fence) — same as LogicalFormPass.
    $body = [string]$ai.Text
    $body = $body -replace '^\s*```(json)?\s*', ''
    $body = $body -replace '\s*```\s*$', ''
    try { $raw = $body.Trim() | ConvertFrom-Json -ErrorAction Stop }
    catch {
        Write-Warning "fol-extract: unparseable model JSON: $($_.Exception.Message)"
        return @{ status = 'failed'; reason = "unparseable JSON: $($_.Exception.Message)" }
    }

    # Ground + validate through the module-private core (no fork).
    $lf = & $Module { param($r) ConvertTo-GroundedLogicalForm -Raw $r -RefTable @() -Category 'factual' -Camp '' } $raw
    $check = & $Module { param($l) Test-LogicalFormStructure -LogicalForm $l -Category 'factual' } $lf
    if (-not $check.Ok) {
        return @{ status = 'invalid'; reason = [string]$check.Reason }
    }
    return @{ status = 'formalized'; logical_form = $lf }
}

function Invoke-FolClauseExtraction {
    <#
    .SYNOPSIS
        Formalize every coref-usable clause in turn, returning the map id -> @{ status; logical_form?; reason? }.
        IMPURE (one model call per usable clause; FOL formalization is per-proposition, not batched).
    .DESCRIPTION
        Bounded by the caller's clause selection (the run cap). A failed/invalid clause is recorded, never
        retried in a storm. Self-contained + resolved clauses are the input; partial/unresolved are excluded
        upstream by the caller (they carry fol_status 'skipped-unresolved' in the join).
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)][System.Management.Automation.PSModuleInfo]$Module,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Clauses,
        [double]$Temperature = 0.1
    )
    Set-StrictMode -Version Latest
    $map = @{}
    foreach ($c in $Clauses) {
        $txt = if ($c.PSObject.Properties['resolved_text'] -and $c.resolved_text) { [string]$c.resolved_text } else { [string]$c.text }
        $map[[string]$c.id] = Invoke-FolClauseFormalize -Module $Module -Text $txt -Temperature $Temperature
    }
    return $map
}

function ConvertTo-FolClauseFormalized {
    <#
    .SYNOPSIS
        Join FOL extraction results onto the resolved assertoric clauses. Pure; no AI, no I/O. Never drops.
    .DESCRIPTION
        Every resolved clause appears once with a fol_status:
          - coref-unusable (partial/unresolved)     -> 'skipped-unresolved' (not formalized, no logical_form)
          - usable + result 'formalized'            -> 'formalized' + logical_form attached
          - usable + result 'invalid'/'failed'      -> that status + fol_reason (no logical_form)
          - usable but absent from the map          -> 'missing'
        Preserves the resolved-clause fields (double-annotation-ready, §11).
    .PARAMETER Clauses
        The resolved assertoric clauses (from ConvertTo-CorefResolved).
    .PARAMETER Results
        Extraction map id -> @{ status; logical_form?; reason? } for the clauses that were attempted.
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
        $usable = ($c.PSObject.Properties['coref_usable'] -and $c.coref_usable)
        $logicalForm = $null
        $reason = ''
        if (-not $usable) {
            $status = 'skipped-unresolved'
        }
        elseif ($Results.ContainsKey($id)) {
            $r = $Results[$id]
            $status = [string]$r['status']
            if ($status -eq 'formalized' -and $r.ContainsKey('logical_form')) { $logicalForm = $r['logical_form'] }
            if ($r.ContainsKey('reason')) { $reason = [string]$r['reason'] }
        }
        else {
            $status = 'missing'
        }
        $out.Add([PSCustomObject]@{
                id                  = $id
                debate_id           = $c.debate_id
                turn_index          = $c.turn_index
                clause_index        = $c.clause_index
                text                = $c.text
                resolved_text       = $c.resolved_text
                char_start          = $c.char_start
                char_end            = $c.char_end
                primary_type        = $c.primary_type
                attribution         = $c.attribution
                anaphora_dependency = $c.anaphora_dependency
                polarity            = $c.polarity
                resolution_status   = $c.resolution_status
                fol_status          = $status
                fol_reason          = $reason
                logical_form        = $logicalForm
            })
    }
    return @($out)
}

function Measure-FolExtraction {
    <#
    .SYNOPSIS
        Extraction outcome counts over the formalized assertoric clauses. Pure; no AI, no I/O.
    .DESCRIPTION
        Reports total, per-fol_status counts, and the formalized fraction over the ATTEMPTED (usable) set
        — a measurement report, not a gate. skipped-unresolved clauses are excluded from the attempted
        denominator (they were never sent to FOL).
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Formalized)
    Set-StrictMode -Version Latest

    $counts = @{}
    foreach ($c in $Formalized) {
        $st = [string]$c.fol_status
        if ($counts.ContainsKey($st)) { $counts[$st]++ } else { $counts[$st] = 1 }
    }
    # NB: local names must NOT collide (case-insensitively) with the typed [object[]]$Formalized param —
    # assigning an int to such a name would coerce it back into a 1-element array (op_Division trap).
    $total = @($Formalized).Count
    $formalizedN = if ($counts.ContainsKey('formalized')) { [int]$counts['formalized'] } else { 0 }
    $skippedN = if ($counts.ContainsKey('skipped-unresolved')) { [int]$counts['skipped-unresolved'] } else { 0 }
    $attempted = $total - $skippedN
    return [PSCustomObject]@{
        total                = $total
        attempted            = $attempted
        formalized_count     = $formalizedN
        status_counts        = $counts
        formalized_fraction  = if ($attempted -gt 0) { [Math]::Round($formalizedN / [double]$attempted, 4) } else { 0.0 }
    }
}
