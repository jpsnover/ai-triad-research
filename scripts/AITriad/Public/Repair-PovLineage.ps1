# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Repair-PovLineage {
    <#
    .SYNOPSIS
        Enriches bare-string intellectual_lineage entries with descriptions,
        validated URLs, and categories.
    .DESCRIPTION
        Scans all taxonomy nodes' graph_attributes.intellectual_lineage arrays.
        Bare string entries (e.g., "Effective Altruism") are enriched with:
          - description: 2-5 sentence definition
          - url: Wikipedia or authoritative URL (validated via HEAD request)
          - category: philosophical_movement, economic_theory, etc.

        Processes unique values in batch (not per-node) to minimize AI calls.
        Caches results in a lineage-enrichments.json file for incremental re-runs.
    .PARAMETER NodeIds
        One or more taxonomy node IDs to process. Accepts pipeline input
        by value or by property name (Id, NodeId). If omitted, processes all nodes.
    .PARAMETER POV
        Filter to a specific POV file.
    .PARAMETER Model
        AI model for enrichment. Default: gemini-3.5-flash-lite.
    .PARAMETER ApiKey
        AI API key. Resolved from env if omitted.
    .PARAMETER BatchSize
        Number of lineage values per AI call. Default: 25.
    .PARAMETER SkipUrlValidation
        Skip HTTP HEAD URL validation (faster for testing).
    .PARAMETER Force
        Convert existing rich lineage objects (name/description/url/category)
        back to bare strings before processing, forcing full re-enrichment.
    .EXAMPLE
        Repair-PovLineage -WhatIf
    .EXAMPLE
        Repair-PovLineage -NodeIds acc-beliefs-001, acc-beliefs-002
    .EXAMPLE
        Get-Tax -POV accelerationist | Repair-PovLineage -SkipUrlValidation
    .EXAMPLE
        Repair-PovLineage -POV accelerationist -BatchSize 10
    .EXAMPLE
        Repair-PovLineage -Force
        # Re-enrich all lineage entries from scratch.
    .LINK
        Show-AITriadHelp
    .LINK
        Get-IntellectualLineage
    .LINK
        Get-PovLineage
    .LINK
        Repair-PovAttributes
    .LINK
        Repair-PovDescriptions
    .LINK
        Repair-ResolvedBackfill
    .LINK
        Repair-UnmappedConcepts
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(ValueFromPipeline, ValueFromPipelineByPropertyName)]
        [Alias('NodeId', 'Id')]
        [string[]]$NodeIds,

        [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'situations')]
        [string]$POV,

        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [string]$Model = 'gemini-3.5-flash-lite',

        [string]$ApiKey,

        [ValidateRange(5, 50)]
        [int]$BatchSize = 25,

        [switch]$SkipUrlValidation,

        [switch]$FixUrls,

        [Parameter(HelpMessage = 'Convert existing rich lineage objects back to bare strings for re-enrichment')]
        [switch]$Force,

        [Parameter(HelpMessage = 'Regenerate lineage descriptions with 2-4 paragraph node-specific content')]
        [switch]$RegenerateContent,

        [Parameter(HelpMessage = 'Nodes per AI batch in RegenerateContent mode')]
        [ValidateRange(1, 10)]
        [int]$NodeBatchSize = 3
    )

    begin {
        $CollectedIds = [System.Collections.Generic.List[string]]::new()
    }

    process {
        if ($NodeIds) {
            foreach ($nid in $NodeIds) {
                if (-not [string]::IsNullOrWhiteSpace($nid)) { $CollectedIds.Add($nid) }
            }
        }
    }

    end {
    # Build filter set from collected IDs (empty = process all)
    $FilterNodeIds = $null
    if ($CollectedIds.Count -gt 0) {
        $FilterNodeIds = [System.Collections.Generic.HashSet[string]]::new(
            [string[]]@($CollectedIds), [System.StringComparer]::OrdinalIgnoreCase)
    }

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $TaxDir = Get-TaxonomyDir
    $CacheDir = Join-Path (Get-DataRoot) 'calibration' 'core'
    if (-not (Test-Path $CacheDir)) { $null = New-Item -ItemType Directory -Path $CacheDir -Force }
    $CachePath = Join-Path $CacheDir 'lineage-enrichments.json'

    # ── Load cache ────────────────────────────────────────────────────────────
    $Cache = @{}
    if (Test-Path $CachePath) {
        $CacheData = Get-Content $CachePath -Raw | ConvertFrom-Json -AsHashtable
        if ($CacheData) { $Cache = $CacheData }
        Write-Verbose "Loaded $($Cache.Count) cached enrichments"
    }

    # ── URL validation helper (GET-based, soft 404 detection) ────────────────
    function Test-LineageUrl {
        param([string]$Url)
        if ([string]::IsNullOrWhiteSpace($Url) -or $Url -notmatch '^https?://') { return $false }
        try {
            $Resp = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 8 -MaximumRedirection 5 `
                -ErrorAction Stop -UseBasicParsing
            if ($Resp.StatusCode -ne 200) { return $false }
            # Soft 404 detection: check first 1KB of body for "not found" signals
            $BodySnippet = if ($Resp.Content.Length -gt 1024) { $Resp.Content.Substring(0, 1024) } else { $Resp.Content }
            if ($BodySnippet -match '(?i)(page not found|does not exist|no article|404 error|there is no page)') {
                return $false
            }
            return $true
        } catch { return $false }
    }

    function Get-WikipediaFallbackUrl {
        param([string]$Name)
        $WikiName = ($Name -replace '\s*\([^)]+\)\s*$', '').Trim() -replace '\s+', '_'
        $WikiUrl = "https://en.wikipedia.org/wiki/$WikiName"
        if (Test-LineageUrl $WikiUrl) { return $WikiUrl }
        return $null
    }

    # ── FixUrls mode: scan cache, validate via GET, Wikipedia fallback ────────
    if ($FixUrls) {
        if ($Cache.Count -eq 0) {
            Write-Warning 'Cache is empty — run Repair-PovLineage first to populate it'
            return
        }

        Write-Host '=== Fix Broken URLs ===' -ForegroundColor Cyan

        # Collect entries needing validation: error status, missing status, or no URL
        $ToCheck = @($Cache.GetEnumerator() | Where-Object {
            $v = $_.Value
            ($v.ContainsKey('url_status') -and $v['url_status'] -ne 200) -or
            (-not $v.ContainsKey('url_status')) -or
            [string]::IsNullOrWhiteSpace($v['url'])
        })
        Write-Host "  Entries to check: $($ToCheck.Count) / $($Cache.Count)"

        if ($WhatIfPreference) {
            Write-Host "`nWhatIf: Would validate $($ToCheck.Count) URLs via GET with Wikipedia fallback"
            $ToCheck | Select-Object -First 10 | ForEach-Object {
                Write-Host "  $($_.Key): $($_.Value['url'])" -ForegroundColor DarkGray
            }
            return
        }

        $FixedWiki = 0; $FixedValid = 0; $Cleared = 0
        foreach ($Entry in $ToCheck) {
            $Name = $Entry.Key
            $Data = $Entry.Value
            $Url  = $Data['url']

            # Try existing URL first
            if (-not [string]::IsNullOrWhiteSpace($Url) -and (Test-LineageUrl $Url)) {
                $Data['url_status'] = 200
                $FixedValid++
                continue
            }

            # Try Wikipedia fallback
            $WikiUrl = Get-WikipediaFallbackUrl $Name
            if ($WikiUrl) {
                $Data['url'] = $WikiUrl
                $Data['url_status'] = 200
                $FixedWiki++
                Write-Verbose "  Wiki fallback: $Name → $WikiUrl"
            } else {
                $Data['url'] = $null
                $Data['url_status'] = 'cleared'
                $Cleared++
                Write-Verbose "  Cleared: $Name (no valid URL found)"
            }
        }

        Write-Host "  Already valid: $FixedValid | Wikipedia fallback: $FixedWiki | Cleared: $Cleared"

        # Save updated cache
        $Cache | ConvertTo-Json -Depth 5 | Set-Content -Path $CachePath -Encoding UTF8
        Write-Host "Cache saved" -ForegroundColor Green

        # Update taxonomy files with fixed URLs
        $TaxUpdated = 0
        foreach ($PovName in @('accelerationist', 'safetyist', 'skeptic', 'situations')) {
            $FilePath = Join-Path $TaxDir "$PovName.json"
            if (-not (Test-Path $FilePath)) { continue }
            $TaxFileData = Get-Content $FilePath -Raw | ConvertFrom-Json
            $PovMod = $false
            foreach ($Node in $TaxFileData.nodes) {
                if (-not $Node.PSObject.Properties['graph_attributes'] -or -not $Node.graph_attributes) { continue }
                $GA = $Node.graph_attributes
                if (-not $GA.PSObject.Properties['intellectual_lineage']) { continue }
                foreach ($LinEntry in @($GA.intellectual_lineage)) {
                    if ($LinEntry -isnot [string] -and $LinEntry.PSObject.Properties['name'] -and $Cache.ContainsKey($LinEntry.name)) {
                        $Cached = $Cache[$LinEntry.name]
                        $NewUrl = if ($Cached['url']) { $Cached['url'] } else { $null }
                        if ($LinEntry.url -ne $NewUrl) {
                            $LinEntry.url = $NewUrl
                            $PovMod = $true
                            $TaxUpdated++
                        }
                    }
                }
            }
            if ($PovMod) {
                $TaxFileData | ConvertTo-Json -Depth 20 | Set-Content -Path $FilePath -Encoding UTF8
                Write-Host "  Saved $PovName.json" -ForegroundColor Green
            }
        }
        Write-Host "Updated $TaxUpdated lineage entries in taxonomy files" -ForegroundColor Green
        return
    }

    # ── RegenerateContent mode: per-node 2-4 paragraph descriptions ──────────
    if ($RegenerateContent) {
        $PovFiles = @('accelerationist', 'safetyist', 'skeptic', 'situations')
        if ($POV) { $PovFiles = @($POV) }

        $SystemPrompt = Get-Prompt -Name 'lineage-regenerate'

        # Resolve API key
        if ($Model -match '^gemini') { $Backend = 'gemini' }
        elseif ($Model -match '^claude') { $Backend = 'claude' }
        elseif ($Model -match '^openai') { $Backend = 'openai' }
        else { $Backend = 'gemini' }
        $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend
        if ([string]::IsNullOrWhiteSpace($ResolvedKey)) {
            throw (New-ActionableError `
                -Goal 'Regenerate lineage content' `
                -Problem 'No API key available' `
                -Location 'Repair-PovLineage -RegenerateContent' `
                -NextSteps @('Set GEMINI_API_KEY or ANTHROPIC_API_KEY environment variable', 'Pass -ApiKey parameter'))
        }

        # Collect nodes to process
        $NodesToProcess = [System.Collections.Generic.List[hashtable]]::new()
        foreach ($PovName in $PovFiles) {
            $FilePath = Join-Path $TaxDir "$PovName.json"
            if (-not (Test-Path $FilePath)) { continue }
            $Data = Get-Content $FilePath -Raw | ConvertFrom-Json

            foreach ($Node in $Data.nodes) {
                if ($FilterNodeIds -and -not $FilterNodeIds.Contains($Node.id)) { continue }
                if (-not $Node.PSObject.Properties['graph_attributes'] -or -not $Node.graph_attributes) { continue }
                $GA = $Node.graph_attributes
                if (-not $GA.PSObject.Properties['intellectual_lineage']) { continue }
                $LinEntries = @($GA.intellectual_lineage)
                if ($LinEntries.Count -eq 0) { continue }

                # Only process rich entries (have a name property)
                $RichEntries = @($LinEntries | Where-Object { $_ -isnot [string] -and $_.PSObject.Properties['name'] })
                if ($RichEntries.Count -eq 0) { continue }

                $NodeCategory = if ($Node.PSObject.Properties['category']) { $Node.category } else { 'Situation' }
                $NodeDesc = if ($Node.PSObject.Properties['description']) { $Node.description } else { '' }
                $NodesToProcess.Add(@{
                    pov      = $PovName
                    node_id  = $Node.id
                    label    = $Node.label
                    desc     = $NodeDesc
                    category = $NodeCategory
                    entries  = $RichEntries
                })
            }
        }

        Write-Host "=== Regenerate Lineage Content ===" -ForegroundColor Cyan
        Write-Host "  Nodes to process: $($NodesToProcess.Count)"
        Write-Host "  Batch size: $NodeBatchSize nodes/batch"
        Write-Host "  Model: $Model"

        $TotalBatches = [Math]::Ceiling($NodesToProcess.Count / $NodeBatchSize)
        Write-Host "  Total batches: $TotalBatches"

        if ($WhatIfPreference) {
            Write-Host "`nWhatIf: Would regenerate $($NodesToProcess.Count) nodes in $TotalBatches batches"
            $NodesToProcess | Select-Object -First 5 | ForEach-Object {
                Write-Host "  $($_.node_id): $($_.label) ($($_.entries.Count) entries)" -ForegroundColor DarkGray
            }
            return
        }

        # Track which POV files need saving
        $PovModified = @{}

        $BatchNum = 0
        $TotalUpdated = 0
        $TotalFailed = 0

        for ($i = 0; $i -lt $NodesToProcess.Count; $i += $NodeBatchSize) {
            $BatchNum++
            $BatchEnd = [Math]::Min($i + $NodeBatchSize - 1, $NodesToProcess.Count - 1)
            $Batch = @($NodesToProcess[$i..$BatchEnd])
            $BatchNodeIds = ($Batch | ForEach-Object { $_.node_id }) -join ', '
            Write-Host "  Batch $BatchNum/$TotalBatches ($($Batch.Count) nodes: $BatchNodeIds)..." -ForegroundColor Gray -NoNewline

            # Build per-node input for the prompt
            $NodesJson = @(foreach ($Item in $Batch) {
                $EntryNames = @($Item.entries | ForEach-Object { $_.name })
                $ExistingEntries = @(foreach ($E in $Item.entries) {
                    [ordered]@{
                        name     = $E.name
                        url      = if ($E.PSObject.Properties['url']) { $E.url } else { $null }
                        category = if ($E.PSObject.Properties['category']) { $E.category } else { $null }
                    }
                })
                [ordered]@{
                    node_id           = $Item.node_id
                    label             = $Item.label
                    description       = $Item.desc
                    category          = $Item.category
                    pov               = $Item.pov
                    lineage_entries   = $ExistingEntries
                    other_entry_names = $EntryNames
                }
            }) | ConvertTo-Json -Depth 5

            $UserPrompt = @"
Regenerate the description field for each lineage entry on each node below.
Keep name, url, and category fields EXACTLY as provided. Only replace the description.

NODES:
$NodesJson

Return a JSON object mapping node_id to an array of updated lineage entries:
{
  "node_id_1": [
    {"name": "...", "description": "2-4 paragraphs...", "url": "...", "category": "..."},
    ...
  ],
  ...
}
"@

            try {
                $Result = Invoke-AIApi -Prompt $UserPrompt -SystemInstruction $SystemPrompt `
                    -Model $Model -ApiKey $ResolvedKey `
                    -Temperature 0.3 -MaxTokens 16384 -JsonMode

                if (-not $Result -or -not $Result.Text) {
                    Write-Host " no response" -ForegroundColor Red
                    $TotalFailed += $Batch.Count
                    continue
                }

                $CleanText = $Result.Text -replace '^\s*```json\s*', '' -replace '\s*```\s*$', ''
                # Extract first complete JSON object — LLMs sometimes append trailing content
                $ObjStart = $CleanText.IndexOf('{')
                if ($ObjStart -ge 0) {
                    $Depth = 0; $InStr = $false; $Esc = $false
                    for ($jx = $ObjStart; $jx -lt $CleanText.Length; $jx++) {
                        $Ch = $CleanText[$jx]
                        if ($Esc) { $Esc = $false; continue }
                        if ($Ch -eq '\' -and $InStr) { $Esc = $true; continue }
                        if ($Ch -eq '"') { $InStr = -not $InStr; continue }
                        if (-not $InStr) {
                            if ($Ch -eq '{') { $Depth++ }
                            elseif ($Ch -eq '}') { $Depth--; if ($Depth -eq 0) { $CleanText = $CleanText.Substring($ObjStart, $jx - $ObjStart + 1); break } }
                        }
                    }
                }
                $Regenerated = $CleanText | ConvertFrom-Json

                foreach ($Item in $Batch) {
                    $NodeId = $Item.node_id
                    if (-not $Regenerated.PSObject.Properties[$NodeId]) {
                        Write-Verbose "  $NodeId — not in response, skipping"
                        $TotalFailed++
                        continue
                    }

                    $NewEntries = @($Regenerated.$NodeId)
                    if ($NewEntries.Count -eq 0) {
                        Write-Verbose "  $NodeId — empty entries in response"
                        $TotalFailed++
                        continue
                    }

                    # Build lookup: name → new description
                    $DescLookup = @{}
                    foreach ($NE in $NewEntries) {
                        if ($NE.PSObject.Properties['name'] -and $NE.PSObject.Properties['description']) {
                            $DescLookup[$NE.name] = $NE.description
                        }
                    }

                    # Apply to original entries (preserve url/category from source)
                    $Updated = 0
                    foreach ($OrigEntry in $Item.entries) {
                        if ($DescLookup.ContainsKey($OrigEntry.name)) {
                            $NewDesc = $DescLookup[$OrigEntry.name]
                            if ($NewDesc.Length -gt 100) {
                                $OrigEntry.description = $NewDesc
                                $Updated++
                            }
                        }
                    }

                    if ($Updated -gt 0) {
                        $PovModified[$Item.pov] = $true
                        $TotalUpdated++
                        Write-Verbose "  $NodeId — $Updated/$($Item.entries.Count) entries updated"
                    }
                }

                Write-Host " done ($($Batch.Count) nodes)" -ForegroundColor Green
            }
            catch {
                Write-Host " failed: $($_.Exception.Message)" -ForegroundColor Red
                $TotalFailed += $Batch.Count
            }

            if ($BatchNum -lt $TotalBatches) { Start-Sleep -Seconds 1 }
        }

        # Save modified taxonomy files
        foreach ($PovName in $PovModified.Keys) {
            $FilePath = Join-Path $TaxDir "$PovName.json"
            $Data = Get-Content $FilePath -Raw | ConvertFrom-Json

            # Re-apply the updated entries from NodesToProcess back to the file data
            $NodeLookup = @{}
            foreach ($Item in $NodesToProcess) {
                if ($Item.pov -eq $PovName) { $NodeLookup[$Item.node_id] = $Item }
            }
            foreach ($Node in $Data.nodes) {
                if ($NodeLookup.ContainsKey($Node.id)) {
                    $Node.graph_attributes.intellectual_lineage = @($NodeLookup[$Node.id].entries)
                }
            }

            $Data | ConvertTo-Json -Depth 20 | Set-Content -Path $FilePath -Encoding UTF8
            Write-Host "  Saved $PovName.json" -ForegroundColor Green
        }

        Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
        Write-Host "  Nodes updated: $TotalUpdated"
        Write-Host "  Nodes failed: $TotalFailed"
        Write-Host "  POV files saved: $($PovModified.Keys -join ', ')"
        return
    }

    # ── Collect unique bare-string lineage values ─────────────────────────────
    $PovFiles = @('accelerationist', 'safetyist', 'skeptic', 'situations')
    if ($POV) { $PovFiles = @($POV) }

    $UniqueValues = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $TaxData = @{}

    foreach ($PovName in $PovFiles) {
        $FilePath = Join-Path $TaxDir "$PovName.json"
        if (-not (Test-Path $FilePath)) { continue }
        $Data = Get-Content $FilePath -Raw | ConvertFrom-Json
        $TaxData[$PovName] = $Data

        foreach ($Node in $Data.nodes) {
            if ($FilterNodeIds -and -not $FilterNodeIds.Contains($Node.id)) { continue }
            if (-not $Node.PSObject.Properties['graph_attributes'] -or -not $Node.graph_attributes) { continue }
            $GA = $Node.graph_attributes
            if (-not $GA.PSObject.Properties['intellectual_lineage']) { continue }

            # -Force: convert rich objects back to bare strings for re-enrichment
            if ($Force) {
                $Converted = 0
                $NewLin = @(foreach ($Entry in @($GA.intellectual_lineage)) {
                    if ($Entry -is [string]) { $Entry }
                    elseif ($Entry.PSObject.Properties['name'] -and $Entry.name) {
                        $Converted++
                        [string]$Entry.name
                    }
                    else { $Entry }
                })
                if ($Converted -gt 0) { $GA.intellectual_lineage = $NewLin }
            }

            foreach ($Entry in @($GA.intellectual_lineage)) {
                if ($Entry -is [string] -and -not [string]::IsNullOrWhiteSpace($Entry)) {
                    [void]$UniqueValues.Add($Entry)
                }
            }
        }
    }

    if ($Force) {
        Write-Info 'Force mode: rich lineage objects converted to bare strings for re-enrichment'
    }

    if ($null -ne $FilterNodeIds -and $FilterNodeIds.Count -gt 0) {
        Write-Verbose "Filtering to $($CollectedIds.Count) node ID(s): $($CollectedIds[0..([Math]::Min(4, $CollectedIds.Count - 1))] -join ', ')"
    }
    Write-Verbose "UniqueValues type: $($UniqueValues.GetType().Name), count: $($UniqueValues.Count)"
    Write-Host "Unique lineage values: $($UniqueValues.Count)" -ForegroundColor Cyan

    if ($UniqueValues.Count -eq 0) {
        Write-Host 'No bare-string lineage entries to process.' -ForegroundColor Green
        return
    }

    # ── Phase 0: Dedup via embedding similarity ───────────────────────────────
    # Cluster near-duplicates (cosine ≥ 0.85), pick canonical representative,
    # replace all references to non-canonical members.
    $DedupThreshold = 0.85
    $UniqueList = @($UniqueValues)
    $DedupMap = @{}  # non-canonical → canonical
    $ClustersMerged = 0

    # Count frequency of each value across all nodes
    $FreqMap = @{}
    foreach ($PovName in $TaxData.Keys) {
        foreach ($Node in $TaxData[$PovName].nodes) {
            if (-not $Node.PSObject.Properties['graph_attributes'] -or -not $Node.graph_attributes) { continue }
            $GA = $Node.graph_attributes
            if (-not $GA.PSObject.Properties['intellectual_lineage']) { continue }
            foreach ($Entry in @($GA.intellectual_lineage)) {
                if ($Entry -is [string]) {
                    $FreqMap[$Entry] = ($FreqMap[$Entry] ?? 0) + 1
                }
            }
        }
    }

    Write-Host "Computing embeddings for dedup..." -ForegroundColor Gray
    $Embeddings = Get-TextEmbedding -Texts $UniqueList -Ids $UniqueList
    if ($null -ne $Embeddings -and $Embeddings.Count -gt 0) {
        Write-Host "Clustering at cosine >= $DedupThreshold..." -ForegroundColor Gray

        # Simple greedy clustering: for each value, check if it's similar to an existing canonical
        $Canonicals = [System.Collections.Generic.List[string]]::new()
        $CanonicalVecs = [System.Collections.Generic.List[double[]]]::new()

        foreach ($Val in $UniqueList) {
            if (-not $Embeddings.ContainsKey($Val)) {
                # No embedding — add as canonical but skip similarity checks.
                # Use a zero vector so $Canonicals and $CanonicalVecs stay in sync.
                $Canonicals.Add($Val)
                $CanonicalVecs.Add($null)
                continue
            }
            $Vec = $Embeddings[$Val]
            $Merged = $false

            for ($j = 0; $j -lt $Canonicals.Count; $j++) {
                $CanVec = $CanonicalVecs[$j]
                if ($null -eq $CanVec) { continue }  # no embedding for this canonical
                # Cosine similarity (vectors are normalized)
                $Dot = 0.0
                for ($k = 0; $k -lt $Vec.Count; $k++) { $Dot += $Vec[$k] * $CanVec[$k] }
                if ($Dot -ge $DedupThreshold) {
                    $CanName = $Canonicals[$j]
                    # Parenthetical variants: merge to the base name.
                    # "Asimov's Laws (conceptual)" + "Asimov's Laws (implicit)" → "Asimov's Laws"
                    $BaseName = $null
                    # Case 1: one is qualified, other is the bare base
                    if ($Val -match '^(.+?)\s*\(' -and $CanName -eq $Matches[1].Trim()) {
                        $BaseName = $CanName  # canonical is already the base
                    }
                    elseif ($CanName -match '^(.+?)\s*\(' -and $Val -eq $Matches[1].Trim()) {
                        $BaseName = $Val  # new value is the base
                    }
                    # Case 2: both are qualified variants of the same base
                    if (-not $BaseName -and $Val -match '^(.+?)\s*\(' -and $CanName -match '^(.+?)\s*\(') {
                        $ValBase = ($Val -replace '\s*\([^)]+\)\s*$','').Trim()
                        $CanBase = ($CanName -replace '\s*\([^)]+\)\s*$','').Trim()
                        if ($ValBase -eq $CanBase) { $BaseName = $ValBase }
                    }
                    if ($BaseName) {
                        # Merge both to the base name
                        if ($CanName -ne $BaseName) { $DedupMap[$CanName] = $BaseName }
                        $DedupMap[$Val] = $BaseName
                        $Canonicals[$j] = $BaseName
                        # Re-fetch base embedding if available, otherwise keep canonical's
                        if ($Embeddings.ContainsKey($BaseName)) {
                            $CanonicalVecs[$j] = $Embeddings[$BaseName]
                        }
                    }
                    else {
                        # Non-parenthetical merge: pick the one with higher frequency
                        $CanFreq = $FreqMap[$CanName] ?? 0
                        $ValFreq = $FreqMap[$Val] ?? 0
                        if ($ValFreq -gt $CanFreq) {
                            $DedupMap[$CanName] = $Val
                            $Canonicals[$j] = $Val
                            $CanonicalVecs[$j] = $Vec
                        }
                        else {
                            $DedupMap[$Val] = $CanName
                        }
                    }
                    $ClustersMerged++
                    $Merged = $true
                    break
                }
            }

            if (-not $Merged) {
                $Canonicals.Add($Val)
                $CanonicalVecs.Add($Vec)
            }
        }

        Write-Host "Dedup: $($UniqueList.Count) → $($Canonicals.Count) canonical values ($ClustersMerged merged)" -ForegroundColor Green

        if ($ClustersMerged -gt 0) {
            # Show sample merges
            $SampleMerges = @($DedupMap.GetEnumerator() | Select-Object -First 10)
            Write-Host "  Sample merges:" -ForegroundColor Gray
            foreach ($M in $SampleMerges) {
                Write-Host "    '$($M.Key)' → '$($M.Value)'" -ForegroundColor DarkGray
            }
            if ($DedupMap.Count -gt 10) {
                Write-Host "    ... and $($DedupMap.Count - 10) more" -ForegroundColor DarkGray
            }

            # Apply dedup to taxonomy files (replace non-canonical references)
            if (-not $WhatIfPreference) {
                foreach ($PovName in $TaxData.Keys) {
                    $Data = $TaxData[$PovName]
                    $PovModified = $false
                    foreach ($Node in $Data.nodes) {
                        if (-not $Node.PSObject.Properties['graph_attributes'] -or -not $Node.graph_attributes) { continue }
                        $GA = $Node.graph_attributes
                        if (-not $GA.PSObject.Properties['intellectual_lineage']) { continue }
                        $Lin = @($GA.intellectual_lineage)
                        $Changed = $false
                        $NewLin = @(foreach ($Entry in $Lin) {
                            if ($Entry -is [string] -and $DedupMap.ContainsKey($Entry)) {
                                $Changed = $true
                                $DedupMap[$Entry]
                            } else { $Entry }
                        })
                        if ($Changed) {
                            $GA.intellectual_lineage = $NewLin
                            $PovModified = $true
                        }
                    }
                    if ($PovModified) {
                        $FilePath = Join-Path $TaxDir "$PovName.json"
                        $Data | ConvertTo-Json -Depth 20 | Set-Content -Path $FilePath -Encoding UTF8
                    }
                }
                Write-Host "  Dedup references updated in taxonomy files" -ForegroundColor Green
            }

            # Update UniqueValues to canonicals only
            $UniqueValues = [System.Collections.Generic.HashSet[string]]::new(
                [string[]]@($Canonicals), [System.StringComparer]::OrdinalIgnoreCase)
        }
    }
    else {
        Write-Host "  Embedding unavailable — skipping dedup" -ForegroundColor Yellow
    }

    $NeedEnrichment = @($UniqueValues | Where-Object {
        -not $Cache.ContainsKey($_) -or
        [string]::IsNullOrWhiteSpace($Cache[$_].description)
    })
    $AlreadyCached  = $UniqueValues.Count - $NeedEnrichment.Count

    Write-Host "Post-dedup unique: $($UniqueValues.Count)"
    Write-Host "Already cached: $AlreadyCached"
    Write-Host "Need enrichment: $($NeedEnrichment.Count)"

    if ($WhatIfPreference) {
        $Batches = [Math]::Ceiling($NeedEnrichment.Count / $BatchSize)
        Write-Host "`n── Plan ────────────────────────────────────────" -ForegroundColor Yellow
        if ($ClustersMerged -gt 0) {
            Write-Host "  Dedup: $ClustersMerged near-duplicates merged (cosine >= $DedupThreshold)"
        }
        Write-Host "  Enrich: $($NeedEnrichment.Count) values in $Batches AI batches ($BatchSize/batch)"
        Write-Host "  Validate: $($UniqueValues.Count) URLs via HTTP HEAD"
        Write-Host "  Update: $($PovFiles.Count) taxonomy files"
        Write-Host "  Cache: $CachePath"
        Write-Host "  Model: $Model | Temperature: 0.2"
        Write-Host "  Est. cost: ~`$$([Math]::Round($Batches * 0.02, 2)) (Gemini free tier)"

        # Per-POV breakdown
        Write-Host "`n── Per-POV Breakdown ───────────────────────────" -ForegroundColor Yellow
        foreach ($PovName in $PovFiles) {
            $FilePath = Join-Path $TaxDir "$PovName.json"
            if (-not (Test-Path $FilePath)) { continue }
            $Data = (Get-Content $FilePath -Raw | ConvertFrom-Json).nodes
            $NodesWithLin = 0
            $EntryCount = 0
            foreach ($N in $Data) {
                if (-not $N.PSObject.Properties['graph_attributes'] -or -not $N.graph_attributes) { continue }
                $GA = $N.graph_attributes
                if (-not $GA.PSObject.Properties['intellectual_lineage']) { continue }
                $Lin = @($GA.intellectual_lineage)
                $Bare = @($Lin | Where-Object { $_ -is [string] })
                if ($Bare.Count -gt 0) { $NodesWithLin++; $EntryCount += $Bare.Count }
            }
            Write-Host "  $PovName`: $NodesWithLin nodes, $EntryCount bare entries"
        }

        # Sample values
        Write-Host "`n── Sample Values (first 15) ────────────────────" -ForegroundColor Yellow
        $NeedEnrichment | Select-Object -First 15 | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
        if ($NeedEnrichment.Count -gt 15) { Write-Host "  ... and $($NeedEnrichment.Count - 15) more" -ForegroundColor DarkGray }

        # Target format example
        Write-Host "`n── Target Format ───────────────────────────────" -ForegroundColor Yellow
        Write-Host '  "Effective Altruism (long-termism)"  →' -ForegroundColor DarkGray
        Write-Host '  {' -ForegroundColor Gray
        Write-Host '    "name": "Effective Altruism (long-termism)",' -ForegroundColor Gray
        Write-Host '    "description": "A philosophical movement applying evidence-based...",' -ForegroundColor Gray
        Write-Host '    "url": "https://en.wikipedia.org/wiki/Effective_altruism",' -ForegroundColor Gray
        Write-Host '    "category": "philosophical_movement"' -ForegroundColor Gray
        Write-Host '  }' -ForegroundColor Gray
        return
    }

    # ── Resolve API key ───────────────────────────────────────────────────────
    if ($NeedEnrichment.Count -gt 0) {
        if ($Model -match '^gemini') { $Backend = 'gemini' }
        elseif ($Model -match '^claude') { $Backend = 'claude' }
        elseif ($Model -match '^openai') { $Backend = 'openai' }
        else { $Backend = 'gemini' }
        $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend
        if ([string]::IsNullOrWhiteSpace($ResolvedKey)) {
            Write-Warning "No API key — can only apply cached enrichments"
            $NeedEnrichment = @()
        }
    }

    # ── Batch AI enrichment ───────────────────────────────────────────────────
    $BatchNum = 0
    $TotalBatches = [Math]::Ceiling($NeedEnrichment.Count / $BatchSize)

    for ($i = 0; $i -lt $NeedEnrichment.Count; $i += $BatchSize) {
        $BatchNum++
        $Batch = @($NeedEnrichment[$i..[Math]::Min($i + $BatchSize - 1, $NeedEnrichment.Count - 1)])
        Write-Verbose "Batch ${BatchNum}/${TotalBatches}: $($Batch -join ', ')"
        Write-Host "  Batch $BatchNum/$TotalBatches ($($Batch.Count) values)..." -ForegroundColor Gray -NoNewline

        $BatchList = ($Batch | ForEach-Object { "- $_" }) -join "`n"
        $Prompt = @"
Enrich each intellectual lineage entry with a description, URL, and category.

For each entry, provide:
- name: the original name (verbatim)
- description: 1-3 paragraphs about the topic, accessible to a policy audience. Cover what it is, its historical origins and key proponents, and why it matters for AI governance discourse. Go beyond a dictionary definition — provide enough context that a reader unfamiliar with the topic can understand its significance and how it connects to AI policy debates.
- url: Wikipedia or authoritative URL (prefer Wikipedia when available)
- category: one of: philosophical_movement, economic_theory, political_philosophy, social_theory, scientific_paradigm, legal_framework, technology_movement, ethical_framework, academic_discipline, cultural_movement, other

Entries to enrich:
$BatchList

Return a JSON array of objects. No markdown fences, no explanation.
Example: [{"name":"Effective Altruism","description":"A philosophical movement...","url":"https://en.wikipedia.org/wiki/Effective_altruism","category":"philosophical_movement"}]
"@

        try {
            $Result = Invoke-AIApi -Prompt $Prompt -Model $Model -ApiKey $ResolvedKey `
                -Temperature 0.2 -MaxTokens 8192 -JsonMode -TimeoutSec 60
            if ($Result -and $Result.Text) {
                $CleanText = $Result.Text -replace '^\s*```json\s*', '' -replace '\s*```\s*$', ''
                # Extract the first complete JSON array — LLMs sometimes append trailing content
                $ArrStart = $CleanText.IndexOf('[')
                if ($ArrStart -ge 0) {
                    $Depth = 0; $InStr = $false; $Esc = $false
                    for ($jx = $ArrStart; $jx -lt $CleanText.Length; $jx++) {
                        $Ch = $CleanText[$jx]
                        if ($Esc) { $Esc = $false; continue }
                        if ($Ch -eq '\' -and $InStr) { $Esc = $true; continue }
                        if ($Ch -eq '"') { $InStr = -not $InStr; continue }
                        if (-not $InStr) {
                            if ($Ch -eq '[') { $Depth++ }
                            elseif ($Ch -eq ']') { $Depth--; if ($Depth -eq 0) { $CleanText = $CleanText.Substring($ArrStart, $jx - $ArrStart + 1); break } }
                        }
                    }
                }
                $Enriched = $CleanText | ConvertFrom-Json
                foreach ($E in @($Enriched)) {
                    if (-not $E.name) { continue }
                    # Dedup guard: if enriched name is a near-duplicate of an existing
                    # cache key (same category), reuse the existing key instead of creating
                    # a new entry (prevents duplicate lineage entries — t/330)
                    $ExistingMatch = $null
                    foreach ($CKey in @($Cache.Keys)) {
                        if ($Cache[$CKey].category -ne $E.category) { continue }
                        # Quick string similarity check (Jaccard on words)
                        $W1 = @($E.name.ToLower() -split '\W+' | Where-Object { $_.Length -gt 2 })
                        $W2 = @($CKey.ToLower() -split '\W+' | Where-Object { $_.Length -gt 2 })
                        if ($W1.Count -eq 0 -or $W2.Count -eq 0) { continue }
                        $Inter = @($W1 | Where-Object { $_ -in $W2 }).Count
                        $Union = @($W1 + $W2 | Select-Object -Unique).Count
                        if ($Union -gt 0 -and ($Inter / $Union) -gt 0.75) {
                            $ExistingMatch = $CKey
                            break
                        }
                    }
                    if ($ExistingMatch) {
                        # Map enriched name to existing canonical, and also add the
                        # original name to cache so bare-string lookup succeeds
                        if ($E.name -ne $ExistingMatch) {
                            $DedupMap[$E.name] = $ExistingMatch
                            $Cache[$E.name] = $Cache[$ExistingMatch]  # alias to same data
                            Write-Verbose "  Dedup guard: '$($E.name)' → existing '$ExistingMatch'"
                        }
                    } else {
                        # Validate URL before caching — never store hallucinated URLs
                        $ValidatedUrl = $E.url
                        if (-not $SkipUrlValidation -and -not [string]::IsNullOrWhiteSpace($ValidatedUrl)) {
                            if (-not (Test-LineageUrl $ValidatedUrl)) {
                                $WikiFallback = Get-WikipediaFallbackUrl $E.name
                                if ($WikiFallback) {
                                    Write-Verbose "  URL fallback: '$($E.name)' → Wikipedia"
                                    $ValidatedUrl = $WikiFallback
                                } else {
                                    Write-Verbose "  URL cleared: '$($E.name)' (invalid, no Wikipedia)"
                                    $ValidatedUrl = $null
                                }
                            }
                        }
                        $Cache[$E.name] = @{
                            description = $E.description
                            url         = $ValidatedUrl
                            url_status  = if ($ValidatedUrl) { 200 } else { 'cleared' }
                            category    = $E.category
                        }
                        $DescPreview = if ($E.description.Length -gt 60) { $E.description.Substring(0, 60) + '...' } else { $E.description }
                        Write-Verbose "  Enriched: '$($E.name)' [$($E.category)] → $DescPreview"
                    }
                }
                Write-Host " $(@($Enriched).Count) enriched" -ForegroundColor Green
            }
            else {
                Write-Host " no response" -ForegroundColor Red
            }
        }
        catch {
            Write-Host " failed: $($_.Exception.Message)" -ForegroundColor Red
        }

        # Brief pause between batches to avoid rate limits
        if ($BatchNum -lt $TotalBatches) { Start-Sleep -Seconds 2 }
    }

    # ── Save cache ────────────────────────────────────────────────────────────
    if ($Cache.Count -gt 0) {
        $Cache | ConvertTo-Json -Depth 5 | Set-Content -Path $CachePath -Encoding UTF8
        Write-Host "Cache saved: $($Cache.Count) entries → $CachePath" -ForegroundColor Green
    }

    # ── URL validation (GET-based, soft 404 detection, Wikipedia fallback) ───
    $UrlValid = 0; $UrlInvalid = 0; $UrlSkipped = 0; $UrlWikiFallback = 0
    if (-not $SkipUrlValidation) {
        # Only validate entries not already checked in this run
        $ToValidate = @($Cache.GetEnumerator() | Where-Object { -not $_.Value.ContainsKey('url_status') })
        if ($ToValidate.Count -gt 0) {
            Write-Host "`nValidating $($ToValidate.Count) URLs (GET)..." -ForegroundColor Cyan
            foreach ($KV in $ToValidate) {
                $Entry = $KV.Value
                if (-not $Entry['url'] -or $Entry['url'] -notmatch '^https?://') {
                    $UrlSkipped++
                    $Entry['url_status'] = 'cleared'
                    continue
                }
                if (Test-LineageUrl $Entry['url']) {
                    $UrlValid++
                    $Entry['url_status'] = 200
                } else {
                    # Try Wikipedia fallback
                    $WikiUrl = Get-WikipediaFallbackUrl $KV.Key
                    if ($WikiUrl) {
                        $Entry['url'] = $WikiUrl
                        $Entry['url_status'] = 200
                        $UrlWikiFallback++
                    } else {
                        $Entry['url'] = $null
                        $Entry['url_status'] = 'cleared'
                        $UrlInvalid++
                    }
                }
            }
            Write-Host "  Valid: $UrlValid | Wiki fallback: $UrlWikiFallback | Cleared: $UrlInvalid | Skipped: $UrlSkipped"

            # Re-save cache with url_status
            $Cache | ConvertTo-Json -Depth 5 | Set-Content -Path $CachePath -Encoding UTF8
        }
    }

    # ── Apply enrichments to taxonomy files ───────────────────────────────────
    Write-Host "`nApplying enrichments to taxonomy files..." -ForegroundColor Cyan
    $TotalUpdated = 0

    # Build case-insensitive lookup for cache keys (AI may return different casing)
    $CacheLookup = @{}
    foreach ($CKey in $Cache.Keys) { $CacheLookup[$CKey.ToLower()] = $CKey }

    foreach ($PovName in $TaxData.Keys) {
        $Data = $TaxData[$PovName]
        $Modified = $false

        foreach ($Node in $Data.nodes) {
            if (-not $Node.PSObject.Properties['graph_attributes'] -or -not $Node.graph_attributes) { continue }
            $GA = $Node.graph_attributes
            if (-not $GA.PSObject.Properties['intellectual_lineage']) { continue }
            $Lin = @($GA.intellectual_lineage)
            $NeedUpdate = $false

            foreach ($Entry in $Lin) {
                if ($Entry -is [string] -and ($Cache.ContainsKey($Entry) -or $CacheLookup.ContainsKey($Entry.ToLower()))) { $NeedUpdate = $true; break }
            }
            if (-not $NeedUpdate) { continue }

            # Replace bare strings with rich objects
            $NewLin = @(foreach ($Entry in $Lin) {
                if ($Entry -is [string]) {
                    # Case-insensitive cache lookup
                    $CacheKey = if ($Cache.ContainsKey($Entry)) { $Entry }
                                elseif ($CacheLookup.ContainsKey($Entry.ToLower())) { $CacheLookup[$Entry.ToLower()] }
                                else { $null }
                    if ($CacheKey) {
                        $Cached = $Cache[$CacheKey]
                        [ordered]@{
                            name        = $Entry
                            description = $Cached.description
                            url         = $Cached.url
                            category    = $Cached.category
                        }
                    } else {
                        # No cache hit — keep as bare string
                        $Entry
                    }
                }
                else {
                    # Already a rich object
                    $Entry
                }
            })

            if ($PSCmdlet.ShouldProcess("$($Node.id) ($($NewLin.Count) lineage entries)", 'Enrich lineage')) {
                $BareFixed = @($Lin | Where-Object { $_ -is [string] }).Count
                $RichKept = @($Lin | Where-Object { $_ -isnot [string] }).Count
                Write-Verbose "  $($Node.id) [$PovName]: $BareFixed bare → enriched, $RichKept already rich"
                $GA.intellectual_lineage = $NewLin
                $Modified = $true
                $TotalUpdated++
            }
        }

        if ($Modified) {
            $FilePath = Join-Path $TaxDir "$PovName.json"
            $Data | ConvertTo-Json -Depth 20 | Set-Content -Path $FilePath -Encoding UTF8
            Write-Host "  Saved $PovName.json" -ForegroundColor Green
        }
    }

    Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
    Write-Host "  Unique values: $($UniqueValues.Count)"
    Write-Host "  Enriched (new): $($NeedEnrichment.Count)"
    Write-Host "  From cache: $AlreadyCached"
    Write-Host "  Nodes updated: $TotalUpdated"
    if (-not $SkipUrlValidation) {
        Write-Host "  URLs valid: $UrlValid | invalid: $UrlInvalid"
    }
    } # end
}
