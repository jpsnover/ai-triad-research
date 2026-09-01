# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-ExtractionQuality {
    <#
    .SYNOPSIS
        Measures AI extraction quality against human-annotated gold-standard data.
    .DESCRIPTION
        Compares AI-generated summaries against gold-standard annotations to compute:
        - Key Point Recall: % of expected key_points found in actual
        - Key Point Precision: % of actual key_points that match an expected one
        - Mapping Accuracy: % of actual key_points with correct taxonomy_node_id
        - Factual Claim Recall: % of expected claims found
        - Unmapped Concept Recall: % of expected unmapped concepts detected

        When -EntityLinkAudit is specified, additionally runs a per-cycle
        entity_link_precision audit over a random 10-20-claim sample drawn from live
        summaries.  For each sampled entity_ref, an LLM judge (disclosed criterion:
        genuine vs spurious surface/alias match) classifies the link.  Results are
        persisted to calibration/core/extraction-metrics.jsonl as a trendable row with
        sample size + method.  This is the "path off stipulated" for the entity-link
        row in metric-provenance-register.md (t/3202).
    .PARAMETER DocId
        Test a single document.
    .PARAMETER All
        Test all documents with gold-standard files.
    .PARAMETER GoldDir
        Path to gold-standard directory. Default: tests/gold-standard/
    .PARAMETER PassThru
        Return results object for piping.
    .PARAMETER EntityLinkAudit
        Run the entity_link_precision audit cycle over live summaries.  Samples up to
        20 claims carrying entity_refs[], judges each with an LLM, and persists the
        precision score to calibration/core/extraction-metrics.jsonl.
    .PARAMETER EntityLinkSampleSize
        Maximum number of entity_refs to sample per audit cycle (default 20, min 10).
    .PARAMETER Model
        AI model for the LLM judge (default: gemini-3.5-flash-lite).
    .EXAMPLE
        Test-ExtractionQuality -DocId 'ai-safety-debate-2026'
    .EXAMPLE
        Test-ExtractionQuality -All
    .EXAMPLE
        Test-ExtractionQuality -EntityLinkAudit
    .EXAMPLE
        Test-ExtractionQuality -EntityLinkAudit -EntityLinkSampleSize 15
    .LINK
        Show-AITriadHelp
    .LINK
        Invoke-POVSummary
    .LINK
        Invoke-BatchSummary
    .LINK
        Get-Summary
    .LINK
        Repair-AITSummaryMappings
    .LINK
        Repair-UnmappedConcepts
    #>
    [CmdletBinding()]
    param(
        [string]$DocId = '',
        [switch]$All,
        [string]$GoldDir = '',
        [switch]$PassThru,
        [switch]$EntityLinkAudit,
        [ValidateRange(10, 100)][int]$EntityLinkSampleSize = 20,
        [string]$Model = 'gemini-3.5-flash-lite'
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── Gold-standard quality tests ───────────────────────────────────────────
    if ($DocId -or $All) {
        if ([string]::IsNullOrWhiteSpace($GoldDir)) {
            $GoldDir = Join-Path (Join-Path $script:RepoRoot 'tests') 'gold-standard'
        }

        if (-not (Test-Path $GoldDir)) {
            New-ActionableError -Goal 'locate gold-standard directory' `
                -Problem "Directory not found: $GoldDir" `
                -Location 'Test-ExtractionQuality' `
                -NextSteps @('Create tests/gold-standard/ and add annotated .gold.json files') -Throw
        }

        $SummariesDir = Get-SummariesDir

        # ── Collect gold files ────────────────────────────────────────────────
        if ($DocId) {
            $Path = Join-Path $GoldDir "$DocId.gold.json"
            if (-not (Test-Path $Path)) {
                New-ActionableError -Goal "load gold standard for $DocId" `
                    -Problem "Gold file not found: $Path" `
                    -Location 'Test-ExtractionQuality' `
                    -NextSteps @("Create $Path from _template.gold.json") -Throw
            }
            $GoldFiles = @(Get-Item $Path)
        }
        else {
            $GoldFiles = @(Get-ChildItem -Path $GoldDir -Filter '*.gold.json' -File |
                Where-Object { $_.Name -ne '_template.gold.json' } |
                Sort-Object Name)
        }

        if ($GoldFiles.Count -eq 0) {
            Write-Host "  No gold-standard files found in $GoldDir" -ForegroundColor Yellow
            Write-Host "  Create .gold.json files from _template.gold.json" -ForegroundColor Gray
            return
        }

        Write-Host "`n  EXTRACTION QUALITY TEST ($($GoldFiles.Count) document(s))" -ForegroundColor Cyan
        Write-Host "  $('─' * 50)" -ForegroundColor DarkGray

        $AllResults = [System.Collections.Generic.List[PSObject]]::new()

        foreach ($GoldFile in $GoldFiles) {
            $GoldDocId = $GoldFile.BaseName -replace '\.gold$', ''
            $Gold = Get-Content -Raw -Path $GoldFile.FullName | ConvertFrom-Json

            # Load actual summary
            $SumPath = Join-Path $SummariesDir "$GoldDocId.json"
            if (-not (Test-Path $SumPath)) {
                Write-Host "  $GoldDocId`: SKIP — no summary file" -ForegroundColor DarkGray
                continue
            }

            $Summary = Get-Content -Raw -Path $SumPath | ConvertFrom-Json

            # ── Key Point Recall & Precision ──────────────────────────────────
            $ExpectedKP = @($Gold.expected_key_points)
            $ActualKP = [System.Collections.Generic.List[string]]::new()

            foreach ($Camp in @('accelerationist', 'safetyist', 'skeptic')) {
                $CampData = $Summary.pov_summaries.$Camp
                if ($CampData -and $CampData.PSObject.Properties['key_points'] -and $CampData.key_points) {
                    foreach ($KP in @($CampData.key_points)) {
                        if ($KP.taxonomy_node_id) {
                            $ActualKP.Add($KP.taxonomy_node_id)
                        }
                    }
                }
            }

            $ExpectedNodeIds = @($ExpectedKP | ForEach-Object { $_.taxonomy_node_id } | Where-Object { $_ })
            $MatchedExpected = @($ExpectedNodeIds | Where-Object { $_ -in $ActualKP })
            $MatchedActual = @($ActualKP | Where-Object { $_ -in $ExpectedNodeIds })

            if ($ExpectedNodeIds.Count -gt 0) { $KPRecall = [Math]::Round($MatchedExpected.Count / $ExpectedNodeIds.Count * 100, 1) } else { $KPRecall = 0 }
            if ($ActualKP.Count -gt 0) { $KPPrecision = [Math]::Round($MatchedActual.Count / $ActualKP.Count * 100, 1) } else { $KPPrecision = 0 }

            # ── Mapping Accuracy ──────────────────────────────────────────────
            $CorrectMappings = $MatchedActual.Count
            if ($ActualKP.Count -gt 0) { $MappingAccuracy = [Math]::Round($CorrectMappings / $ActualKP.Count * 100, 1) } else { $MappingAccuracy = 0 }

            # ── Factual Claim Recall ──────────────────────────────────────────
            $ExpectedClaims = @($Gold.expected_factual_claims)
            if ($Summary.factual_claims) { $ActualClaims = @($Summary.factual_claims) } else { $ActualClaims = @() }

            $ClaimMatches = 0
            foreach ($EC in $ExpectedClaims) {
                $ECNodes = @($EC.linked_taxonomy_nodes)
                # Match if any actual claim shares linked taxonomy nodes
                foreach ($AC in $ActualClaims) {
                    if ($AC.PSObject.Properties['linked_taxonomy_nodes']) { $ACNodes = @($AC.linked_taxonomy_nodes) } else { $ACNodes = @() }
                    $Overlap = @($ECNodes | Where-Object { $_ -in $ACNodes })
                    if ($Overlap.Count -gt 0) {
                        $ClaimMatches++
                        break
                    }
                }
            }

            if ($ExpectedClaims.Count -gt 0) { $ClaimRecall = [Math]::Round($ClaimMatches / $ExpectedClaims.Count * 100, 1) } else { $ClaimRecall = 0 }

            # ── Unmapped Concept Recall ───────────────────────────────────────
            $ExpectedUnmapped = @($Gold.expected_unmapped_concepts)
            if ($Summary.unmapped_concepts) { $ActualUnmapped = @($Summary.unmapped_concepts) } else { $ActualUnmapped = @() }

            $UnmappedMatches = 0
            foreach ($EU in $ExpectedUnmapped) {
                $ExpPov = $EU.suggested_pov
                # Match if any actual unmapped concept has the same suggested POV
                foreach ($AU in $ActualUnmapped) {
                    if ($AU.PSObject.Properties['suggested_pov']) { $ActPov = $AU.suggested_pov } else { $ActPov = '' }
                    if ($ActPov -eq $ExpPov) {
                        $UnmappedMatches++
                        break
                    }
                }
            }

            if ($ExpectedUnmapped.Count -gt 0) { $UnmappedRecall = [Math]::Round($UnmappedMatches / $ExpectedUnmapped.Count * 100, 1) } else { $UnmappedRecall = 0 }

            # ── Display ───────────────────────────────────────────────────────
            Write-Host "`n  $GoldDocId`:" -ForegroundColor White
            if ($KPRecall -ge 70) { $KPColor = 'Green' } elseif ($KPRecall -ge 50) { $KPColor = 'Yellow' } else { $KPColor = 'Red' }
            Write-Host "    KP Recall:         $KPRecall% ($($MatchedExpected.Count)/$($ExpectedNodeIds.Count))" -ForegroundColor $KPColor
            Write-Host "    KP Precision:      $KPPrecision% ($($MatchedActual.Count)/$($ActualKP.Count))" -ForegroundColor $KPColor
            Write-Host "    Mapping Accuracy:  $MappingAccuracy%" -ForegroundColor $(if ($MappingAccuracy -ge 70) { 'Green' } else { 'Yellow' })
            Write-Host "    Claim Recall:      $ClaimRecall% ($ClaimMatches/$($ExpectedClaims.Count))" -ForegroundColor $(if ($ClaimRecall -ge 70) { 'Green' } else { 'Yellow' })
            Write-Host "    Unmapped Recall:   $UnmappedRecall% ($UnmappedMatches/$($ExpectedUnmapped.Count))" -ForegroundColor $(if ($UnmappedRecall -ge 50) { 'Green' } else { 'Yellow' })

            $AllResults.Add([PSCustomObject][ordered]@{
                DocId            = $GoldDocId
                KPRecall         = $KPRecall
                KPPrecision      = $KPPrecision
                MappingAccuracy  = $MappingAccuracy
                ClaimRecall      = $ClaimRecall
                UnmappedRecall   = $UnmappedRecall
                ExpectedKP       = $ExpectedNodeIds.Count
                ActualKP         = $ActualKP.Count
                ExpectedClaims   = $ExpectedClaims.Count
                ExpectedUnmapped = $ExpectedUnmapped.Count
            })
        }

        # ── Aggregate ─────────────────────────────────────────────────────────
        if ($AllResults.Count -gt 1) {
            Write-Host "`n  AGGREGATE ($($AllResults.Count) documents):" -ForegroundColor Cyan
            Write-Host "    Avg KP Recall:       $([Math]::Round(($AllResults | ForEach-Object { $_.KPRecall } | Measure-Object -Average).Average, 1))%" -ForegroundColor White
            Write-Host "    Avg KP Precision:    $([Math]::Round(($AllResults | ForEach-Object { $_.KPPrecision } | Measure-Object -Average).Average, 1))%" -ForegroundColor White
            Write-Host "    Avg Mapping Acc:     $([Math]::Round(($AllResults | ForEach-Object { $_.MappingAccuracy } | Measure-Object -Average).Average, 1))%" -ForegroundColor White
            Write-Host "    Avg Claim Recall:    $([Math]::Round(($AllResults | ForEach-Object { $_.ClaimRecall } | Measure-Object -Average).Average, 1))%" -ForegroundColor White
            Write-Host "    Avg Unmapped Recall: $([Math]::Round(($AllResults | ForEach-Object { $_.UnmappedRecall } | Measure-Object -Average).Average, 1))%" -ForegroundColor White
        }

        Write-Host ""

        if ($PassThru) {
            return $AllResults.ToArray()
        }
    }

    # ── Entity-link precision audit ───────────────────────────────────────────
    if ($EntityLinkAudit) {
        Invoke-EntityLinkPrecisionAudit -SampleSize $EntityLinkSampleSize -Model $Model
    }

    if (-not $DocId -and -not $All -and -not $EntityLinkAudit) {
        New-ActionableError -Goal 'run extraction quality test' `
            -Problem 'No mode specified' `
            -Location 'Test-ExtractionQuality' `
            -NextSteps @(
                'Use -DocId <slug> for one document',
                'Use -All for all gold-standard documents',
                'Use -EntityLinkAudit to run the entity_link_precision audit cycle'
            ) -Throw
    }
}

function Invoke-EntityLinkPrecisionAudit {
    <#
    .SYNOPSIS
        Samples entity_refs from live summaries and judges each with an LLM.
    .DESCRIPTION
        Internal helper for Test-ExtractionQuality -EntityLinkAudit.
        - Scans up to 50 summary files for claims carrying entity_refs[].
        - Randomly samples up to $SampleSize refs (target: 10-20 per cycle).
        - For each ref, calls the LLM entity-link-judge with:
            CLAIM / SURFACE / TARGET / TARGET_LABEL / METHOD
        - Computes precision = genuine / (genuine + spurious).
        - Persists one JSONL row to calibration/core/extraction-metrics.jsonl with
          timestamp, metric name, value, n, and method so the score is trendable.
        Emits WARN and returns gracefully if summaries are inaccessible or the
        sample is too small.
    .PARAMETER SampleSize
        Max entity_refs to sample (default 20).
    .PARAMETER Model
        LLM judge model (default: gemini-3.5-flash-lite).
    #>
    [CmdletBinding()]
    param(
        [int]$SampleSize = 20,
        [string]$Model = 'gemini-3.5-flash-lite'
    )
    Set-StrictMode -Version Latest

    Write-Host "`n  ENTITY LINK PRECISION AUDIT (t/3202)" -ForegroundColor Cyan
    Write-Host "  $('─' * 50)" -ForegroundColor DarkGray

    # ── Locate summaries ──────────────────────────────────────────────────────
    $SumDir = try { Get-SummariesDir } catch { $null }
    if (-not $SumDir -or -not (Test-Path $SumDir)) {
        Write-Warning "EntityLinkAudit: summaries directory not accessible — skipping (set AI_TRIAD_DATA_ROOT or configure .aitriad.json)"
        return
    }

    # Scan up to 50 summary files — enough to find sufficient refs without
    # reading the entire corpus (which can be 400+ MB).
    $SumFiles = @(Get-ChildItem -Path $SumDir -Filter '*.json' -File | Select-Object -First 50)
    if ($SumFiles.Count -eq 0) {
        Write-Warning "EntityLinkAudit: no summary files found in $SumDir — skipping"
        return
    }

    # ── Collect entity_refs from claims ───────────────────────────────────────
    $AllRefs = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($SumFile in $SumFiles) {
        try {
            $Sum = Get-Content -Raw -Path $SumFile.FullName | ConvertFrom-Json

            # key_points in pov_summaries
            foreach ($Camp in @('accelerationist', 'safetyist', 'skeptic')) {
                if (-not $Sum.PSObject.Properties['pov_summaries']) { continue }
                $CampNode = $Sum.pov_summaries
                if (-not $CampNode.PSObject.Properties[$Camp]) { continue }
                $CampData = $CampNode.$Camp
                if (-not $CampData -or -not $CampData.PSObject.Properties['key_points']) { continue }
                foreach ($KP in @($CampData.key_points)) {
                    $ClaimText = ''
                    if ($KP.PSObject.Properties['point'] -and -not [string]::IsNullOrWhiteSpace([string]$KP.point)) {
                        $ClaimText = [string]$KP.point
                    }
                    elseif ($KP.PSObject.Properties['label'] -and -not [string]::IsNullOrWhiteSpace([string]$KP.label)) {
                        $ClaimText = [string]$KP.label
                    }
                    if ([string]::IsNullOrWhiteSpace($ClaimText)) { continue }
                    if (-not $KP.PSObject.Properties['entity_refs'] -or -not $KP.entity_refs) { continue }
                    foreach ($ER in @($KP.entity_refs)) {
                        if (-not $ER -or -not $ER.PSObject.Properties['ref'] -or -not $ER.PSObject.Properties['surface']) { continue }
                        $AllRefs.Add([PSCustomObject]@{
                            ClaimText   = $ClaimText
                            Surface     = [string]$ER.surface
                            Target      = [string]$ER.ref
                            TargetLabel = ''
                            Method      = if ($ER.PSObject.Properties['method']) { [string]$ER.method } else { 'exact' }
                        })
                    }
                }
            }

            # factual_claims
            if ($Sum.PSObject.Properties['factual_claims'] -and $Sum.factual_claims) {
                foreach ($FC in @($Sum.factual_claims)) {
                    $ClaimText = ''
                    if ($FC.PSObject.Properties['claim'] -and -not [string]::IsNullOrWhiteSpace([string]$FC.claim)) {
                        $ClaimText = [string]$FC.claim
                    }
                    if ([string]::IsNullOrWhiteSpace($ClaimText)) { continue }
                    if (-not $FC.PSObject.Properties['entity_refs'] -or -not $FC.entity_refs) { continue }
                    foreach ($ER in @($FC.entity_refs)) {
                        if (-not $ER -or -not $ER.PSObject.Properties['ref'] -or -not $ER.PSObject.Properties['surface']) { continue }
                        $AllRefs.Add([PSCustomObject]@{
                            ClaimText   = $ClaimText
                            Surface     = [string]$ER.surface
                            Target      = [string]$ER.ref
                            TargetLabel = ''
                            Method      = if ($ER.PSObject.Properties['method']) { [string]$ER.method } else { 'exact' }
                        })
                    }
                }
            }
        }
        catch {
            Write-Verbose "EntityLinkAudit: skipped $($SumFile.Name): $_"
        }
    }

    Write-Host "  Scanned $($SumFiles.Count) summary files, found $($AllRefs.Count) entity_refs" -ForegroundColor Gray

    if ($AllRefs.Count -eq 0) {
        Write-Warning "EntityLinkAudit: no entity_refs found in scanned summaries — run Invoke-EntityExtraction or Update-ClaimEntityRef to populate entity links"
        return
    }

    if ($AllRefs.Count -lt 10) {
        Write-Warning "EntityLinkAudit: only $($AllRefs.Count) entity_refs found (need >= 10 for a meaningful audit) — results will have high variance"
    }

    # ── Random sample ─────────────────────────────────────────────────────────
    $ActualSampleSize = [Math]::Min($SampleSize, $AllRefs.Count)
    $Sample = if ($AllRefs.Count -le $ActualSampleSize) {
        $AllRefs.ToArray()
    }
    else {
        # Fisher-Yates via Get-Random (PS7 -Count on pipeline)
        @($AllRefs | Get-Random -Count $ActualSampleSize)
    }

    Write-Host "  Sampling $ActualSampleSize refs for LLM judgment (model: $Model, criterion: genuine vs spurious)" -ForegroundColor Gray

    # ── LLM judge each ref ────────────────────────────────────────────────────
    $SystemPrompt = Get-Prompt -Name 'entity-link-judge'
    $Genuine    = 0
    $Spurious   = 0
    $Unresolved = 0

    foreach ($Ref in $Sample) {
        # Truncate claim text to avoid excessive prompt length while preserving context
        $ClaimSnippet = if ($Ref.ClaimText.Length -gt 400) { $Ref.ClaimText.Substring(0, 400) + '...' } else { $Ref.ClaimText }
        $UserMsg = "CLAIM: $ClaimSnippet`nSURFACE: $($Ref.Surface)`nTARGET: $($Ref.Target)`nTARGET_LABEL: $($Ref.TargetLabel)`nMETHOD: $($Ref.Method)"

        $Resp = try {
            Invoke-AIApi -SystemInstruction $SystemPrompt -Prompt $UserMsg `
                -Model $Model -Temperature 0.0 -JsonMode -MaxTokens 200
        }
        catch { $null }

        if (-not $Resp -or -not $Resp.PSObject.Properties['Text'] -or [string]::IsNullOrWhiteSpace([string]$Resp.Text)) {
            Write-Verbose "EntityLinkAudit: judge unresolved for surface '$($Ref.Surface)' — API error or empty response"
            $Unresolved++
            continue
        }

        $Parsed = try { ([string]$Resp.Text) | ConvertFrom-Json } catch { $null }
        if (-not $Parsed -or -not $Parsed.PSObject.Properties['verdict']) {
            Write-Verbose "EntityLinkAudit: judge unresolved for surface '$($Ref.Surface)' — malformed JSON"
            $Unresolved++
            continue
        }

        $Verdict = ([string]$Parsed.verdict).Trim().ToLowerInvariant()
        switch ($Verdict) {
            'genuine'  { $Genuine++ }
            'spurious' { $Spurious++ }
            default    { $Unresolved++ }
        }
    }

    # ── Compute precision ─────────────────────────────────────────────────────
    $Adjudicated = $Genuine + $Spurious
    $Precision = if ($Adjudicated -gt 0) { [Math]::Round($Genuine / $Adjudicated, 4) } else { $null }

    # ── Display ───────────────────────────────────────────────────────────────
    if ($null -ne $Precision) {
        $PrecPct = [Math]::Round($Precision * 100, 1)
        $Color = if ($Precision -ge 0.85) { 'Green' } elseif ($Precision -ge 0.70) { 'Yellow' } else { 'Red' }
        Write-Host "  entity_link_precision: $PrecPct% ($Genuine genuine / $Adjudicated adjudicated, $Unresolved unresolved)" -ForegroundColor $Color
    }
    else {
        Write-Host "  entity_link_precision: N/A (no adjudicated refs — all judge calls unresolved)" -ForegroundColor Yellow
    }

    if ($Unresolved -gt 0 -and $Adjudicated -eq 0) {
        Write-Warning "EntityLinkAudit: all $Unresolved judge calls were unresolved — check AI backend availability (AI_API_KEY / GEMINI_API_KEY)"
    }
    elseif ($Unresolved -gt ($ActualSampleSize / 3)) {
        Write-Warning "EntityLinkAudit: $Unresolved/$ActualSampleSize judge calls unresolved — precision estimate may be biased; check AI backend"
    }

    # ── Persist to calibration/core/extraction-metrics.jsonl ─────────────────
    try {
        $SumDirParent = Split-Path (Get-SummariesDir) -Parent
        $CoreDir = Join-Path (Join-Path $SumDirParent 'calibration') 'core'
        if (-not (Test-Path $CoreDir)) {
            $null = New-Item -ItemType Directory -Path $CoreDir -Force
        }
        $MetricsPath = Join-Path $CoreDir 'extraction-metrics.jsonl'

        $MetricRow = [ordered]@{
            timestamp         = (Get-Date -Format 'o')
            metric            = 'entity_link_precision'
            value             = $Precision
            n_sample          = $ActualSampleSize
            n_genuine         = $Genuine
            n_spurious        = $Spurious
            n_unresolved      = $Unresolved
            n_adjudicated     = $Adjudicated
            method            = 'llm-judge'
            judge_model       = $Model
            judge_criterion   = 'genuine-vs-spurious surface/alias match'
            ref_type          = 'entity'
            summaries_scanned = $SumFiles.Count
            refs_found        = $AllRefs.Count
            ticket            = 't/3202'
        }

        $JsonLine = $MetricRow | ConvertTo-Json -Depth 3 -Compress
        Assert-DataWriteAllowed -Path $MetricsPath  # t/2902
        Add-Content -Path $MetricsPath -Value $JsonLine -Encoding utf8

        Write-Host "  Persisted to calibration/core/extraction-metrics.jsonl" -ForegroundColor Gray
    }
    catch {
        Write-Warning "EntityLinkAudit: failed to persist metric row (non-critical): $_"
    }
}
