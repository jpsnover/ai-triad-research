# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Set-SituationBdiInterpretation {
    <#
    .SYNOPSIS
        Populate a situation node's per-POV BDI interpretations at creation time.
    .DESCRIPTION
        Write-time enforcement of the situation BDI-decomposition invariant (t/2332,
        TL decision t/2324#1). New cross-cutting (situation) nodes are otherwise minted
        with empty interpretations (Invoke-ProposalApply) and only caught later by the
        scheduled compliance trip-wire (tests/data-compliance/) — the mechanism behind
        the sit-448..470 (t/1805) and sit-471..475 (t/2323) regressions.

        Calls the CL-owned UsageID 'enrichment.situation-bdi-decomposition' (reused, not
        forked) with a flash-lite backend fallback so a transient failure on the primary
        model does not block the pipeline. On SUCCESS it mutates $Node.interpretations in
        place to the per-POV {belief, desire, intention, summary} shape.

        FAIL-CLOSED (TL, t/2332#4): unlike the cosmetic aphorism (Set-NodeAphorism, which
        is fail-open), BDI decomposition is the load-bearing invariant this gate exists
        for. On persistent failure — AI error after fallback, empty/invalid response, or
        an incomplete decomposition (any POV missing a non-empty belief/desire/intention)
        — this throws an ActionableError. The caller rejects that single proposal (per-node
        skip; proposals are additive) rather than committing a non-compliant node.
    .PARAMETER Node
        The situation node object to enrich in place. Must expose .id, .label,
        .description, and a settable .interpretations property.
    .OUTPUTS
        None. Mutates $Node.interpretations on success; throws on failure.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [psobject]$Node
    )

    Set-StrictMode -Version Latest

    $sitId = [string]$Node.id
    $label = if ($Node.PSObject.Properties['label']) { [string]$Node.label } else { '' }
    $desc  = if ($Node.PSObject.Properties['description']) { [string]$Node.description } else { '' }

    # Render the existing per-POV interpretations (empty at mint, or legacy flat text)
    # as anchor context for the decomposition.
    $existingLines = foreach ($pov in 'accelerationist', 'safetyist', 'skeptic') {
        $val = ''
        if ($Node.PSObject.Properties['interpretations'] -and $Node.interpretations -and
            $Node.interpretations.PSObject.Properties[$pov]) {
            $raw = $Node.interpretations.$pov
            if ($raw -is [string]) { $val = $raw }
            elseif ($raw -and $raw.PSObject.Properties['summary']) { $val = [string]$raw.summary }
        }
        if ([string]::IsNullOrWhiteSpace($val)) { "${pov}: (none)" } else { "${pov}: $val" }
    }
    $existing = $existingLines -join "`n"

    $fail = {
        param($Problem)
        throw (New-ActionableError -PassThru `
            -Goal "Decompose situation '$sitId' into per-POV BDI interpretations at creation" `
            -Problem $Problem `
            -Location 'Set-SituationBdiInterpretation' `
            -NextSteps @(
                "The situation proposal was skipped fail-closed so a non-decomposed node is not committed (t/2332).",
                "Re-run the proposal apply once the AI backend recovers, or run enrichment.situation-bdi-decomposition on '$sitId' manually via Invoke-AIByUsage.",
                'If this recurs, check AI backend availability and the gemini-3.5-flash-lite fallback key.'
            ))
    }

    try {
        $result = Invoke-AIByUsage -UsageId 'enrichment.situation-bdi-decomposition' `
            -Values @{
                situation_id             = $sitId
                label                    = $label
                description              = $desc
                existing_interpretations = $existing
            } `
            -FallbackModels 'gemini-3.5-flash-lite'
    }
    catch {
        & $fail "AI enrichment failed after backend fallback: $($_.Exception.Message)"
    }

    if (-not $result -or -not $result.Text) {
        & $fail 'AI enrichment returned an empty response.'
    }

    # Strip ```json fences (mirrors Repair-PovLineage parse pattern) then parse.
    $clean = [string]$result.Text -replace '^\s*```json\s*', '' -replace '\s*```\s*$', ''
    try {
        $bdi = $clean | ConvertFrom-Json
    }
    catch {
        & $fail "AI response was not valid JSON: $($_.Exception.Message)"
    }

    # Validate + build the compliant interpretations block. Every POV must carry a
    # non-empty belief + desire + intention (the exact predicate the gate enforces).
    $newInterps = [ordered]@{}
    foreach ($pov in 'accelerationist', 'safetyist', 'skeptic') {
        if (-not $bdi.PSObject.Properties[$pov] -or -not $bdi.$pov) {
            & $fail "Decomposition is missing the '$pov' POV."
        }
        $p = $bdi.$pov
        $belief    = if ($p.PSObject.Properties['belief'])    { [string]$p.belief }    else { '' }
        $desire    = if ($p.PSObject.Properties['desire'])    { [string]$p.desire }    else { '' }
        $intention = if ($p.PSObject.Properties['intention']) { [string]$p.intention } else { '' }
        $summary   = if ($p.PSObject.Properties['summary'])   { [string]$p.summary }   else { '' }
        if (-not $belief.Trim() -or -not $desire.Trim() -or -not $intention.Trim()) {
            & $fail "POV '$pov' is missing a non-empty belief, desire, or intention."
        }
        $newInterps[$pov] = [pscustomobject][ordered]@{
            belief    = $belief
            desire    = $desire
            intention = $intention
            summary   = $summary
        }
    }

    $Node.interpretations = [pscustomobject]$newInterps
}
