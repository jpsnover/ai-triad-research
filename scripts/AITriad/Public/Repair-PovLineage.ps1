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
          - description: 1-2 sentence definition
          - url: Wikipedia or authoritative URL (validated via HEAD request)
          - category: philosophical_movement, economic_theory, etc.

        Processes unique values in batch (not per-node) to minimize AI calls.
        Caches results in a lineage-enrichments.json file for incremental re-runs.
    .PARAMETER POV
        Filter to a specific POV file.
    .PARAMETER Model
        AI model for enrichment. Default: gemini-3.1-flash-lite-preview.
    .PARAMETER ApiKey
        AI API key. Resolved from env if omitted.
    .PARAMETER BatchSize
        Number of lineage values per AI call. Default: 25.
    .PARAMETER SkipUrlValidation
        Skip HTTP HEAD URL validation (faster for testing).
    .EXAMPLE
        Repair-PovLineage -WhatIf
    .EXAMPLE
        Repair-PovLineage -POV accelerationist -BatchSize 10
    .EXAMPLE
        Repair-PovLineage -SkipUrlValidation
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'situations')]
        [string]$POV,

        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [string]$Model = 'gemini-3.1-flash-lite-preview',

        [string]$ApiKey,

        [ValidateRange(5, 50)]
        [int]$BatchSize = 25,

        [switch]$SkipUrlValidation,

        [switch]$FixUrls
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $TaxDir = Get-TaxonomyDir
    $CacheDir = Join-Path (Get-DataRoot) 'calibration'
    if (-not (Test-Path $CacheDir)) { $null = New-Item -ItemType Directory -Path $CacheDir -Force }
    $CachePath = Join-Path $CacheDir 'lineage-enrichments.json'

    # ── Load cache ────────────────────────────────────────────────────────────
    $Cache = @{}
    if (Test-Path $CachePath) {
        $CacheData = Get-Content $CachePath -Raw | ConvertFrom-Json -AsHashtable
        if ($CacheData) { $Cache = $CacheData }
        Write-Verbose "Loaded $($Cache.Count) cached enrichments"
    }

    # ── FixUrls mode: repair broken URLs from error file ──────────────────────
    if ($FixUrls) {
        $ErrorFilePath = Join-Path $CacheDir 'lineage-url-errors.json'
        if (-not (Test-Path $ErrorFilePath)) {
            Write-Warning "No URL error file found at $ErrorFilePath — run without -FixUrls first to generate it"
            return
        }

        $UrlErrors = Get-Content $ErrorFilePath -Raw | ConvertFrom-Json
        $Err404 = @($UrlErrors | Where-Object { $_.status -eq 404 })
        $Err429 = @($UrlErrors | Where-Object { $_.status -eq 429 })

        Write-Host "=== Fix Broken URLs ===" -ForegroundColor Cyan
        Write-Host "  404 (need new URL): $($Err404.Count)"
        Write-Host "  429 (retry): $($Err429.Count)"

        # Retry 429s with longer delay
        if ($Err429.Count -gt 0 -and -not $WhatIfPreference) {
            Write-Host "`nRetrying $($Err429.Count) rate-limited URLs..." -ForegroundColor Gray
            $Still429 = [System.Collections.Generic.List[object]]::new()
            foreach ($Err in $Err429) {
                Start-Sleep -Seconds 3
                try {
                    $Resp = Invoke-WebRequest -Uri $Err.url -Method Head -TimeoutSec 10 -ErrorAction Stop -UseBasicParsing
                    if ($Resp.StatusCode -eq 200) {
                        Write-Host "  OK: $($Err.name)" -ForegroundColor Green
                    } else {
                        $Still429.Add($Err)
                    }
                } catch { $Still429.Add($Err) }
            }
            if ($Still429.Count -gt 0) { Write-Host "  Still failing: $($Still429.Count)" -ForegroundColor Yellow }
        }

        # Fix 404s via AI
        if ($Err404.Count -gt 0) {
            if ($WhatIfPreference) {
                Write-Host "`nWhatIf: Would fix $($Err404.Count) broken URLs in $([Math]::Ceiling($Err404.Count / $BatchSize)) AI batches"
                Write-Host "Sample broken URLs:"
                $Err404 | Select-Object -First 10 | ForEach-Object {
                    Write-Host "  $($_.name): $($_.url)" -ForegroundColor DarkGray
                }
                return
            }

            if ($Model -match '^gemini') { $Backend = 'gemini' }
            elseif ($Model -match '^claude') { $Backend = 'claude' }
            else { $Backend = 'gemini' }
            $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend
            if ([string]::IsNullOrWhiteSpace($ResolvedKey)) {
                Write-Warning "No API key — cannot fix URLs"
                return
            }

            $FixedCount = 0
            $UrlBatches = [Math]::Ceiling($Err404.Count / $BatchSize)
            for ($bi = 0; $bi -lt $Err404.Count; $bi += $BatchSize) {
                $Batch = @($Err404[$bi..[Math]::Min($bi + $BatchSize - 1, $Err404.Count - 1)])
                $BatchNum = [Math]::Floor($bi / $BatchSize) + 1
                Write-Host "  URL batch $BatchNum/$UrlBatches ($($Batch.Count) URLs)..." -ForegroundColor Gray -NoNewline

                $UrlList = ($Batch | ForEach-Object { "- $($_.name) (broken: $($_.url))" }) -join "`n"
                $Prompt = @"
For each intellectual lineage entry, find the correct URL. Prefer Wikipedia. If no Wikipedia article exists, suggest Stanford Encyclopedia of Philosophy, official project page, or seminal paper DOI.

Broken URLs to fix:
$UrlList

Return JSON array: [{"name": "...", "url": "https://..."}]
No markdown, no explanation.
"@
                try {
                    $Result = Invoke-AIApi -Prompt $Prompt -Model $Model -ApiKey $ResolvedKey `
                        -Temperature 0.1 -MaxTokens 4096 -JsonMode -TimeoutSec 30
                    if ($Result -and $Result.Text) {
                        $Fixed = ($Result.Text -replace '^\s*```json\s*', '' -replace '\s*```\s*$', '') | ConvertFrom-Json
                        foreach ($F in @($Fixed)) {
                            if ($F.name -and $F.url -and $Cache.ContainsKey($F.name)) {
                                $Cache[$F.name].url = $F.url
                                if ($Cache[$F.name].ContainsKey('url_status')) { $Cache[$F.name].Remove('url_status') }
                                $FixedCount++
                            }
                        }
                        Write-Host " $(@($Fixed).Count) fixed" -ForegroundColor Green
                    }
                } catch {
                    Write-Host " failed: $($_.Exception.Message)" -ForegroundColor Red
                }
                if ($BatchNum -lt $UrlBatches) { Start-Sleep -Seconds 2 }
            }

            # Save updated cache
            $Cache | ConvertTo-Json -Depth 5 | Set-Content -Path $CachePath -Encoding UTF8
            Write-Host "`nFixed $FixedCount URLs in cache" -ForegroundColor Green

            # Update taxonomy files with fixed URLs
            $TaxUpdated = 0
            foreach ($PovName in @('accelerationist', 'safetyist', 'skeptic', 'situations')) {
                $FilePath = Join-Path $TaxDir "$PovName.json"
                if (-not (Test-Path $FilePath)) { continue }
                $Data = Get-Content $FilePath -Raw | ConvertFrom-Json
                $PovMod = $false
                foreach ($Node in $Data.nodes) {
                    if (-not $Node.PSObject.Properties['graph_attributes'] -or -not $Node.graph_attributes) { continue }
                    $GA = $Node.graph_attributes
                    if (-not $GA.PSObject.Properties['intellectual_lineage']) { continue }
                    $Lin = @($GA.intellectual_lineage)
                    $Changed = $false
                    $NewLin = @(foreach ($Entry in $Lin) {
                        if ($Entry -is [PSCustomObject] -and $Entry.PSObject.Properties['name'] -and $Cache.ContainsKey($Entry.name)) {
                            $Cached = $Cache[$Entry.name]
                            if ($Cached.url -and $Entry.url -ne $Cached.url) {
                                $Entry.url = $Cached.url
                                $Changed = $true
                            }
                        }
                        $Entry
                    })
                    if ($Changed) { $PovMod = $true; $TaxUpdated++ }
                }
                if ($PovMod) {
                    $Data | ConvertTo-Json -Depth 20 | Set-Content -Path $FilePath -Encoding UTF8
                }
            }
            Write-Host "Updated $TaxUpdated node lineage entries in taxonomy files" -ForegroundColor Green
        }
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
            if (-not $Node.PSObject.Properties['graph_attributes'] -or -not $Node.graph_attributes) { continue }
            $GA = $Node.graph_attributes
            if (-not $GA.PSObject.Properties['intellectual_lineage']) { continue }
            foreach ($Entry in @($GA.intellectual_lineage)) {
                if ($Entry -is [string] -and -not [string]::IsNullOrWhiteSpace($Entry)) {
                    [void]$UniqueValues.Add($Entry)
                }
            }
        }
    }

    Write-Host "Unique lineage values: $($UniqueValues.Count)" -ForegroundColor Cyan

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
                $Canonicals.Add($Val)
                continue
            }
            $Vec = $Embeddings[$Val]
            $Merged = $false

            for ($j = 0; $j -lt $Canonicals.Count; $j++) {
                $CanVec = $CanonicalVecs[$j]
                # Cosine similarity (vectors are normalized)
                $Dot = 0.0
                for ($k = 0; $k -lt $Vec.Count; $k++) { $Dot += $Vec[$k] * $CanVec[$k] }
                if ($Dot -ge $DedupThreshold) {
                    # Guard: don't merge parenthetical-qualified variants — qualifiers
                    # are semantically meaningful (e.g., "AI alignment research (positive vision)"
                    # vs "AI alignment research" represent different intellectual traditions)
                    $CanName = $Canonicals[$j]
                    # Case 1: one is qualified, other is the bare base
                    $IsParenVariant = ($Val -match '^(.+?)\s*\(' -and $CanName -eq $Matches[1].Trim()) -or
                                     ($CanName -match '^(.+?)\s*\(' -and $Val -eq $Matches[1].Trim())
                    # Case 2: both are qualified variants of the same base (different qualifiers)
                    if (-not $IsParenVariant -and $Val -match '^(.+?)\s*\(' -and $CanName -match '^(.+?)\s*\(') {
                        $ValBase = ($Val -replace '\s*\([^)]+\)\s*$','').Trim()
                        $CanBase = ($CanName -replace '\s*\([^)]+\)\s*$','').Trim()
                        if ($ValBase -eq $CanBase) { $IsParenVariant = $true }
                    }
                    if ($IsParenVariant) { continue }
                    # Merge: pick the one with higher frequency as canonical
                    $CanFreq = $FreqMap[$CanName] ?? 0
                    $ValFreq = $FreqMap[$Val] ?? 0
                    if ($ValFreq -gt $CanFreq) {
                        # New value is more popular — swap canonical
                        $DedupMap[$CanName] = $Val
                        $Canonicals[$j] = $Val
                        $CanonicalVecs[$j] = $Vec
                    }
                    else {
                        $DedupMap[$Val] = $CanName
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

    $NeedEnrichment = @($UniqueValues | Where-Object { -not $Cache.ContainsKey($_) })
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
        Write-Host "  Batch $BatchNum/$TotalBatches ($($Batch.Count) values)..." -ForegroundColor Gray -NoNewline

        $BatchList = ($Batch | ForEach-Object { "- $_" }) -join "`n"
        $Prompt = @"
Enrich each intellectual lineage entry with a description, URL, and category.

For each entry, provide:
- name: the original name (verbatim)
- description: 1-2 sentence definition accessible to a policy audience
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
                $Enriched = $CleanText | ConvertFrom-Json
                foreach ($E in @($Enriched)) {
                    if ($E.name) {
                        $Cache[$E.name] = @{
                            description = $E.description
                            url         = $E.url
                            category    = $E.category
                        }
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

    # ── URL validation ────────────────────────────────────────────────────────
    $UrlValid = 0; $UrlInvalid = 0; $UrlSkipped = 0
    if (-not $SkipUrlValidation) {
        Write-Host "`nValidating URLs..." -ForegroundColor Cyan
        foreach ($Key in @($Cache.Keys)) {
            $Entry = $Cache[$Key]
            if (-not $Entry.url -or $Entry.url -notmatch '^https?://') {
                $UrlSkipped++
                continue
            }
            try {
                $Resp = Invoke-WebRequest -Uri $Entry.url -Method Head -TimeoutSec 5 -ErrorAction Stop -UseBasicParsing
                if ($Resp.StatusCode -eq 200) { $UrlValid++ }
                else { $UrlInvalid++; $Entry['url_status'] = $Resp.StatusCode }
            }
            catch {
                $UrlInvalid++
                $Entry['url_status'] = 'error'
            }
        }
        Write-Host "  Valid: $UrlValid | Invalid: $UrlInvalid | Skipped: $UrlSkipped"

        # Re-save cache with url_status
        $Cache | ConvertTo-Json -Depth 5 | Set-Content -Path $CachePath -Encoding UTF8
    }

    # ── Apply enrichments to taxonomy files ───────────────────────────────────
    Write-Host "`nApplying enrichments to taxonomy files..." -ForegroundColor Cyan
    $TotalUpdated = 0

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
                if ($Entry -is [string] -and $Cache.ContainsKey($Entry)) { $NeedUpdate = $true; break }
            }
            if (-not $NeedUpdate) { continue }

            # Replace bare strings with rich objects
            $NewLin = @(foreach ($Entry in $Lin) {
                if ($Entry -is [string] -and $Cache.ContainsKey($Entry)) {
                    $Cached = $Cache[$Entry]
                    [ordered]@{
                        name        = $Entry
                        description = $Cached.description
                        url         = $Cached.url
                        category    = $Cached.category
                    }
                }
                elseif ($Entry -is [string]) {
                    # No cache hit — keep as bare string
                    $Entry
                }
                else {
                    # Already a rich object
                    $Entry
                }
            })

            if ($PSCmdlet.ShouldProcess("$($Node.id) ($($NewLin.Count) lineage entries)", 'Enrich lineage')) {
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
}
