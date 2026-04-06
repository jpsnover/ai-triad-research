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
    .PARAMETER DocId
        Test a single document.
    .PARAMETER All
        Test all documents with gold-standard files.
    .PARAMETER GoldDir
        Path to gold-standard directory. Default: tests/gold-standard/
    .PARAMETER PassThru
        Return results object for piping.
    .EXAMPLE
        Test-ExtractionQuality -DocId 'ai-safety-debate-2026'
    .EXAMPLE
        Test-ExtractionQuality -All
    #>
    [CmdletBinding()]
    param(
        [string]$DocId = '',
        [switch]$All,
        [string]$GoldDir = '',
        [switch]$PassThru
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

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

    # ── Collect gold files ────────────────────────────────────────────────────
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
    elseif ($All) {
        $GoldFiles = @(Get-ChildItem -Path $GoldDir -Filter '*.gold.json' -File |
            Where-Object { $_.Name -ne '_template.gold.json' } |
            Sort-Object Name)
    }
    else {
        New-ActionableError -Goal 'run extraction quality test' `
            -Problem 'Specify -DocId or -All' `
            -Location 'Test-ExtractionQuality' `
            -NextSteps @('Use -DocId <slug> for one document', 'Use -All for all gold-standard documents') -Throw
        $GoldFiles = @()
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
            if ($CampData -and $CampData.key_points) {
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
