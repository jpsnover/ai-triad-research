# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-AttributeExtraction {
    <#
    .SYNOPSIS
        Uses AI to generate rich graph attributes for taxonomy nodes (Phase 1 of LAG proposal).
    .DESCRIPTION
        Reads taxonomy JSON files, sends nodes in batches to an LLM, and writes
        graph_attributes back to each node. Attributes include epistemic_type,
        rhetorical_strategy, assumes, falsifiability, audience, emotional_register,
        policy_actionability, intellectual_lineage, and steelman_vulnerability.

        Attributes are stored as a new "graph_attributes" key on each node object,
        which is backwards-compatible with all existing tooling.

        Nodes that already have graph_attributes are skipped unless -Force is specified.
    .PARAMETER POV
        Process only this POV file. If omitted, processes all POV files and cross-cutting.
        Valid values: accelerationist, safetyist, skeptic, cross-cutting.
    .PARAMETER BatchSize
        Number of nodes to process per API call. Default: 8.
    .PARAMETER Model
        AI model to use. Defaults to 'gemini-2.5-flash'.
    .PARAMETER ApiKey
        AI API key. If omitted, resolved via backend-specific env var or AI_API_KEY.
    .PARAMETER Temperature
        Sampling temperature (0.0-1.0). Default: 0.2 (precise analytical output).
    .PARAMETER DryRun
        Build and display the prompt for the first batch, but do NOT call the API.
    .PARAMETER Force
        Re-generate attributes even for nodes that already have them.
    .PARAMETER RepoRoot
        Path to the repository root. Defaults to the module-resolved repo root.
    .EXAMPLE
        Invoke-AttributeExtraction -DryRun
    .EXAMPLE
        Invoke-AttributeExtraction -POV accelerationist
    .EXAMPLE
        Invoke-AttributeExtraction -Force -Model 'gemini-2.5-pro'
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'cross-cutting', 'situations')]
        [string]$POV = '',

        [ValidateRange(1, 20)]
        [int]$BatchSize = 8,

        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [string]$Model = 'gemini-2.5-flash',

        [string]$ApiKey = '',

        [ValidateRange(0.0, 1.0)]
        [double]$Temperature = 0.2,

        [switch]$DryRun,

        [switch]$Force,

        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── Step 1: Validate environment ──
    Write-Step 'Validating environment'

    if (-not (Test-Path $RepoRoot)) {
        Write-Fail "Repo root not found: $RepoRoot"
        throw "Repo root not found"
    }

    $TaxDir = Get-TaxonomyDir
    if (-not (Test-Path $TaxDir)) {
        Write-Fail "Taxonomy directory not found: $TaxDir"
        throw "Taxonomy directory not found"
    }

    if (-not $DryRun) {
        $Backend = if     ($Model -match '^gemini') { 'gemini' }
                   elseif ($Model -match '^claude') { 'claude' }
                   elseif ($Model -match '^groq')   { 'groq'   }
                   else                             { 'gemini'  }
        $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend
        if ([string]::IsNullOrWhiteSpace($ResolvedKey)) {
            Write-Fail 'No API key found. Set GEMINI_API_KEY, ANTHROPIC_API_KEY, or AI_API_KEY.'
            throw 'No API key configured'
        }
    }

    # ── Step 2: Determine which files to process ──
    $PovFiles = @('accelerationist', 'safetyist', 'skeptic', 'situations')
    if ($POV) {
        $PovFiles = @($POV)
    }

    Write-OK "Processing: $($PovFiles -join ', ')"

    # ── Step 3: Load prompts ──
    $SystemPrompt = Get-Prompt -Name 'attribute-extraction'
    $SchemaPrompt = Get-Prompt -Name 'attribute-extraction-schema'

    # ── Step 4: Process each taxonomy file ──
    $TotalProcessed = 0
    $TotalSkipped   = 0
    $TotalFailed    = 0

    foreach ($PovKey in $PovFiles) {
        $FilePath = Join-Path $TaxDir "$PovKey.json"
        if (-not (Test-Path $FilePath)) {
            Write-Warn "File not found, skipping: $FilePath"
            continue
        }

        Write-Step "Loading $PovKey"
        $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json -Depth 20

        # Identify nodes needing attributes
        $AllNodes = @($FileData.nodes)
        if ($Force) {
            $NodesToProcess = $AllNodes
        } else {
            $NodesToProcess = @($AllNodes | Where-Object {
                -not $_.PSObject.Properties['graph_attributes'] -or
                $null -eq $_.graph_attributes
            })
        }

        $AlreadyDone = $AllNodes.Count - $NodesToProcess.Count
        if ($AlreadyDone -gt 0) {
            Write-Info "$AlreadyDone nodes already have attributes (use -Force to regenerate)"
        }

        if ($NodesToProcess.Count -eq 0) {
            Write-OK "$PovKey — nothing to process"
            $TotalSkipped += $AllNodes.Count
            continue
        }

        Write-Info "$($NodesToProcess.Count) nodes to process in $PovKey"

        # ── Step 5: Process in batches ──
        $Batches = [System.Collections.Generic.List[object[]]]::new()
        for ($i = 0; $i -lt $NodesToProcess.Count; $i += $BatchSize) {
            $End = [Math]::Min($i + $BatchSize, $NodesToProcess.Count)
            $Batch = @($NodesToProcess[$i..($End - 1)])
            $Batches.Add($Batch)
        }

        Write-Info "$($Batches.Count) batch(es) of up to $BatchSize nodes"

        $BatchNum = 0
        foreach ($Batch in $Batches) {
            $BatchNum++
            $NodeIds = ($Batch | ForEach-Object { $_.id }) -join ', '
            Write-Step "Batch $BatchNum/$($Batches.Count): $NodeIds"

            # Build node context for the prompt
            $NodeContext = foreach ($Node in $Batch) {
                $Entry = [ordered]@{
                    id          = $Node.id
                    pov         = $PovKey
                    label       = $Node.label
                    description = $Node.description
                }
                if ($Node.PSObject.Properties['category']) {
                    $Entry['category'] = $Node.category
                }
                # Include interpretations for cross-cutting nodes
                if ($PovKey -eq 'situations' -and $Node.PSObject.Properties['interpretations']) {
                    $Entry['interpretations'] = $Node.interpretations
                }
                $Entry
            }

            $NodeJson = $NodeContext | ConvertTo-Json -Depth 10

            $FullPrompt = @"
$SystemPrompt

--- INPUT NODES ---
$NodeJson

$SchemaPrompt
"@

            # ── DryRun: show first batch prompt and exit ──
            if ($DryRun) {
                Write-Host ''
                Write-Host '=== PROMPT PREVIEW (first batch) ===' -ForegroundColor Cyan
                Write-Host ''
                # Show system prompt (truncated)
                $Lines = $SystemPrompt -split "`n"
                if ($Lines.Count -gt 15) {
                    Write-Host ($Lines[0..14] -join "`n") -ForegroundColor DarkGray
                    Write-Host "  ... ($($Lines.Count) total lines)" -ForegroundColor DarkGray
                } else {
                    Write-Host $SystemPrompt -ForegroundColor DarkGray
                }
                Write-Host ''
                Write-Host '--- INPUT NODES ---' -ForegroundColor Yellow
                Write-Host $NodeJson -ForegroundColor White
                Write-Host ''
                Write-Host '--- SCHEMA ---' -ForegroundColor Yellow
                Write-Host ($SchemaPrompt.Substring(0, [Math]::Min(500, $SchemaPrompt.Length))) -ForegroundColor DarkGray
                Write-Host ''
                Write-Host "Total prompt length: ~$($FullPrompt.Length) chars (~$([Math]::Round($FullPrompt.Length / 4)) tokens est.)" -ForegroundColor Cyan
                Write-Host "Nodes in this batch: $($Batch.Count)" -ForegroundColor Cyan
                Write-Host "Total batches needed: $($Batches.Count) across $($PovFiles.Count) file(s)" -ForegroundColor Cyan
                return
            }

            # ── Call AI API ──
            $Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            try {
                $Result = Invoke-AIApi `
                    -Prompt $FullPrompt `
                    -Model $Model `
                    -ApiKey $ResolvedKey `
                    -Temperature $Temperature `
                    -MaxTokens 16384 `
                    -JsonMode `
                    -TimeoutSec 120
            } catch {
                Write-Fail "API call failed for batch $BatchNum ($($Batch.Count) nodes) using model '$Model': $($_.Exception.Message)"
                Write-Info 'Check that your API key is valid and you have not exceeded your quota. Re-run with -Verbose for details.'
                $TotalFailed += $Batch.Count
                continue
            }
            $Stopwatch.Stop()
            Write-Info "API response in $([Math]::Round($Stopwatch.Elapsed.TotalSeconds, 1))s"

            # ── Parse response ──
            $ResponseText = $Result.Text -replace '^\s*```json\s*', '' -replace '\s*```\s*$', ''
            try {
                $Attributes = $ResponseText | ConvertFrom-Json -Depth 20
            } catch {
                Write-Warn "JSON parse failed, attempting repair..."
                $Repaired = Repair-TruncatedJson -Text $ResponseText
                try {
                    $Attributes = $Repaired | ConvertFrom-Json -Depth 20
                } catch {
                    Write-Fail "Could not parse API response for batch $BatchNum ($($Batch.Count) nodes) after JSON repair: $($_.Exception.Message)"
                    Write-Info 'The AI model returned malformed JSON. Try re-running the batch or using a different -Model.'
                    $TotalFailed += $Batch.Count
                    continue
                }
            }

            # ── Apply attributes to nodes ──
            foreach ($Node in $Batch) {
                $NodeId = $Node.id
                if ($Attributes.PSObject.Properties[$NodeId]) {
                    $AttrObj = $Attributes.$NodeId

                    # Validate required fields
                    $RequiredFields = @(
                        'epistemic_type', 'rhetorical_strategy', 'assumes',
                        'falsifiability', 'audience', 'emotional_register',
                        'policy_actions', 'intellectual_lineage',
                        'steelman_vulnerability', 'possible_fallacies'
                    )
                    $Missing = @($RequiredFields | Where-Object {
                        -not $AttrObj.PSObject.Properties[$_]
                    })
                    if ($Missing.Count -gt 0) {
                        Write-Warn "$NodeId`: missing fields: $($Missing -join ', ')"
                    }

                    # Find the node in the original file data and set attributes
                    $OrigNode = $FileData.nodes | Where-Object { $_.id -eq $NodeId }
                    if ($OrigNode) {
                        if ($OrigNode.PSObject.Properties['graph_attributes']) {
                            $OrigNode.graph_attributes = $AttrObj
                        } else {
                            $OrigNode | Add-Member -NotePropertyName 'graph_attributes' -NotePropertyValue $AttrObj
                        }
                        $TotalProcessed++
                        Write-OK "$NodeId"
                    }
                } else {
                    Write-Warn "$NodeId`: not found in API response"
                    $TotalFailed++
                }
            }
        }

        # ── Step 6: Write updated file ──
        if ($TotalProcessed -gt 0 -or $Force) {
            if ($PSCmdlet.ShouldProcess($FilePath, 'Write updated taxonomy file')) {
                # Update last_modified
                $FileData.last_modified = (Get-Date).ToString('yyyy-MM-dd')
                $Json = $FileData | ConvertTo-Json -Depth 20
                try {
                    Set-Content -Path $FilePath -Value $Json -Encoding UTF8
                    Write-OK "Saved $PovKey ($FilePath)"
                }
                catch {
                    Write-Fail "Failed to write $PovKey taxonomy file — $($_.Exception.Message)"
                    Write-Info "Attributes were extracted but NOT saved to disk."
                    throw
                }
            }
        }
    }

    # ── Summary ──
    Write-Host ''
    Write-Host '=== Attribute Extraction Complete ===' -ForegroundColor Cyan
    Write-Host "  Processed:  $TotalProcessed nodes" -ForegroundColor Green
    Write-Host "  Skipped:    $TotalSkipped nodes (already had attributes)" -ForegroundColor Yellow
    Write-Host "  Failed:     $TotalFailed nodes" -ForegroundColor $(if ($TotalFailed -gt 0) { 'Red' } else { 'Green' })
    Write-Host ''
}
