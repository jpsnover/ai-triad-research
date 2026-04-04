# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# FIRE — Confidence-gated iterative claim extraction.
# Dot-sourced by AITriad.psm1 — do NOT export.

function Invoke-IterativeExtraction {
    <#
    .SYNOPSIS
        FIRE iterative claim extraction with confidence gating and termination guardrails.
    .DESCRIPTION
        Replaces single-shot summarization with a per-claim confidence-gated loop.
        Each claim is assessed for confidence; uncertain claims trigger targeted
        follow-up queries to accumulate evidence. Early termination via Sentence-BERT
        similarity or hard caps.

        Mandatory termination guardrails (SRE e/16#4):
        - Max 5 iterations per claim
        - Max 20 iterations per document
        - Max wall-clock 5 minutes per document
        - Total API call budget per invocation

        FIRE confidence != QBAF base_strength (Risk Assessor e/16#5).
        These are separate fields: extraction reliability vs argument quality.
    .PARAMETER Prompt
        The full extraction prompt (system + taxonomy + document).
    .PARAMETER Model
        AI model identifier.
    .PARAMETER ApiKey
        AI API key.
    .PARAMETER Temperature
        Sampling temperature.
    .PARAMETER MaxIterPerClaim
        Maximum iterations per uncertain claim. Default: 5.
    .PARAMETER MaxIterPerDoc
        Maximum total iterations per document. Default: 20.
    .PARAMETER WallClockSeconds
        Maximum wall-clock time per document. Default: 300 (5 minutes).
    .PARAMETER MaxApiCalls
        Maximum total API calls per invocation. Default: 25.
    .PARAMETER ConfidenceThreshold
        Minimum confidence to accept a claim without iteration. Default: 0.7.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Prompt,

        [Parameter(Mandatory)]
        [string]$Model,

        [Parameter(Mandatory)]
        [string]$ApiKey,

        [double]$Temperature = 0.1,

        [int]$MaxIterPerClaim = 5,

        [int]$MaxIterPerDoc = 20,

        [int]$WallClockSeconds = 60,

        [int]$MaxApiCalls = 25,

        [double]$ConfidenceThreshold = 0.7
    )

    Set-StrictMode -Version Latest

    $Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $TotalIter = 0
    $TotalApiCalls = 0

    # ── Phase 1: Initial extraction (same as single-shot) ─────────────────────
    Write-Verbose "FIRE Phase 1: Initial extraction"
    Write-Verbose "  Model: $Model | Temperature: $Temperature | MaxTokens: 32768"
    Write-Verbose "  Guardrails: max $MaxIterPerClaim iter/claim, $MaxIterPerDoc iter/doc, ${WallClockSeconds}s wall-clock, $MaxApiCalls API calls"
    Write-Verbose "  Confidence threshold: $ConfidenceThreshold"
    $TotalApiCalls++
    Write-Verbose "  API call #$TotalApiCalls — initial extraction starting..."

    $InitialResult = Invoke-AIApi `
        -Prompt      $Prompt `
        -Model       $Model `
        -ApiKey      $ApiKey `
        -Temperature $Temperature `
        -MaxTokens   32768 `
        -JsonMode `
        -TimeoutSec  300

    if ($null -eq $InitialResult) {
        New-ActionableError -Goal 'FIRE initial extraction' `
            -Problem 'AI API returned null' `
            -Location 'Invoke-IterativeExtraction' `
            -NextSteps @('Check API key', 'Verify model availability') -Throw
    }

    Write-Verbose "  Phase 1 complete — $($InitialResult.Backend) responded in $([Math]::Round($Stopwatch.Elapsed.TotalSeconds, 1))s"

    $CleanedText = $InitialResult.Text -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
    $Summary = $null
    try {
        $Summary = $CleanedText.Trim() | ConvertFrom-Json -Depth 20
    }
    catch {
        Write-Verbose "  Phase 1 FAILED — JSON parse error: $($_.Exception.Message)"
        # Return raw result for caller to handle parse failure
        return @{
            Summary    = $null
            RawText    = $InitialResult.Text
            Backend    = $InitialResult.Backend
            FireStats  = @{
                mode = 'fire'; phase1_only = $true; parse_failed = $true
                total_iterations = 0; total_api_calls = 1
                elapsed_seconds = [Math]::Round($Stopwatch.Elapsed.TotalSeconds, 1)
            }
        }
    }

    # ── Phase 2-3: Assess confidence and iterate on uncertain claims ────────
    if (-not $Summary.factual_claims) {
        Write-Verbose "  No factual_claims in response — nothing to iterate on"
        # No claims to iterate on — return as-is
        return @{
            Summary   = $Summary
            RawText   = $InitialResult.Text
            Backend   = $InitialResult.Backend
            FireStats = @{
                mode = 'fire'; total_iterations = 0; total_api_calls = 1
                claims_confident = 0; claims_iterated = 0; claims_total = 0
                elapsed_seconds = [Math]::Round($Stopwatch.Elapsed.TotalSeconds, 1)
                termination_reason = 'no_claims'
            }
        }
    }

    $Claims = @($Summary.factual_claims)
    $ClaimsConfident = 0
    $ClaimsIterated = 0
    $ClaimsExhausted = 0
    $TerminationReason = 'all_confident'

    Write-Verbose "FIRE Phase 2-3: Assessing $($Claims.Count) claims..."

    # Compute column alignment from the longest claim label
    # Layout: "FIRE: <label>" padded, then confidence + status
    $LabelMaxLen = 0
    foreach ($c in $Claims) {
        $lbl = if ($c.PSObject.Properties['claim_label']) { $c.claim_label } else { 'claim-?' }
        if ($lbl.Length -gt $LabelMaxLen) { $LabelMaxLen = $lbl.Length }
    }
    # "FIRE: " (6) + label + padding (2)
    $ConfColumn = 6 + $LabelMaxLen + 2
    $Indent = ' ' * 6   # Align sub-lines under "FIRE: "

    # ── Phase 3: Assess and iterate on uncertain claims ───────────────────────
    for ($i = 0; $i -lt $Claims.Count; $i++) {
        $Claim = $Claims[$i]

        # Check termination guardrails
        if ($Stopwatch.Elapsed.TotalSeconds -ge $WallClockSeconds) {
            $TerminationReason = "wall_clock_exceeded ($WallClockSeconds s)"
            Write-Verbose "FIRE: GUARDRAIL — wall-clock ${WallClockSeconds}s reached ($i/$($Claims.Count) claims processed)"
            break
        }
        if ($TotalIter -ge $MaxIterPerDoc) {
            $TerminationReason = "max_doc_iterations ($MaxIterPerDoc)"
            Write-Verbose "FIRE: GUARDRAIL — doc iteration limit $MaxIterPerDoc reached ($i/$($Claims.Count) claims processed)"
            break
        }
        if ($TotalApiCalls -ge $MaxApiCalls) {
            $TerminationReason = "api_budget_exceeded ($MaxApiCalls)"
            Write-Verbose "FIRE: GUARDRAIL — API call budget $MaxApiCalls reached ($i/$($Claims.Count) claims processed)"
            break
        }

        $ClaimLabel = if ($Claim.PSObject.Properties['claim_label']) { $Claim.claim_label } else { "claim-$i" }
        $ClaimText = if ($Claim.PSObject.Properties['claim']) { $Claim.claim } else { '' }
        $ClaimShort = if ($ClaimText.Length -gt 70) { $ClaimText.Substring(0, 70) + '...' } else { $ClaimText }

        # Extract evidence_criteria if present to estimate confidence
        $Confidence = 0.5  # Default: uncertain
        if ($Claim.PSObject.Properties['evidence_criteria']) {
            $EC = $Claim.evidence_criteria
            $Conf = 0.3
            if ($EC.PSObject.Properties['specificity'] -and $EC.specificity -eq 'precise') { $Conf += 0.2 }
            if ($EC.PSObject.Properties['has_warrant'] -and $EC.has_warrant) { $Conf += 0.2 }
            if ($EC.PSObject.Properties['internally_consistent'] -and $EC.internally_consistent) { $Conf += 0.1 }
            $Confidence = $Conf
        }

        # Set fire_confidence
        if (-not $Claim.PSObject.Properties['fire_confidence']) {
            $Claim | Add-Member -NotePropertyName 'fire_confidence' -NotePropertyValue $Confidence -Force
        }
        else {
            $Claim.fire_confidence = $Confidence
        }

        # Main claim line: "FIRE: <label>          <conf> <status>"
        $LabelPadded = "FIRE: $ClaimLabel".PadRight($ConfColumn)
        $ConfStr = "$([Math]::Round($Confidence, 2))".PadLeft(4)

        if ($Confidence -ge $ConfidenceThreshold) {
            $ClaimsConfident++
            Write-Verbose "${LabelPadded}${ConfStr} `u{2713}"
            continue
        }

        # ── Uncertain claim: iterate ──────────────────────────────────────
        Write-Verbose "${LabelPadded}${ConfStr} `u{2192} iterating"
        Write-Verbose "${Indent}`"$ClaimShort`""
        $ClaimIter = 0
        $OriginalText = $ClaimText

        while ($Confidence -lt $ConfidenceThreshold -and $ClaimIter -lt $MaxIterPerClaim) {
            if ($Stopwatch.Elapsed.TotalSeconds -ge $WallClockSeconds) { $TerminationReason = 'wall_clock_exceeded'; Write-Verbose "${Indent}GUARDRAIL — wall-clock in iteration loop"; break }
            if ($TotalIter -ge $MaxIterPerDoc) { $TerminationReason = 'max_doc_iterations'; Write-Verbose "${Indent}GUARDRAIL — doc iterations in iteration loop"; break }
            if ($TotalApiCalls -ge $MaxApiCalls) { $TerminationReason = 'api_budget_exceeded'; Write-Verbose "${Indent}GUARDRAIL — API budget in iteration loop"; break }

            $ClaimIter++
            $TotalIter++
            $TotalApiCalls++
            $BeforeConf = $Confidence

            $RefinementPrompt = @"
The following factual claim was extracted but has low confidence ($([Math]::Round($Confidence, 2))).
Please provide additional evidence assessment:

Claim: "$ClaimText"
Label: $ClaimLabel

Assess:
1. Is this claim actually stated in the source document, or was it inferred?
2. What specific text in the document supports this claim?
3. Re-evaluate the evidence_criteria: specificity (vague/qualified/precise), has_warrant (true/false), internally_consistent (true/false)

Return JSON: {"claim_label": "$ClaimLabel", "verified": true/false, "refined_claim": "...", "evidence_criteria": {...}, "confidence": 0.0-1.0}
"@

            try {
                $RefResult = Invoke-AIApi `
                    -Prompt      $RefinementPrompt `
                    -Model       $Model `
                    -ApiKey      $ApiKey `
                    -Temperature $Temperature `
                    -MaxTokens   2048 `
                    -JsonMode `
                    -TimeoutSec  30

                if ($RefResult -and $RefResult.Text) {
                    $RefText = $RefResult.Text -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
                    try {
                        $Refined = $RefText.Trim() | ConvertFrom-Json -Depth 10
                        $Changes = [System.Collections.Generic.List[string]]::new()

                        # Update confidence
                        if ($Refined.PSObject.Properties['confidence']) {
                            $Confidence = $Refined.confidence
                            $Claim.fire_confidence = $Confidence
                        }

                        # Update evidence_criteria if refined
                        if ($Refined.PSObject.Properties['evidence_criteria']) {
                            $NewEC = $Refined.evidence_criteria
                            # Track what changed
                            if ($Claim.PSObject.Properties['evidence_criteria']) {
                                $OldEC = $Claim.evidence_criteria
                                foreach ($P in @('specificity', 'has_warrant', 'internally_consistent')) {
                                    $OldVal = if ($OldEC.PSObject.Properties[$P]) { $OldEC.$P } else { '?' }
                                    $NewVal = if ($NewEC.PSObject.Properties[$P]) { $NewEC.$P } else { '?' }
                                    if ("$OldVal" -ne "$NewVal") { $Changes.Add("${P}: $OldVal`u{2192}$NewVal") }
                                }
                                $Claim.evidence_criteria = $NewEC
                            }
                            else {
                                $Claim | Add-Member -NotePropertyName 'evidence_criteria' -NotePropertyValue $NewEC -Force
                                $Changes.Add('evidence_criteria added')
                            }
                        }

                        # Update claim text if refined
                        if ($Refined.PSObject.Properties['refined_claim'] -and $Refined.refined_claim -and $Refined.refined_claim -ne $ClaimText) {
                            $Claim.claim = $Refined.refined_claim
                            $ClaimText = $Refined.refined_claim
                            $Changes.Add('refined')
                        }

                        # If verified=false, mark as low confidence and stop
                        if ($Refined.PSObject.Properties['verified'] -and -not $Refined.verified) {
                            $Claim.fire_confidence = 0.1
                            $Confidence = 0.1
                            Write-Verbose "${Indent}iter $ClaimIter/$MaxIterPerClaim`: verified=false `u{2192} 0.10, stopped"
                            break
                        }

                        # Log iteration result
                        $ChangeStr = if ($Changes.Count -gt 0) { "  ($($Changes -join ', '))" } else { '' }
                        if ($Confidence -ge $ConfidenceThreshold) {
                            Write-Verbose "${Indent}iter $ClaimIter/$MaxIterPerClaim`: $([Math]::Round($BeforeConf, 2)) `u{2192} $([Math]::Round($Confidence, 2)) `u{2713}$ChangeStr"
                        }
                        else {
                            Write-Verbose "${Indent}iter $ClaimIter/$MaxIterPerClaim`: $([Math]::Round($BeforeConf, 2)) `u{2192} $([Math]::Round($Confidence, 2))$ChangeStr"
                        }
                    }
                    catch {
                        Write-Verbose "${Indent}iter $ClaimIter/$MaxIterPerClaim`: parse failed — $($_.Exception.Message)"
                    }
                }
                else {
                    Write-Verbose "${Indent}iter $ClaimIter/$MaxIterPerClaim`: empty API response"
                }
            }
            catch {
                Write-Verbose "${Indent}iter $ClaimIter/$MaxIterPerClaim`: API error — $($_.Exception.Message)"
            }
        }

        # Log claim text change if it was refined
        if ($ClaimText -ne $OriginalText) {
            $NewShort = if ($ClaimText.Length -gt 70) { $ClaimText.Substring(0, 70) + '...' } else { $ClaimText }
            Write-Verbose "${Indent}`u{2192} `"$NewShort`""
        }

        # Warn if claim exhausted iterations without reaching threshold
        if ($Confidence -lt $ConfidenceThreshold -and $ClaimIter -ge $MaxIterPerClaim) {
            $ClaimsExhausted++
            Write-Warning "FIRE: $ClaimLabel exhausted $MaxIterPerClaim iterations (final=$([Math]::Round($Confidence, 2)), threshold=$ConfidenceThreshold)"
        }

        $ClaimsIterated++
    }

    $Stopwatch.Stop()

    # ── Final summary log ─────────────────────────────────────────────────────
    Write-Verbose "FIRE complete: $($Claims.Count) claims | $ClaimsConfident confident | $ClaimsIterated iterated | $TotalIter total iterations | $TotalApiCalls API calls | $([Math]::Round($Stopwatch.Elapsed.TotalSeconds, 1))s"
    Write-Verbose "  Termination: $TerminationReason"
    Write-Verbose "  Guardrails: max_iter_per_claim=$MaxIterPerClaim, max_iter_per_doc=$MaxIterPerDoc, wall_clock=${WallClockSeconds}s, max_api_calls=$MaxApiCalls"
    if ($ClaimsExhausted -gt 0) {
        Write-Verbose "  WARNING: $ClaimsExhausted claim(s) exhausted iteration budget without reaching threshold"
    }

    # ── Return enriched summary ───────────────────────────────────────────────
    return @{
        Summary   = $Summary
        RawText   = $InitialResult.Text
        Backend   = $InitialResult.Backend
        FireStats = @{
            mode                = 'fire'
            total_iterations    = $TotalIter
            total_api_calls     = $TotalApiCalls
            claims_total        = $Claims.Count
            claims_confident    = $ClaimsConfident
            claims_iterated     = $ClaimsIterated
            elapsed_seconds     = [Math]::Round($Stopwatch.Elapsed.TotalSeconds, 1)
            termination_reason  = $TerminationReason
            guardrails          = [ordered]@{
                max_iter_per_claim = $MaxIterPerClaim
                max_iter_per_doc   = $MaxIterPerDoc
                wall_clock_seconds = $WallClockSeconds
                max_api_calls      = $MaxApiCalls
            }
        }
    }
}
