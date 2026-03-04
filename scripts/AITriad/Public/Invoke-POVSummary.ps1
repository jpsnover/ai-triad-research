function Invoke-POVSummary {
    <#
    .SYNOPSIS
        Processes a single source document through AI to extract a structured
        POV summary mapped to the AI Triad taxonomy.
    .DESCRIPTION
        Implements the core AI summarization loop for ONE document:
            1. Loads sources/<doc-id>/snapshot.md
            2. Loads all four taxonomy files + TAXONOMY_VERSION
            3. Builds a structured prompt (system + taxonomy + document)
            4. Calls the AI API (Gemini, Claude, or Groq)
            5. Validates and writes summaries/<doc-id>.json
            6. Updates sources/<doc-id>/metadata.json (summary_status, summary_version)
            7. Runs basic conflict detection
    .PARAMETER DocId
        The document slug ID, e.g. "altman-2024-agi-path".
    .PARAMETER RepoRoot
        Path to the root of the ai-triad-research repository.
        Defaults to the module-resolved repo root.
    .PARAMETER ApiKey
        AI API key. If omitted, resolved via backend-specific env var or AI_API_KEY.
    .PARAMETER Model
        AI model to use. Defaults to "gemini-3.1-flash-lite-preview".
        Supports Gemini, Claude, and Groq backends.
    .PARAMETER Temperature
        Sampling temperature (0.0-1.0). Default: 0.1
    .PARAMETER DryRun
        Build and display the prompt, but do NOT call the API or write any files.
    .PARAMETER Force
        Re-process the document even if summary_status is already "current".
    .EXAMPLE
        Invoke-POVSummary -DocId "altman-2024-agi-path"
    .EXAMPLE
        Invoke-POVSummary -DocId "altman-2024-agi-path" -DryRun
    .EXAMPLE
        Invoke-POVSummary -DocId "lecun-2024-critique" -Model "gemini-2.5-flash-lite"
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory, Position = 0, HelpMessage = "Document slug ID, e.g. altman-2024-agi-path")]
        [string]$DocId,

        [string]$RepoRoot    = $script:RepoRoot,

        [string]$ApiKey      = '',

        [ValidateSet(
            'gemini-3.1-flash-lite-preview',
            'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro',
            'claude-opus-4', 'claude-sonnet-4-5', 'claude-haiku-3.5',
            'groq-llama-3.3-70b', 'groq-llama-4-scout'
        )]
        [string]$Model       = "gemini-3.1-flash-lite-preview",

        [ValidateRange(0.0, 1.0)]
        [double]$Temperature = 0.1,

        [switch]$DryRun,
        [switch]$Force
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # -- STEP 0 — Validate inputs and resolve paths ---------------------------
    Write-Step "Validating inputs"

    $paths = @{
        Root         = $RepoRoot
        TaxonomyDir  = Join-Path $RepoRoot "taxonomy" "Origin"
        SourcesDir   = Join-Path $RepoRoot "sources"
        SummariesDir = Join-Path $RepoRoot "summaries"
        ConflictsDir = Join-Path $RepoRoot "conflicts"
        VersionFile  = Join-Path $RepoRoot "TAXONOMY_VERSION"
        DocDir       = Join-Path $RepoRoot "sources" $DocId
        SnapshotFile = Join-Path $RepoRoot "sources" $DocId "snapshot.md"
        MetadataFile = Join-Path $RepoRoot "sources" $DocId "metadata.json"
        SummaryFile  = Join-Path $RepoRoot "summaries" "$DocId.json"
    }

    if (-not (Test-Path $paths.Root)) {
        Write-Fail "Repo root not found: $($paths.Root)"
        throw "Repo root not found: $($paths.Root)"
    }

    if (-not (Test-Path $paths.DocDir)) {
        Write-Fail "Document folder not found: $($paths.DocDir)"
        Write-Info "Expected: sources/$DocId/"
        throw "Document folder not found: sources/$DocId/"
    }

    if (-not (Test-Path $paths.SnapshotFile)) {
        Write-Fail "snapshot.md not found: $($paths.SnapshotFile)"
        throw "snapshot.md not found for $DocId"
    }

    if (-not (Test-Path $paths.MetadataFile)) {
        Write-Fail "metadata.json not found: $($paths.MetadataFile)"
        throw "metadata.json not found for $DocId"
    }

    $metadata = Get-Content $paths.MetadataFile -Raw | ConvertFrom-Json
    if ((-not $Force) -and (-not $DryRun) -and ($metadata.summary_status -eq "current")) {
        Write-Warn "Summary is already current (taxonomy v$($metadata.summary_version))."
        Write-Info "Use -Force to re-process anyway."
        return
    }

    foreach ($dir in @($paths.SummariesDir, $paths.ConflictsDir)) {
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    }

    if (-not $DryRun) {
        $Backend = if     ($Model -match '^gemini') { 'gemini' }
                   elseif ($Model -match '^claude') { 'claude' }
                   elseif ($Model -match '^groq')   { 'groq'   }
                   else                             { 'gemini'  }
        $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend
        if ([string]::IsNullOrWhiteSpace($ResolvedKey)) {
            $EnvHint = switch ($Backend) {
                'gemini' { 'GEMINI_API_KEY' }
                'claude' { 'ANTHROPIC_API_KEY' }
                'groq'   { 'GROQ_API_KEY' }
                default  { 'AI_API_KEY' }
            }
            Write-Fail "No API key found for $Backend backend."
            Write-Info "Set $EnvHint or AI_API_KEY, or pass -ApiKey."
            throw "No API key found for $Backend backend."
        }
        $ApiKey = $ResolvedKey
    }

    Write-OK "Doc ID      : $DocId"
    Write-OK "Repo root   : $RepoRoot"
    Write-OK "Model       : $Model"
    Write-OK "Temperature : $Temperature"
    if ($DryRun) { Write-Warn "DRY RUN — no API call, no file writes" }

    # -- STEP 1 — Load taxonomy version ---------------------------------------
    Write-Step "Loading taxonomy"

    if (-not (Test-Path $paths.VersionFile)) {
        Write-Fail "TAXONOMY_VERSION file not found at: $($paths.VersionFile)"
        throw "TAXONOMY_VERSION not found"
    }
    $taxonomyVersion = (Get-Content $paths.VersionFile -Raw).Trim()
    Write-OK "Taxonomy version: $taxonomyVersion"

    # -- STEP 2 — Load all four taxonomy files --------------------------------
    $taxonomyFiles   = @("accelerationist.json", "safetyist.json", "skeptic.json", "cross-cutting.json")
    $taxonomyContext = [ordered]@{}

    foreach ($file in $taxonomyFiles) {
        $filePath = Join-Path $paths.TaxonomyDir $file
        if (-not (Test-Path $filePath)) {
            Write-Fail "Taxonomy file missing: $filePath"
            throw "Taxonomy file missing: $file"
        }
        $taxonomyContext[$file] = Get-Content $filePath -Raw | ConvertFrom-Json
        $nodeCount = $taxonomyContext[$file].nodes.Count
        Write-OK "  $file ($nodeCount nodes)"
    }

    $taxonomyJson = $taxonomyContext | ConvertTo-Json -Depth 20 -Compress:$false

    # -- STEP 3 — Load the document snapshot ----------------------------------
    Write-Step "Loading document snapshot"

    $snapshotText    = Get-Content $paths.SnapshotFile -Raw
    $snapshotLength  = $snapshotText.Length
    $estimatedTokens = [int]($snapshotLength / 4)

    Write-OK "Snapshot loaded: $snapshotLength chars (~$estimatedTokens tokens estimated)"
    Write-Info "Title from metadata: $($metadata.title)"
    Write-Info "POV tags in metadata: $($metadata.pov_tags -join ', ')"

    if ($estimatedTokens -gt 100000) {
        Write-Warn "Document is very long (~$estimatedTokens tokens). Consider chunking if the API call fails."
    }

    # -- STEP 4 — Build the prompt --------------------------------------------
    Write-Step "Building prompt"

    $outputSchema = @'
{
  "pov_summaries": {
    "accelerationist": {
      "key_points": [
        {
          "stance": "<one of: strongly_aligned | aligned | neutral | opposed | strongly_opposed | not_applicable>",
          "taxonomy_node_id": "<node id from taxonomy, e.g. acc-goals-001, OR null if no match>",
          "category": "<Goals/Values | Data/Facts | Methods>",
          "point": "<1-2 sentences describing what this document says, from the Accelerationist lens>",
          "verbatim": "<1-5 sentences quoted verbatim from the document that best capture this point>",
          "excerpt_context": "<brief pointer to where in the document this appears, e.g. Section 2, paragraph 3>"
        }
      ]
    },
    "safetyist": {
      "key_points": [
        {
          "stance": "<one of: strongly_aligned | aligned | neutral | opposed | strongly_opposed | not_applicable>",
          "taxonomy_node_id": "<node id, e.g. saf-goals-001, OR null if no match>",
          "category": "<Goals/Values | Data/Facts | Methods>",
          "point": "<1-2 sentences describing what this document says, from the Safetyist lens>",
          "verbatim": "<1-5 sentences quoted verbatim from the document that best capture this point>",
          "excerpt_context": "<brief pointer to location in document>"
        }
      ]
    },
    "skeptic": {
      "key_points": [
        {
          "stance": "<one of: strongly_aligned | aligned | neutral | opposed | strongly_opposed | not_applicable>",
          "taxonomy_node_id": "<node id, e.g. skp-goals-001, OR null if no match>",
          "category": "<Goals/Values | Data/Facts | Methods>",
          "point": "<1-2 sentences describing what this document says, from the Skeptic lens>",
          "verbatim": "<1-5 sentences quoted verbatim from the document that best capture this point>",
          "excerpt_context": "<brief pointer to location in document>"
        }
      ]
    }
  },
  "factual_claims": [
    {
      "claim": "<a specific empirical or factual claim made in the document>",
      "doc_position": "<supports | disputes | neutral>",
      "potential_conflict_id": "<existing conflict id if relevant, e.g. conflict-scaling-laws-001, OR null>"
    }
  ],
  "unmapped_concepts": [
    {
      "concept": "<a concept in the document that does not map to any existing taxonomy node>",
      "suggested_pov": "<accelerationist | safetyist | skeptic | cross-cutting>",
      "suggested_category": "<Goals/Values | Data/Facts | Methods>",
      "reason": "<why this concept might deserve a new taxonomy node>"
    }
  ]
}
'@

    $systemPrompt = @"
You are a research analyst for the AI Triad project at the Berkman Klein Center.

Your job is to read a source document and produce a structured analysis that maps
the document's content to three Points of View (POV camps):
  - Accelerationist: AI as revolutionary force for abundance and solving existential problems
  - Safetyist: AI poses catastrophic/existential risks; alignment must precede deployment
  - Skeptic: AI causes immediate, measurable harms (bias, labor displacement, privacy)

For EACH POV camp you must identify:
  1. Goals/Values  — desired end-states the document supports or opposes
  2. Data/Facts    — empirical claims the document asserts or disputes
  3. Methods       — The logic models, interpretive lenses, or policy approaches used to process data in light of their goals and values (The How they think)


RULES:
  - Map every point to a taxonomy node ID from the provided taxonomy where possible.
    Use the exact node IDs (e.g. "acc-goals-001", "saf-data-002", "skp-methods-001").
  - If a point does not fit any existing node, set taxonomy_node_id to null and describe
    it in the unmapped_concepts array. This is how the taxonomy grows.
  - For Data/Facts points only: if the document's claim contradicts or supports an
    existing conflict entry, include the conflict_id in factual_claims.
  - Each key_point must include a stance field. stance must be ONE of:
    strongly_aligned | aligned | neutral | opposed | strongly_opposed | not_applicable.
    Different key_points within the same POV camp may have different stances
  - For each key_point, the "verbatim" field must contain 1-5 sentences copied
    EXACTLY from the document (word-for-word) that best capture the point being made.
    Use the minimum number of sentences needed to convey the core idea. Do NOT
    paraphrase, summarize, or alter the text in any way — copy it verbatim.
  - Return ONLY a valid JSON object. No markdown fences, no preamble, no explanation
    outside the JSON.
  - Be precise and specific. Every key_point must reference a real passage in the document.
"@

    $fullPrompt = @"
$systemPrompt

=== TAXONOMY (version $taxonomyVersion) ===
$taxonomyJson

=== OUTPUT SCHEMA (your response must match this structure) ===
$outputSchema

=== DOCUMENT: $DocId ===
Title: $($metadata.title)
POV tags (pre-classified): $($metadata.pov_tags -join ', ')
Topic tags: $($metadata.topic_tags -join ', ')

--- DOCUMENT CONTENT ---
$snapshotText
"@

    $promptLength         = $fullPrompt.Length
    $promptTokensEstimate = [int]($promptLength / 4)
    Write-OK "Prompt assembled: $promptLength chars (~$promptTokensEstimate tokens estimated)"
    Write-Info "  System instructions : $([int]($systemPrompt.Length / 4)) tokens (est.)"
    Write-Info "  Taxonomy context    : $([int]($taxonomyJson.Length / 4)) tokens (est.)"
    Write-Info "  Document content    : $estimatedTokens tokens (est.)"

    # -- DRY RUN — print and return -------------------------------------------
    if ($DryRun) {
        Write-Host "`n$('─' * 72)" -ForegroundColor DarkGray
        Write-Host "  DRY RUN: FULL PROMPT PREVIEW" -ForegroundColor Yellow
        Write-Host "$('─' * 72)" -ForegroundColor DarkGray

        Write-Host "`n[SYSTEM PROMPT]" -ForegroundColor Cyan
        Write-Host $systemPrompt -ForegroundColor Gray

        Write-Host "`n[TAXONOMY CONTEXT — first 500 chars]" -ForegroundColor Cyan
        Write-Host $taxonomyJson.Substring(0, [Math]::Min(500, $taxonomyJson.Length)) -ForegroundColor Gray
        Write-Host "... (truncated for display)" -ForegroundColor DarkGray

        Write-Host "`n[DOCUMENT CONTENT — first 500 chars]" -ForegroundColor Cyan
        Write-Host $snapshotText.Substring(0, [Math]::Min(500, $snapshotText.Length)) -ForegroundColor Gray
        Write-Host "... (truncated for display)" -ForegroundColor DarkGray

        Write-Host "`n[OUTPUT SCHEMA]" -ForegroundColor Cyan
        Write-Host $outputSchema -ForegroundColor Gray

        Write-Host "`n$('─' * 72)" -ForegroundColor DarkGray
        Write-Host "  DRY RUN complete. No API call made. No files written." -ForegroundColor Yellow
        Write-Host "$('─' * 72)`n" -ForegroundColor DarkGray
        return
    }

    # -- STEP 5 — Call the AI API ----------------------------------------------
    Write-Step "Calling AI API ($Model)"

    $startTime = Get-Date
    Write-Info "Sending request..."

    $aiResult = Invoke-AIApi `
        -Prompt      $fullPrompt `
        -Model       $Model `
        -ApiKey      $ApiKey `
        -Temperature $Temperature `
        -MaxTokens   32768 `
        -JsonMode `
        -TimeoutSec  120

    if ($null -eq $aiResult) {
        throw "AI API call returned null for $DocId"
    }

    $elapsed = (Get-Date) - $startTime
    Write-OK "Response received from $($aiResult.Backend) in $([int]$elapsed.TotalSeconds)s"

    # -- STEP 6 — Extract and validate the response JSON ----------------------
    Write-Step "Parsing and validating AI response"

    $rawText = $aiResult.Text

    Write-Verbose "Raw AI response:"
    Write-Verbose $rawText

    $cleanedText = $rawText -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
    $cleanedText = $cleanedText.Trim()

    try {
        $summaryObject = $cleanedText | ConvertFrom-Json -Depth 20
        Write-OK "Valid JSON received from $($aiResult.Backend)"
    } catch {
        # Attempt repair of truncated JSON
        Write-Warn "JSON parse failed — attempting repair"
        $repaired = Repair-TruncatedJson -Text $rawText
        if ($repaired) {
            try {
                $summaryObject = $repaired | ConvertFrom-Json -Depth 20
                Write-OK "JSON repaired successfully (truncated response recovered)"
            } catch {
                $summaryObject = $null
            }
        }
        if ($null -eq $summaryObject) {
            Write-Fail "AI returned invalid JSON. Raw response saved for inspection."
            $debugPath = Join-Path $paths.SummariesDir "${DocId}.debug-raw.txt"
            Set-Content -Path $debugPath -Value $rawText -Encoding UTF8
            Write-Info "Raw response saved to: $debugPath"
            throw "AI returned invalid JSON for $DocId"
        }
    }

    $requiredKeys = @("pov_summaries", "factual_claims", "unmapped_concepts")
    $missingKeys  = $requiredKeys | Where-Object { $null -eq $summaryObject.PSObject.Properties[$_] }
    if ($missingKeys) {
        Write-Warn "Response is missing expected keys: $($missingKeys -join ', ')"
        Write-Info "Continuing with partial data — review the summary file manually."
    }

    $validStances = @("strongly_aligned","aligned","neutral","opposed","strongly_opposed","not_applicable")
    $camps = @("accelerationist","safetyist","skeptic")

    foreach ($camp in $camps) {
        $campData = $summaryObject.pov_summaries.$camp
        if ($campData) {
            if ($campData.key_points) {
                foreach ($kp in $campData.key_points) {
                    if ($kp.stance -notin $validStances) {
                        Write-Warn "Invalid stance '$($kp.stance)' for $camp key_point — replacing with 'neutral'"
                        $kp.stance = 'neutral'
                    }
                }
            }
            $pointCount = if ($campData.key_points) { $campData.key_points.Count } else { 0 }
            $nullNodes  = if ($campData.key_points) { ($campData.key_points | Where-Object { $null -eq $_.taxonomy_node_id }).Count } else { 0 }
            Write-OK "  $camp : $pointCount key points ($nullNodes unmapped)"
        } else {
            Write-Warn "  $camp : no data returned — may not be relevant to this document"
        }
    }

    $factualClaimCount    = if ($summaryObject.factual_claims)    { $summaryObject.factual_claims.Count }    else { 0 }
    $unmappedConceptCount = if ($summaryObject.unmapped_concepts) { $summaryObject.unmapped_concepts.Count } else { 0 }

    Write-OK "  factual_claims    : $factualClaimCount"
    Write-OK "  unmapped_concepts : $unmappedConceptCount"
    if ($unmappedConceptCount -gt 0) {
        Write-Warn "$unmappedConceptCount concept(s) didn't map to existing taxonomy nodes — review for taxonomy expansion."
    }

    # -- STEP 7 — Write summary file ------------------------------------------
    Write-Step "Writing summary file"

    $finalSummary = [ordered]@{
        doc_id            = $DocId
        taxonomy_version  = $taxonomyVersion
        generated_at      = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
        ai_model          = $Model
        temperature       = $Temperature
        pov_summaries     = $summaryObject.pov_summaries
        factual_claims    = $summaryObject.factual_claims
        unmapped_concepts = $summaryObject.unmapped_concepts
    }

    $summaryJson = $finalSummary | ConvertTo-Json -Depth 20
    Set-Content -Path $paths.SummaryFile -Value $summaryJson -Encoding UTF8

    Write-OK "Summary written to: summaries/$DocId.json"

    # -- STEP 8 — Update metadata.json ----------------------------------------
    Write-Step "Updating metadata"

    $metaRaw     = Get-Content $paths.MetadataFile -Raw
    $metaUpdated = $metaRaw | ConvertFrom-Json -AsHashtable

    $metaUpdated["summary_version"] = $taxonomyVersion
    $metaUpdated["summary_status"]  = "current"
    $metaUpdated["summary_updated"] = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")

    Set-Content -Path $paths.MetadataFile -Value ($metaUpdated | ConvertTo-Json -Depth 10) -Encoding UTF8
    Write-OK "metadata.json updated: summary_status=current, summary_version=$taxonomyVersion"

    # -- STEP 9 — Conflict detection ------------------------------------------
    Write-Step "Running conflict detection"

    $today = Get-Date -Format "yyyy-MM-dd"

    if ($factualClaimCount -eq 0) {
        Write-Info "No factual claims to process."
    } else {
        foreach ($claim in $summaryObject.factual_claims) {

            $claimText   = $claim.claim
            $docPosition = $claim.doc_position
            $hintId      = $claim.potential_conflict_id

            $newInstance = [ordered]@{
                doc_id       = $DocId
                position     = "$docPosition — $claimText"
                date_flagged = $today
            }

            if ($hintId) {
                $existingPath = Join-Path $paths.ConflictsDir "$hintId.json"

                if (Test-Path $existingPath) {
                    $conflictData = Get-Content $existingPath -Raw | ConvertFrom-Json -AsHashtable
                    $alreadyLogged = $conflictData["instances"] | Where-Object { $_["doc_id"] -eq $DocId }
                    if ($alreadyLogged) {
                        Write-Info "  SKIP duplicate conflict instance: $hintId (doc already logged)"
                    } else {
                        $conflictData["instances"] += $newInstance
                        Set-Content -Path $existingPath -Value ($conflictData | ConvertTo-Json -Depth 10) -Encoding UTF8
                        Write-OK "  Appended to existing conflict: $hintId"
                    }
                } else {
                    Write-Warn "  Suggested conflict '$hintId' not found — creating new file"
                    $newConflict = [ordered]@{
                        claim_id               = $hintId
                        claim_label            = ($claimText | Select-Object -First 1)
                        description            = $claimText
                        status                 = "open"
                        linked_taxonomy_nodes  = @()
                        instances              = @($newInstance)
                        human_notes            = @()
                    }
                    Set-Content -Path $existingPath -Value ($newConflict | ConvertTo-Json -Depth 10) -Encoding UTF8
                    Write-OK "  Created new conflict file: $hintId.json"
                }
            } else {
                $slug = $claimText.ToLower() -replace '[^\w\s]', '' -replace '\s+', '-'
                $slug = $slug.Substring(0, [Math]::Min(40, $slug.Length)).TrimEnd('-')
                $newId = "conflict-$slug-$($DocId.Substring(0,[Math]::Min(8,$DocId.Length)))"

                $existingMatch = Get-ChildItem $paths.ConflictsDir -Filter "*.json" |
                    Where-Object { $_.BaseName -like "*$($slug.Substring(0,[Math]::Min(20,$slug.Length)))*" } |
                    Select-Object -First 1

                if ($existingMatch) {
                    $conflictData = Get-Content $existingMatch.FullName -Raw | ConvertFrom-Json -AsHashtable
                    $alreadyLogged = $conflictData["instances"] | Where-Object { $_["doc_id"] -eq $DocId }
                    if (-not $alreadyLogged) {
                        $conflictData["instances"] += $newInstance
                        Set-Content -Path $existingMatch.FullName -Value ($conflictData | ConvertTo-Json -Depth 10) -Encoding UTF8
                        Write-OK "  Appended to fuzzy-matched conflict: $($existingMatch.BaseName)"
                    }
                } else {
                    $newConflictPath = Join-Path $paths.ConflictsDir "$newId.json"
                    $newConflict = [ordered]@{
                        claim_id               = $newId
                        claim_label            = $claimText.Substring(0, [Math]::Min(80, $claimText.Length))
                        description            = $claimText
                        status                 = "open"
                        linked_taxonomy_nodes  = @()
                        instances              = @($newInstance)
                        human_notes            = @()
                    }
                    Set-Content -Path $newConflictPath -Value ($newConflict | ConvertTo-Json -Depth 10) -Encoding UTF8
                    Write-OK "  Created new conflict file: $newId.json"
                }
            }
        }
    }

    # -- STEP 10 — Print human-readable summary to console --------------------
    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  POV SUMMARY: $DocId" -ForegroundColor White
    Write-Host "  Taxonomy v$taxonomyVersion  |  Model: $Model" -ForegroundColor Gray
    Write-Host "$('═' * 72)" -ForegroundColor Cyan

    foreach ($camp in $camps) {
        $campData = $summaryObject.pov_summaries.$camp
        if (-not $campData) { continue }

        $campColor = switch ($camp) {
            "accelerationist" { "Green"  }
            "safetyist"       { "Red"    }
            "skeptic"         { "Yellow" }
        }
        $campLabel = $camp.ToUpper()

        Write-Host "`n  [$campLabel]" -ForegroundColor $campColor

        if ($campData.key_points) {
            $byCategory = $campData.key_points | Group-Object category
            foreach ($group in $byCategory) {
                Write-Host "    $($group.Name):" -ForegroundColor White
                foreach ($pt in $group.Group) {
                    $nodeTag = if ($pt.taxonomy_node_id) { "[$($pt.taxonomy_node_id)]" } else { "[UNMAPPED]" }
                    $ptStance = if ($pt.stance) { $pt.stance } else { 'neutral' }
                    Write-Host "      $nodeTag ($ptStance) $($pt.point)" -ForegroundColor Gray
                    if ($pt.verbatim) {
                        Write-Host "        `"$($pt.verbatim)`"" -ForegroundColor DarkGray
                    }
                }
            }
        } else {
            Write-Host "    (no key points extracted)" -ForegroundColor DarkGray
        }
    }

    if ($unmappedConceptCount -gt 0) {
        Write-Host "`n  UNMAPPED CONCEPTS (potential new taxonomy nodes):" -ForegroundColor Magenta
        foreach ($concept in $summaryObject.unmapped_concepts) {
            Write-Host "    [$($concept.suggested_pov) / $($concept.suggested_category)]" -ForegroundColor Magenta
            Write-Host "    $($concept.concept)" -ForegroundColor Gray
            Write-Host "    Reason: $($concept.reason)" -ForegroundColor DarkGray
        }
    }

    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  Files written:" -ForegroundColor White
    Write-Host "    summaries/$DocId.json" -ForegroundColor Green
    Write-Host "    sources/$DocId/metadata.json  (summary_status=current)" -ForegroundColor Green
    Write-Host "$('═' * 72)`n" -ForegroundColor Cyan
}
