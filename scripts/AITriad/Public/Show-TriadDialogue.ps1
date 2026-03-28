# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Show-TriadDialogue {
    <#
    .SYNOPSIS
        Simulates a structured three-agent debate grounded in the AI Triad taxonomy.
    .DESCRIPTION
        Runs a multi-round debate between Prometheus (accelerationist), Sentinel (safetyist),
        and Cassandra (skeptic). Each agent's arguments are grounded in taxonomy nodes and edges.
        Produces opening statements, N debate rounds, and a synthesis. Output is compatible
        with the taxonomy-editor DebateTab.
    .PARAMETER Topic
        The debate topic (mandatory).
    .PARAMETER Rounds
        Number of debate rounds after opening statements (1-10, default 3).
    .PARAMETER OutputFile
        Optional path to write the debate JSON. If omitted, writes to debates/debate-<guid>.json.
    .PARAMETER Model
        AI model override. Defaults to 'gemini-2.5-flash'.
    .PARAMETER ApiKey
        AI API key override.
    .PARAMETER RepoRoot
        Path to the repository root.
    .EXAMPLE
        Show-TriadDialogue "Should AI be regulated like a public utility?" -Rounds 2
    .EXAMPLE
        Show-TriadDialogue "Is open-source AI safer than closed-source?" -OutputFile debate.json
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [string]$Topic,

        [ValidateRange(1, 10)]
        [int]$Rounds = 3,

        [string]$OutputFile,

        [string]$Model = 'gemini-2.5-flash',

        [string]$ApiKey,

        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── Step 1: Validate environment ──────────────────────────────────────────
    Write-Step 'Validating environment'

    $Backend = if     ($Model -match '^gemini') { 'gemini' }
               elseif ($Model -match '^claude') { 'claude' }
               elseif ($Model -match '^groq')   { 'groq'   }
               else                             { 'gemini'  }
    $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend
    if ([string]::IsNullOrWhiteSpace($ResolvedKey)) {
        Write-Fail 'No API key found. Set GEMINI_API_KEY, ANTHROPIC_API_KEY, or AI_API_KEY.'
        throw 'No API key configured'
    }

    # ── Step 2: Define agents ─────────────────────────────────────────────────
    $Agents = @(
        @{
            Name        = 'Prometheus'
            Speaker     = 'prometheus'
            PovKey      = 'accelerationist'
            PovLabel    = 'Accelerationist'
            Description = 'You champion rapid AI development and deployment. You believe AI progress is essential for human flourishing, that open development is safer than restriction, and that the benefits vastly outweigh the risks. You distrust regulatory gatekeeping and favor empirical, results-oriented approaches.'
        }
        @{
            Name        = 'Sentinel'
            Speaker     = 'sentinel'
            PovKey      = 'safetyist'
            PovLabel    = 'Safetyist'
            Description = 'You prioritize AI safety, alignment research, and careful risk mitigation. You believe powerful AI poses existential risks that demand precaution, that capability gains outpace safety understanding, and that deployment should wait until systems are proven safe. You favor regulation and mandatory safety testing.'
        }
        @{
            Name        = 'Cassandra'
            Speaker     = 'cassandra'
            PovKey      = 'skeptic'
            PovLabel    = 'Skeptic'
            Description = 'You question AI hype and emphasize present-day harms. You believe current AI systems are less capable than claimed, that the real risks are economic displacement, bias, and power concentration, not sci-fi scenarios. You demand empirical evidence over speculation and focus on protecting workers and communities.'
        }
    )

    # ── Step 3: Build POV context per agent ───────────────────────────────────
    Write-Step 'Building POV context for agents'

    $TaxDir = Get-TaxonomyDir

    # Load all nodes
    $AllNodes = @{}
    foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')) {
        $FilePath = Join-Path $TaxDir "$PovKey.json"
        if (-not (Test-Path $FilePath)) { continue }
        $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json -Depth 20
        foreach ($Node in $FileData.nodes) {
            $AllNodes[$Node.id] = @{
                POV         = $PovKey
                Label       = $Node.label
                Description = if ($Node.PSObject.Properties['description']) { $Node.description } else { '' }
                Category    = if ($Node.PSObject.Properties['category']) { $Node.category } else { '' }
            }
        }
    }

    # Load edges
    $EdgesPath = Join-Path $TaxDir 'edges.json'
    $AllEdges  = @()
    $NodeDegree = @{}
    if (Test-Path $EdgesPath) {
        $EdgesData = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json -Depth 20
        $AllEdges  = @($EdgesData.edges | Where-Object { $_.status -eq 'approved' })
        foreach ($Edge in $AllEdges) {
            if (-not $NodeDegree.ContainsKey($Edge.source)) { $NodeDegree[$Edge.source] = 0 }
            if (-not $NodeDegree.ContainsKey($Edge.target)) { $NodeDegree[$Edge.target] = 0 }
            $NodeDegree[$Edge.source]++
            $NodeDegree[$Edge.target]++
        }
    }

    # Build per-agent context: top 30 nodes by degree + their edges + relevant cc-nodes
    $AgentContexts = @{}
    foreach ($Agent in $Agents) {
        $PovKey = $Agent.PovKey
        $PovNodeIds = @($AllNodes.Keys | Where-Object { $AllNodes[$_].POV -eq $PovKey })

        # Sort by degree, take top 30
        $TopNodes = @($PovNodeIds |
            Sort-Object { if ($NodeDegree.ContainsKey($_)) { $NodeDegree[$_] } else { 0 } } -Descending |
            Select-Object -First 30)

        # Add relevant cc-nodes (connected to these top nodes)
        $TopNodeSet = [System.Collections.Generic.HashSet[string]]::new()
        foreach ($NId in $TopNodes) { [void]$TopNodeSet.Add($NId) }

        $CcNodeIds = [System.Collections.Generic.HashSet[string]]::new()
        foreach ($Edge in $AllEdges) {
            if ($TopNodeSet.Contains($Edge.source) -and $AllNodes.ContainsKey($Edge.target) -and $AllNodes[$Edge.target].POV -eq 'cross-cutting') {
                [void]$CcNodeIds.Add($Edge.target)
            }
            if ($TopNodeSet.Contains($Edge.target) -and $AllNodes.ContainsKey($Edge.source) -and $AllNodes[$Edge.source].POV -eq 'cross-cutting') {
                [void]$CcNodeIds.Add($Edge.source)
            }
        }

        # Build context string
        $ContextBuilder = [System.Text.StringBuilder]::new()
        [void]$ContextBuilder.AppendLine("Top $($TopNodes.Count) $PovKey nodes (by graph connectivity):")
        foreach ($NId in $TopNodes) {
            $N = $AllNodes[$NId]
            [void]$ContextBuilder.AppendLine("  - $NId [$($N.Category)]: $($N.Label) — $($N.Description)")
        }

        if ($CcNodeIds.Count -gt 0) {
            [void]$ContextBuilder.AppendLine("`nRelevant cross-cutting nodes:")
            foreach ($CcId in $CcNodeIds | Select-Object -First 10) {
                $N = $AllNodes[$CcId]
                [void]$ContextBuilder.AppendLine("  - ${CcId}: $($N.Label) — $($N.Description)")
            }
        }

        # Key edges involving these nodes
        $RelevantEdges = @($AllEdges | Where-Object {
            $TopNodeSet.Contains($_.source) -or $TopNodeSet.Contains($_.target)
        } | Select-Object -First 50)

        if ($RelevantEdges.Count -gt 0) {
            [void]$ContextBuilder.AppendLine("`nKey relationships:")
            foreach ($Edge in $RelevantEdges) {
                [void]$ContextBuilder.AppendLine("  $($Edge.source) --[$($Edge.type)]--> $($Edge.target)")
            }
        }

        # Load top 20 policies for this POV from the policy registry
        $PolicyRegistryPath = Join-Path $TaxDir 'policy_actions.json'
        if (Test-Path $PolicyRegistryPath) {
            $PolicyReg = Get-Content -Raw -Path $PolicyRegistryPath | ConvertFrom-Json -Depth 20
            if ($PolicyReg.policies) {
                $PovPolicies = @($PolicyReg.policies |
                    Where-Object { $_.source_povs -contains $PovKey } |
                    Sort-Object { $_.member_count } -Descending |
                    Select-Object -First 20)

                if ($PovPolicies.Count -gt 0) {
                    [void]$ContextBuilder.AppendLine("`nPOLICY CONTEXT (use these pol-NNN IDs when referencing policy actions):")
                    foreach ($Pol in $PovPolicies) {
                        [void]$ContextBuilder.AppendLine("  - $($Pol.id): $($Pol.action)")
                    }
                }
            }
        }

        $AgentContexts[$Agent.Speaker] = $ContextBuilder.ToString()
    }
    Write-OK "Built context for $($Agents.Count) agents"

    # ── Step 4: Generate debate ───────────────────────────────────────────────
    $DebateId   = [guid]::NewGuid().ToString()
    $Transcript = [System.Collections.Generic.List[PSObject]]::new()

    # Helper: call LLM for a turn
    $InvokeTurn = {
        param([string]$AgentSpeaker, [string]$SystemPrompt, [string]$TranscriptSoFar, [string]$TurnType)

        $SchemaPrompt = Get-Prompt -Name 'triad-dialogue-schema'
        $TurnPrompt   = Get-Prompt -Name 'triad-dialogue-turn' -Replacements @{
            SYSTEM_PROMPT = $SystemPrompt
            TOPIC         = $Topic
            TRANSCRIPT    = $TranscriptSoFar
            SCHEMA        = $SchemaPrompt
        }

        $TurnResult = Invoke-AIApi `
            -Prompt     $TurnPrompt `
            -Model      $Model `
            -ApiKey     $ResolvedKey `
            -Temperature 0.7 `
            -MaxTokens  2048 `
            -JsonMode `
            -TimeoutSec 120 `
            -MaxRetries 3 `
            -RetryDelays @(5, 15, 45)

        if (-not $TurnResult -or -not $TurnResult.Text) {
            return $null
        }

        $ResponseText = $TurnResult.Text -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
        try {
            return $ResponseText | ConvertFrom-Json -Depth 20
        }
        catch {
            Write-Warn "Failed to parse $AgentSpeaker response — attempting repair"
            try {
                $Repaired = Repair-TruncatedJson -Text $ResponseText
                return $Repaired | ConvertFrom-Json -Depth 20
            }
            catch {
                Write-Warn "Repair failed for $AgentSpeaker"
                return [PSCustomObject]@{
                    content       = $ResponseText
                    taxonomy_refs = @()
                }
            }
        }
    }

    # Build system prompts per agent
    $SystemPrompts = @{}
    foreach ($Agent in $Agents) {
        $SystemPrompts[$Agent.Speaker] = Get-Prompt -Name 'triad-dialogue-system' -Replacements @{
            AGENT_NAME      = $Agent.Name
            POV_LABEL       = $Agent.PovLabel
            POV_DESCRIPTION = $Agent.Description
            POV_CONTEXT     = $AgentContexts[$Agent.Speaker]
        }
    }

    # Format transcript for prompt
    $FormatTranscript = {
        param($Trans)
        $Lines = [System.Text.StringBuilder]::new()
        foreach ($T in $Trans) {
            [void]$Lines.AppendLine("[$($T.speaker) — $($T.type)]")
            [void]$Lines.AppendLine($T.content)
            [void]$Lines.AppendLine()
        }
        return $Lines.ToString()
    }

    # Compress older rounds if transcript gets long
    $CompressTranscript = {
        param($Trans, [int]$MaxTokenEst)
        $FullText = (& $FormatTranscript $Trans)
        $EstTokens = [Math]::Round($FullText.Length / 4)
        if ($EstTokens -le $MaxTokenEst) {
            return $FullText
        }

        # Keep last 2 entries fully, summarize earlier ones
        $KeepFull = 6  # last 2 rounds × 3 agents
        if ($Trans.Count -le $KeepFull) {
            return $FullText
        }

        $Earlier = $Trans | Select-Object -First ($Trans.Count - $KeepFull)
        $Recent  = $Trans | Select-Object -Last $KeepFull

        $Summary = [System.Text.StringBuilder]::new()
        [void]$Summary.AppendLine("[Earlier discussion summary]")
        foreach ($T in $Earlier) {
            $Snippet = if ($T.content.Length -gt 100) { $T.content.Substring(0, 100) + '...' } else { $T.content }
            [void]$Summary.AppendLine("  $($T.speaker): $Snippet")
        }
        [void]$Summary.AppendLine()
        [void]$Summary.AppendLine("[Recent exchanges]")
        foreach ($T in $Recent) {
            [void]$Summary.AppendLine("[$($T.speaker) — $($T.type)]")
            [void]$Summary.AppendLine($T.content)
            [void]$Summary.AppendLine()
        }
        return $Summary.ToString()
    }

    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  TRIAD DIALOGUE" -ForegroundColor White
    Write-Host "  Topic: $Topic" -ForegroundColor Gray
    Write-Host "  Agents: Prometheus, Sentinel, Cassandra  |  Rounds: $Rounds" -ForegroundColor Gray
    Write-Host "$('═' * 72)" -ForegroundColor Cyan

    # ── Opening statements ────────────────────────────────────────────────────
    Write-Step 'Opening statements'

    foreach ($Agent in $Agents) {
        Write-Info "$($Agent.Name) is preparing opening statement..."
        $TranscriptText = & $FormatTranscript $Transcript
        $Response = & $InvokeTurn $Agent.Speaker $SystemPrompts[$Agent.Speaker] $TranscriptText 'opening'

        if ($Response) {
            $Content = if ($Response.PSObject.Properties['content']) { $Response.content } else { "$Response" }
            $TaxRefs = if ($Response.PSObject.Properties['taxonomy_refs']) { @($Response.taxonomy_refs) } else { @() }

            $Entry = [ordered]@{
                type          = 'opening'
                speaker       = $Agent.Speaker
                content       = $Content
                taxonomy_refs = $TaxRefs
                policy_refs   = @()
                id            = [guid]::NewGuid().ToString()
                timestamp     = (Get-Date -Format 'o')
            }
            $Transcript.Add([PSCustomObject]$Entry)

            # Display
            $NameColor = switch ($Agent.Speaker) {
                'prometheus' { 'Blue' }
                'sentinel'   { 'Green' }
                'cassandra'  { 'Yellow' }
            }
            Write-Host "`n  $($Agent.Name.ToUpper()) (Opening):" -ForegroundColor $NameColor
            Write-Host "  $Content" -ForegroundColor White
            if ($TaxRefs.Count -gt 0) {
                $RefIds = ($TaxRefs | ForEach-Object { $_.node_id }) -join ', '
                Write-Host "  Refs: $RefIds" -ForegroundColor DarkGray
            }
        }
        else {
            Write-Warn "$($Agent.Name) failed to produce an opening statement"
        }
    }

    # ── Debate rounds ─────────────────────────────────────────────────────────
    for ($Round = 1; $Round -le $Rounds; $Round++) {
        Write-Step "Round $Round of $Rounds"

        foreach ($Agent in $Agents) {
            Write-Info "$($Agent.Name) is formulating response..."
            $TranscriptText = & $CompressTranscript $Transcript 8000
            $Response = & $InvokeTurn $Agent.Speaker $SystemPrompts[$Agent.Speaker] $TranscriptText 'argument'

            if ($Response) {
                $Content = if ($Response.PSObject.Properties['content']) { $Response.content } else { "$Response" }
                $TaxRefs = if ($Response.PSObject.Properties['taxonomy_refs']) { @($Response.taxonomy_refs) } else { @() }

                $Entry = [ordered]@{
                    type          = 'statement'
                    speaker       = $Agent.Speaker
                    content       = $Content
                    taxonomy_refs = $TaxRefs
                    policy_refs   = @()
                    id            = [guid]::NewGuid().ToString()
                    timestamp     = (Get-Date -Format 'o')
                    metadata      = @{ round = $Round }
                }
                $Transcript.Add([PSCustomObject]$Entry)

                $NameColor = switch ($Agent.Speaker) {
                    'prometheus' { 'Blue' }
                    'sentinel'   { 'Green' }
                    'cassandra'  { 'Yellow' }
                }
                Write-Host "`n  $($Agent.Name.ToUpper()) (Round $Round):" -ForegroundColor $NameColor
                Write-Host "  $Content" -ForegroundColor White
                if ($TaxRefs.Count -gt 0) {
                    $RefIds = ($TaxRefs | ForEach-Object { $_.node_id }) -join ', '
                    Write-Host "  Refs: $RefIds" -ForegroundColor DarkGray
                }
            }
            else {
                Write-Warn "$($Agent.Name) failed to respond in round $Round"
            }
        }
    }

    # ── Synthesis ─────────────────────────────────────────────────────────────
    Write-Step 'Generating synthesis'

    $FullTranscriptText = & $FormatTranscript $Transcript
    $SynthesisPrompt = Get-Prompt -Name 'triad-dialogue-synthesis' -Replacements @{
        TOPIC      = $Topic
        TRANSCRIPT = $FullTranscriptText
    }

    $Synthesis = $null
    try {
        $SynthResult = Invoke-AIApi `
            -Prompt     $SynthesisPrompt `
            -Model      $Model `
            -ApiKey     $ResolvedKey `
            -Temperature 0.3 `
            -MaxTokens  4096 `
            -JsonMode `
            -TimeoutSec 120 `
            -MaxRetries 3 `
            -RetryDelays @(5, 15, 45)

        if ($SynthResult -and $SynthResult.Text) {
            $SynthText = $SynthResult.Text -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
            $Synthesis = $SynthText | ConvertFrom-Json -Depth 20
            Write-OK 'Synthesis complete'
        }
    }
    catch {
        Write-Warn "Synthesis generation failed for topic '$Topic' using model '$Model': $($_.Exception.Message)"
        Write-Info 'The dialogue transcript was generated but synthesis could not be produced. Check your API key/quota and try running synthesis separately.'
    }

    # Display synthesis
    if ($Synthesis) {
        Write-Host "`n$('─' * 72)" -ForegroundColor Cyan
        Write-Host '  SYNTHESIS' -ForegroundColor White
        Write-Host "$('─' * 72)" -ForegroundColor Cyan

        if ($Synthesis.PSObject.Properties['summary']) {
            Write-Host "`n  $($Synthesis.summary)" -ForegroundColor White
        }

        if ($Synthesis.PSObject.Properties['areas_of_agreement'] -and $Synthesis.areas_of_agreement) {
            Write-Host "`n  Areas of Agreement:" -ForegroundColor Green
            foreach ($A in @($Synthesis.areas_of_agreement)) {
                Write-Host "    - $A" -ForegroundColor Gray
            }
        }

        if ($Synthesis.PSObject.Properties['areas_of_disagreement'] -and $Synthesis.areas_of_disagreement) {
            Write-Host "`n  Areas of Disagreement:" -ForegroundColor Red
            foreach ($D in @($Synthesis.areas_of_disagreement)) {
                Write-Host "    - $D" -ForegroundColor Gray
            }
        }

        if ($Synthesis.PSObject.Properties['unresolved_questions'] -and $Synthesis.unresolved_questions) {
            Write-Host "`n  Unresolved Questions:" -ForegroundColor Yellow
            foreach ($Q in @($Synthesis.unresolved_questions)) {
                Write-Host "    - $Q" -ForegroundColor Gray
            }
        }
    }

    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan

    # ── Build debate JSON (compatible with taxonomy-editor DebateTab) ─────────
    $DebateData = [ordered]@{
        id              = $DebateId
        title           = $Topic
        created_at      = (Get-Date -Format 'o')
        updated_at      = (Get-Date -Format 'o')
        phase           = 'complete'
        topic           = [ordered]@{
            original = $Topic
            refined  = $Topic
            final    = $Topic
        }
        active_povers   = @('prometheus', 'sentinel', 'cassandra')
        user_is_pover   = $false
        transcript      = @($Transcript)
        rounds          = $Rounds
        source          = 'Show-TriadDialogue'
    }

    if ($Synthesis) {
        $DebateData['synthesis'] = $Synthesis
    }

    # Write to file
    $TargetFile = if ($OutputFile) { $OutputFile }
                  else {
                      $DebatesDir = Get-DebatesDir
                      if (-not (Test-Path $DebatesDir)) {
                          $null = New-Item -ItemType Directory -Path $DebatesDir -Force
                      }
                      Join-Path $DebatesDir "debate-$DebateId.json"
                  }

    try {
        $Json = $DebateData | ConvertTo-Json -Depth 20
        Set-Content -Path $TargetFile -Value $Json -Encoding UTF8
        Write-OK "Debate saved to: $TargetFile"
    }
    catch {
        Write-Warn "Failed to save debate to '$TargetFile': $($_.Exception.Message)"
        Write-Info 'The debate completed but could not be persisted. Check file permissions and disk space, then re-run with -SaveTo to retry.'
    }

    return $DebateData
}
