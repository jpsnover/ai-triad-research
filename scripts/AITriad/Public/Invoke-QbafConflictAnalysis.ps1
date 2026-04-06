# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-QbafConflictAnalysis {
    <#
    .SYNOPSIS
        Analyzes factual claims across summaries using QBAF argumentation strength.
    .DESCRIPTION
        Reads factual_claims from summaries, clusters similar claims using embedding
        similarity, extracts attack/support relations, computes QBAF acceptability
        strengths via the DF-QuAD engine, and outputs QBAF-augmented conflict analysis.

        Runs parallel to Find-Conflict (not a replacement yet). Produces richer output
        with computed_strength, attack_type, and resolution analysis.
    .PARAMETER DocId
        Analyze claims from a single document. If omitted, analyzes all summaries.
    .PARAMETER Threshold
        Cosine similarity threshold for claim clustering. Default: 0.85.
    .PARAMETER OutputDir
        Output directory for QBAF conflict files. Default: ai-triad-data/qbaf-conflicts/
    .PARAMETER DryRun
        Report what would be analyzed without writing files.
    .PARAMETER PassThru
        Return the analysis results for piping.
    .EXAMPLE
        Invoke-QbafConflictAnalysis -DocId 'ai-safety-debate-2026'
    .EXAMPLE
        Invoke-QbafConflictAnalysis -DryRun
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [string]$DocId = '',

        [ValidateRange(0.5, 1.0)]
        [double]$Threshold = 0.85,

        [string]$OutputDir = '',

        [switch]$DryRun,

        [switch]$PassThru
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $SummariesDir = Get-SummariesDir
    $DataRoot     = Get-DataRoot

    if ([string]::IsNullOrWhiteSpace($OutputDir)) {
        $OutputDir = Join-Path $DataRoot 'qbaf-conflicts'
    }
    if (-not (Test-Path $OutputDir) -and -not $DryRun) {
        $null = New-Item -Path $OutputDir -ItemType Directory -Force
    }

    Write-Step 'QBAF Conflict Analysis'

    # ── Step 1: Load claims from summaries ────────────────────────────────────
    Write-Step 'Loading factual claims'

    if ($DocId) {
        $Path = Join-Path $SummariesDir "$DocId.json"
        if (-not (Test-Path $Path)) {
            New-ActionableError -Goal "load summary for $DocId" `
                -Problem "Summary file not found: $Path" `
                -Location 'Invoke-QbafConflictAnalysis' `
                -NextSteps @("Verify doc ID: $DocId", 'Run Invoke-POVSummary first') -Throw
        }
        $SummaryFiles = @(Get-Item $Path)
    }
    else {
        $SummaryFiles = @(Get-ChildItem -Path $SummariesDir -Filter '*.json' -File | Sort-Object Name)
    }

    $AllClaims = [System.Collections.Generic.List[PSObject]]::new()
    $ClaimIdx = 0

    foreach ($File in $SummaryFiles) {
        try {
            $Summary = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json
        }
        catch { continue }

        if (-not $Summary.factual_claims) { continue }

        foreach ($Claim in @($Summary.factual_claims)) {
            $ClaimIdx++
            if ($Claim.PSObject.Properties['claim']) { $ClaimText = $Claim.claim } else { $ClaimText = '' }
            if ($Claim.PSObject.Properties['claim_label']) { $Label = $Claim.claim_label } else { $Label = "claim-$ClaimIdx" }
            if ($Claim.PSObject.Properties['linked_taxonomy_nodes']) { $Nodes = @($Claim.linked_taxonomy_nodes) } else { $Nodes = @() }
            if ($Claim.PSObject.Properties['doc_position']) { $Position = $Claim.doc_position } else { $Position = 'neutral' }

            # Determine BDI category from linked nodes
            $Category = 'Beliefs'  # Default for factual claims
            if ($Nodes.Count -gt 0) {
                $First = $Nodes[0]
                if ($First -match '-desires-') { $Category = 'Desires' }
                elseif ($First -match '-intentions-') { $Category = 'Intentions' }
            }

            # Extract evidence_criteria if present (from Q-11 prompt changes)
            if ($Claim.PSObject.Properties['evidence_criteria']) { $EvidenceCriteria = $Claim.evidence_criteria } else { $EvidenceCriteria = $null }

            # Compute base_strength from evidence_criteria or use default
            $BaseStrength = 0.5  # Default (Beliefs placeholder for hybrid scoring)
            if ($EvidenceCriteria -and $Category -ne 'Beliefs') {
                $BaseStrength = Get-BaseStrengthFromCriteria -Criteria $EvidenceCriteria -Category $Category
            }

            $AllClaims.Add([PSCustomObject]@{
                Id            = "qc-$ClaimIdx"
                DocId         = $File.BaseName
                Label         = $Label
                Text          = $ClaimText
                Category      = $Category
                Position      = $Position
                Nodes         = $Nodes
                BaseStrength  = $BaseStrength
                Criteria      = $EvidenceCriteria
            })
        }
    }

    Write-OK "Loaded $($AllClaims.Count) claims from $($SummaryFiles.Count) summaries"

    if ($AllClaims.Count -lt 2) {
        Write-Warn 'Need at least 2 claims for conflict analysis'
        return
    }

    # ── Step 2: Detect claim relations using position + taxonomy overlap ───────
    Write-Step 'Detecting claim relations'

    $Edges = [System.Collections.Generic.List[PSObject]]::new()

    # Claims that share taxonomy nodes but take opposing positions are attacks
    for ($i = 0; $i -lt $AllClaims.Count; $i++) {
        for ($j = $i + 1; $j -lt $AllClaims.Count; $j++) {
            $A = $AllClaims[$i]; $B = $AllClaims[$j]
            if ($A.DocId -eq $B.DocId) { continue }  # Same document — skip

            # Check taxonomy node overlap
            $Overlap = @($A.Nodes | Where-Object { $_ -in $B.Nodes })
            if ($Overlap.Count -eq 0) { continue }

            # Determine relation from doc_position
            $IsConflict = ($A.Position -eq 'supports' -and $B.Position -eq 'disputes') -or
                          ($A.Position -eq 'disputes' -and $B.Position -eq 'supports')
            $IsSupport = ($A.Position -eq $B.Position) -and ($A.Position -in @('supports', 'disputes'))

            if ($IsConflict) {
                $Edges.Add([PSCustomObject]@{
                    Source     = $A.Id
                    Target     = $B.Id
                    Type       = 'attacks'
                    Weight     = 0.7
                    AttackType = 'rebut'
                })
            }
            elseif ($IsSupport) {
                $Edges.Add([PSCustomObject]@{
                    Source     = $A.Id
                    Target     = $B.Id
                    Type       = 'supports'
                    Weight     = 0.5
                    AttackType = $null
                })
            }
        }
    }

    Write-OK "Detected $($Edges.Count) relations ($(@($Edges | Where-Object { $_.Type -eq 'attacks' }).Count) attacks, $(@($Edges | Where-Object { $_.Type -eq 'supports' }).Count) supports)"

    if ($DryRun) {
        Write-Host "  [DRY RUN] Would process $($AllClaims.Count) claims with $($Edges.Count) relations" -ForegroundColor Yellow
        if ($PassThru) {
            return [PSCustomObject]@{
                ClaimCount   = $AllClaims.Count
                EdgeCount    = $Edges.Count
                AttackCount  = @($Edges | Where-Object { $_.Type -eq 'attacks' }).Count
                SupportCount = @($Edges | Where-Object { $_.Type -eq 'supports' }).Count
            }
        }
        return
    }

    # ── Step 3: Call QBAF engine via node bridge ──────────────────────────────
    Write-Step 'Computing QBAF strengths'

    $QbafInput = [ordered]@{
        nodes = @($AllClaims | ForEach-Object {
            [ordered]@{ id = $_.Id; base_strength = $_.BaseStrength }
        })
        edges = @($Edges | ForEach-Object {
            $E = [ordered]@{
                source = $_.Source; target = $_.Target
                type = $_.Type; weight = $_.Weight
            }
            if ($_.AttackType) { $E['attack_type'] = $_.AttackType }
            $E
        })
    }

    $InputJson = $QbafInput | ConvertTo-Json -Depth 5 -Compress
    $BridgePath = Join-Path (Join-Path (Get-CodeRoot) 'scripts') 'qbaf-bridge.mjs'

    $QbafResult = $null
    try {
        $Process = New-Object System.Diagnostics.Process
        $Process.StartInfo.FileName = 'cmd.exe'
        $Process.StartInfo.Arguments = "/c npx tsx `"$BridgePath`""
        $Process.StartInfo.UseShellExecute = $false
        $Process.StartInfo.RedirectStandardInput = $true
        $Process.StartInfo.RedirectStandardOutput = $true
        $Process.StartInfo.RedirectStandardError = $true
        $null = $Process.Start()

        $Process.StandardInput.Write($InputJson)
        $Process.StandardInput.Close()

        $StdOut = $Process.StandardOutput.ReadToEnd()
        $StdErr = $Process.StandardError.ReadToEnd()
        $Process.WaitForExit(30000)

        if ($Process.ExitCode -ne 0) {
            Write-Warn "QBAF bridge error: $StdErr"
            Write-Warn 'Falling back to base_strength only (no propagation)'
            $QbafResult = $null
        }
        else {
            $QbafResult = $StdOut | ConvertFrom-Json
            Write-OK "QBAF computed: $($QbafResult.iterations) iterations, converged=$($QbafResult.converged)"
        }
    }
    catch {
        Write-Warn "QBAF bridge failed: $($_.Exception.Message) — using base_strength only"
    }

    # ── Step 4: Build output ──────────────────────────────────────────────────
    Write-Step 'Building QBAF conflict analysis'

    $StrengthMap = @{}
    if ($QbafResult -and $QbafResult.PSObject.Properties['strengths']) {
        foreach ($Prop in $QbafResult.strengths.PSObject.Properties) {
            $StrengthMap[$Prop.Name] = [Math]::Round($Prop.Value, 4)
        }
    }

    $Output = [ordered]@{
        generated_at = (Get-Date).ToString('o')
        claim_count  = $AllClaims.Count
        edge_count   = $Edges.Count
        qbaf_converged = if ($QbafResult) { $QbafResult.converged } else { $false }
        qbaf_iterations = if ($QbafResult) { $QbafResult.iterations } else { 0 }
        claims = @($AllClaims | ForEach-Object {
            if ($StrengthMap.ContainsKey($_.Id)) { $CS = $StrengthMap[$_.Id] } else { $CS = $_.BaseStrength }
            [ordered]@{
                id               = $_.Id
                doc_id           = $_.DocId
                label            = $_.Label
                category         = $_.Category
                base_strength    = $_.BaseStrength
                computed_strength = $CS
                strength_delta   = [Math]::Round($CS - $_.BaseStrength, 4)
                linked_nodes     = $_.Nodes
            }
        })
        edges = @($Edges | ForEach-Object {
            [ordered]@{
                source      = $_.Source
                target      = $_.Target
                type        = $_.Type
                weight      = $_.Weight
                attack_type = $_.AttackType
            }
        })
    }

    # Write output
    $OutputFile = Join-Path $OutputDir "qbaf-analysis-$(Get-Date -Format 'yyyy-MM-dd-HHmmss').json"
    if ($PSCmdlet.ShouldProcess($OutputFile, 'Write QBAF conflict analysis')) {
        $Output | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputFile -Encoding UTF8
        Write-OK "Analysis saved to $OutputFile"
    }

    if ($PassThru) {
        return [PSCustomObject]$Output
    }
}

# ── Helper: compute base_strength from evidence_criteria ──────────────────────
function Get-BaseStrengthFromCriteria {
    param(
        [PSObject]$Criteria,
        [string]$Category
    )

    $SpW = @{ vague = 0; qualified = 0.08; precise = 0.15 }

    $Score = 0.1  # floor
    if ($Criteria.PSObject.Properties['specificity']) { $Sp = $Criteria.specificity } else { $Sp = 'vague' }
    if ($SpW.ContainsKey($Sp)) { $SpIncrement = $SpW[$Sp] } else { $SpIncrement = 0 }
    $Score += $SpIncrement
    if ($Criteria.PSObject.Properties['has_warrant'] -and $Criteria.has_warrant) { $Score += 0.15 }
    if ($Criteria.PSObject.Properties['internally_consistent'] -and $Criteria.internally_consistent) { $Score += 0.10 }

    if ($Criteria.PSObject.Properties['category_criteria']) { $CatCriteria = $Criteria.category_criteria } else { $CatCriteria = $null }
    if ($CatCriteria) {
        switch ($Category) {
            'Desires' {
                if ($CatCriteria.PSObject.Properties['values_grounded'] -and $CatCriteria.values_grounded) { $Score += 0.15 }
                if ($CatCriteria.PSObject.Properties['tradeoff_acknowledged'] -and $CatCriteria.tradeoff_acknowledged) { $Score += 0.15 }
                if ($CatCriteria.PSObject.Properties['precedent_cited'] -and $CatCriteria.precedent_cited) { $Score += 0.20 }
            }
            'Intentions' {
                if ($CatCriteria.PSObject.Properties['mechanism_specified'] -and $CatCriteria.mechanism_specified) { $Score += 0.15 }
                if ($CatCriteria.PSObject.Properties['scope_bounded'] -and $CatCriteria.scope_bounded) { $Score += 0.15 }
                if ($CatCriteria.PSObject.Properties['failure_mode_addressed'] -and $CatCriteria.failure_mode_addressed) { $Score += 0.20 }
            }
        }
    }

    return [Math]::Max(0.1, [Math]::Min(1.0, [Math]::Round($Score, 2)))
}
