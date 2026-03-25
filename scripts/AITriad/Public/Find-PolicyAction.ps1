# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Find-PolicyAction {
    <#
    .SYNOPSIS
        Uses AI to identify concrete policy actions implied by taxonomy nodes.
    .DESCRIPTION
        Sends taxonomy nodes to an LLM to generate specific, actionable policy
        recommendations that each node's claim supports or implies. Results are
        stored in each node's graph_attributes.policy_actions field.

        Each policy action includes a concrete action statement (5-15 words) and
        a framing explanation connecting the node's claim to the policy lever.

        Nodes that are purely theoretical or definitional get an empty array.
    .PARAMETER POV
        Process only this POV file. If omitted, processes all POV files and cross-cutting.
    .PARAMETER Id
        One or more node IDs to analyse. If omitted, analyses all nodes in scope.
    .PARAMETER BatchSize
        Number of nodes to process per API call. Default: 8.
    .PARAMETER Model
        AI model to use.
    .PARAMETER ApiKey
        AI API key. If omitted, resolved via backend-specific env var or AI_API_KEY.
    .PARAMETER Temperature
        Sampling temperature (0.0-1.0). Default: 0.2.
    .PARAMETER DryRun
        Build and display the prompt for the first batch without calling the API.
    .PARAMETER Force
        Re-analyse nodes that already have policy_actions.
    .PARAMETER RepoRoot
        Path to the repository root.
    .PARAMETER PassThru
        Return a summary object.
    .EXAMPLE
        Find-PolicyAction -DryRun
    .EXAMPLE
        Find-PolicyAction -POV accelerationist
    .EXAMPLE
        Find-PolicyAction -Id acc-goals-001, saf-goals-001
    .EXAMPLE
        Find-PolicyAction -Force -Model 'groq-llama-4-scout'
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')]
        [string]$POV = '',

        [string[]]$Id,

        [ValidateRange(1, 20)]
        [int]$BatchSize = 8,

        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [string]$Model = '',

        [string]$ApiKey = '',

        [ValidateRange(0.0, 1.0)]
        [double]$Temperature = 0.2,

        [switch]$DryRun,

        [switch]$Force,

        [string]$RepoRoot = $script:RepoRoot,

        [switch]$PassThru
    )

    Set-StrictMode -Version Latest

    if (-not $Model) {
        $Model = if ($env:AI_MODEL) { $env:AI_MODEL } else { 'gemini-2.5-flash' }
    }

    # ── Validate environment ──
    Write-Step 'Validating environment'

    $TaxDir = Join-Path $RepoRoot 'taxonomy' 'Origin'
    if (-not (Test-Path $TaxDir)) {
        Write-Fail "Taxonomy directory not found: $TaxDir"
        throw 'Taxonomy directory not found'
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

    # ── Determine which files to process ──
    $PovFiles = @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')
    if ($POV) { $PovFiles = @($POV) }

    Write-OK "Processing: $($PovFiles -join ', ')"

    # ── Load prompts ──
    $SystemPrompt = Get-Prompt -Name 'policy-actions'
    $SchemaPrompt = Get-Prompt -Name 'policy-actions-schema'

    # ── Process each taxonomy file ──
    $TotalProcessed = 0
    $TotalSkipped   = 0
    $TotalFailed    = 0
    $TotalActions   = 0

    foreach ($PovKey in $PovFiles) {
        $FilePath = Join-Path $TaxDir "$PovKey.json"
        if (-not (Test-Path $FilePath)) {
            Write-Warn "File not found, skipping: $FilePath"
            continue
        }

        Write-Step "Loading $PovKey"
        $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json

        $AllNodes = @($FileData.nodes)

        # Filter by -Id if specified
        if ($Id -and $Id.Count -gt 0) {
            $AllNodes = @($AllNodes | Where-Object { $_.id -in $Id })
        }

        # Skip nodes that already have policy_actions unless -Force
        if ($Force) {
            $NodesToProcess = $AllNodes
        }
        else {
            $NodesToProcess = @($AllNodes | Where-Object {
                -not $_.PSObject.Properties['graph_attributes'] -or
                $null -eq $_.graph_attributes -or
                -not $_.graph_attributes.PSObject.Properties['policy_actions']
            })
        }

        $AlreadyDone = $AllNodes.Count - $NodesToProcess.Count
        if ($AlreadyDone -gt 0) {
            Write-Info "$AlreadyDone nodes already analysed (use -Force to re-analyse)"
        }

        if ($NodesToProcess.Count -eq 0) {
            Write-OK "$PovKey — nothing to process"
            $TotalSkipped += $AllNodes.Count
            continue
        }

        Write-Info "$($NodesToProcess.Count) nodes to analyse in $PovKey"

        # ── Batch processing ──
        $Batches = [System.Collections.Generic.List[object[]]]::new()
        for ($i = 0; $i -lt $NodesToProcess.Count; $i += $BatchSize) {
            $End   = [Math]::Min($i + $BatchSize, $NodesToProcess.Count)
            $Batch = @($NodesToProcess[$i..($End - 1)])
            $Batches.Add($Batch)
        }

        Write-Info "$($Batches.Count) batch(es) of up to $BatchSize nodes"

        $BatchNum = 0
        foreach ($Batch in $Batches) {
            $BatchNum++
            $NodeIds = ($Batch | ForEach-Object { $_.id }) -join ', '
            Write-Step "Batch $BatchNum/$($Batches.Count): $NodeIds"

            # Build node context
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
                if ($PovKey -eq 'cross-cutting' -and $Node.PSObject.Properties['interpretations']) {
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

            # ── DryRun ──
            if ($DryRun) {
                Write-Host ''
                Write-Host '=== PROMPT PREVIEW (first batch) ===' -ForegroundColor Cyan
                Write-Host ''
                $Lines = $SystemPrompt -split "`n"
                if ($Lines.Count -gt 15) {
                    Write-Host ($Lines[0..14] -join "`n") -ForegroundColor DarkGray
                    Write-Host "  ... ($($Lines.Count) total lines)" -ForegroundColor DarkGray
                }
                else {
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
            }
            catch {
                Write-Fail "API call failed for batch $BatchNum`: $_"
                $TotalFailed += $Batch.Count
                continue
            }
            $Stopwatch.Stop()
            Write-Info "API response in $([Math]::Round($Stopwatch.Elapsed.TotalSeconds, 1))s"

            # ── Parse response ──
            $ResponseText = $Result.Text -replace '^\s*```json\s*', '' -replace '\s*```\s*$', ''
            try {
                $ActionData = $ResponseText | ConvertFrom-Json -Depth 20
            }
            catch {
                Write-Warn 'JSON parse failed, attempting repair...'
                $Repaired = Repair-TruncatedJson -Text $ResponseText
                try {
                    $ActionData = $Repaired | ConvertFrom-Json -Depth 20
                }
                catch {
                    Write-Fail "Could not parse response for batch $BatchNum"
                    $TotalFailed += $Batch.Count
                    continue
                }
            }

            # ── Apply policy actions to nodes ──
            foreach ($Node in $Batch) {
                $NodeId = $Node.id
                if (-not $ActionData.PSObject.Properties[$NodeId]) {
                    Write-Warn "$NodeId`: not found in API response"
                    $TotalFailed++
                    continue
                }

                $NodeResult = $ActionData.$NodeId
                $Actions    = @()
                if ($NodeResult.PSObject.Properties['policy_actions'] -and $NodeResult.policy_actions) {
                    $Actions = @($NodeResult.policy_actions)
                }

                # Ensure the node has graph_attributes
                $OrigNode = $FileData.nodes | Where-Object { $_.id -eq $NodeId }
                if (-not $OrigNode) {
                    Write-Warn "$NodeId`: not found in taxonomy file"
                    $TotalFailed++
                    continue
                }

                if (-not $OrigNode.PSObject.Properties['graph_attributes'] -or $null -eq $OrigNode.graph_attributes) {
                    $OrigNode | Add-Member -NotePropertyName 'graph_attributes' -NotePropertyValue ([PSCustomObject]@{})
                }

                if ($OrigNode.graph_attributes.PSObject.Properties['policy_actions']) {
                    $OrigNode.graph_attributes.policy_actions = $Actions
                }
                else {
                    $OrigNode.graph_attributes | Add-Member -NotePropertyName 'policy_actions' -NotePropertyValue $Actions
                }

                $TotalProcessed++
                $TotalActions += $Actions.Count

                if ($Actions.Count -eq 0) {
                    Write-OK "$NodeId — no policy actions (theoretical/definitional)"
                }
                else {
                    $ActionNames = ($Actions | ForEach-Object { $_.action.Substring(0, [Math]::Min(50, $_.action.Length)) }) -join '; '
                    Write-OK "$NodeId — $($Actions.Count) action(s): $ActionNames"
                }
            }
        }

        # ── Write updated file ──
        if ($TotalProcessed -gt 0 -or $Force) {
            if ($PSCmdlet.ShouldProcess($FilePath, 'Write updated taxonomy file with policy actions')) {
                $FileData.last_modified = (Get-Date).ToString('yyyy-MM-dd')
                $Json = $FileData | ConvertTo-Json -Depth 20
                try {
                    Set-Content -Path $FilePath -Value $Json -Encoding UTF8
                    Write-OK "Saved $PovKey ($FilePath)"
                }
                catch {
                    Write-Fail "Failed to write $PovKey taxonomy file — $($_.Exception.Message)"
                    throw
                }
            }
        }
    }

    # ── Summary ──
    Write-Host ''
    Write-Host '=== Policy Action Extraction Complete ===' -ForegroundColor Cyan
    Write-Host "  Analysed:        $TotalProcessed nodes" -ForegroundColor Green
    Write-Host "  Skipped:         $TotalSkipped nodes (already analysed)" -ForegroundColor Yellow
    Write-Host "  Failed:          $TotalFailed nodes" -ForegroundColor $(if ($TotalFailed -gt 0) { 'Red' } else { 'Green' })
    Write-Host "  Actions found:   $TotalActions across all nodes" -ForegroundColor White
    Write-Host ''

    if ($PassThru) {
        [PSCustomObject]@{
            Processed    = $TotalProcessed
            Skipped      = $TotalSkipped
            Failed       = $TotalFailed
            ActionsFound = $TotalActions
        }
    }
}
