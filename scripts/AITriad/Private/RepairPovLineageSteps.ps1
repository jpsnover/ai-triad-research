# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Steps of Repair-PovLineage (t/3910 complexity refactor). Behaviour is pinned by
# tests/Repair-PovLineage.Characterization.Tests.ps1. These helpers run under the caller's
# Set-StrictMode -Version Latest and $ErrorActionPreference = 'Stop' (dynamic scope), and read the
# caller's $WhatIfPreference the same way. Helpers that may write a warning are called as plain
# statements, so the caller's -WarningVariable still collects it (Sage #221).

$script:LineagePovFiles = @('accelerationist', 'safetyist', 'skeptic', 'situations')

# ── Shared ────────────────────────────────────────────────────────────────────

function Resolve-LineageBackend {
    # The API-key backend for a model id; anything unrecognized resolves as gemini.
    param([string]$Model)
    if ($Model -match '^gemini') { return 'gemini' }
    if ($Model -match '^claude') { return 'claude' }
    if ($Model -match '^openai') { return 'openai' }
    'gemini'
}

function Get-LineageNodeAttribute {
    # The node's graph_attributes when they carry an intellectual_lineage property, else $null.
    param($Node)
    if (-not $Node.PSObject.Properties['graph_attributes'] -or -not $Node.graph_attributes) { return $null }
    $GA = $Node.graph_attributes
    if (-not $GA.PSObject.Properties['intellectual_lineage']) { return $null }
    $GA
}

function Get-LineageWikipediaUrl {
    # The en.wikipedia.org URL for a lineage name (trailing parenthetical dropped), when it validates.
    param([string]$Name)
    $WikiName = ($Name -replace '\s*\([^)]+\)\s*$', '').Trim() -replace '\s+', '_'
    $WikiUrl = "https://en.wikipedia.org/wiki/$WikiName"
    if (Test-LineageUrl $WikiUrl) { return $WikiUrl }
    return $null
}

function Get-LineageFirstJson {
    # The first complete JSON value starting at the first $Open bracket (LLMs sometimes append trailing
    # content). Returns $Text unchanged when there is no $Open bracket or the value never closes.
    param([string]$Text, [char]$Open, [char]$Close)
    $Start = $Text.IndexOf($Open)
    if ($Start -lt 0) { return $Text }
    $Depth = 0; $InStr = $false; $Esc = $false
    for ($jx = $Start; $jx -lt $Text.Length; $jx++) {
        $Ch = $Text[$jx]
        if ($Esc) { $Esc = $false; continue }
        if ($Ch -eq '\' -and $InStr) { $Esc = $true; continue }
        if ($Ch -eq '"') { $InStr = -not $InStr; continue }
        if ($InStr) { continue }
        if ($Ch -eq $Open) { $Depth++ }
        elseif ($Ch -eq $Close) {
            $Depth--
            if ($Depth -eq 0) { return $Text.Substring($Start, $jx - $Start + 1) }
        }
    }
    $Text
}

function ConvertFrom-LineageAiJson {
    # An AI response's JSON: ```json fences stripped, first complete value extracted, then parsed.
    param([string]$Text, [char]$Open, [char]$Close)
    $CleanText = $Text -replace '^\s*```json\s*', '' -replace '\s*```\s*$', ''
    (Get-LineageFirstJson -Text $CleanText -Open $Open -Close $Close) | ConvertFrom-Json
}

# ── -FixUrls ──────────────────────────────────────────────────────────────────

function Get-LineageUrlCheckList {
    # Cache entries whose URL needs checking: an error status, no status, or no URL.
    param([System.Collections.IDictionary]$Cache)
    @($Cache.GetEnumerator() | Where-Object {
            $v = $_.Value
            ($v.ContainsKey('url_status') -and $v['url_status'] -ne 200) -or
            (-not $v.ContainsKey('url_status')) -or
            [string]::IsNullOrWhiteSpace($v['url'])
        })
}

function Repair-LineageCacheUrl {
    # Re-checks one cache entry's URL in place, falling back to Wikipedia. Returns valid, wiki or cleared.
    param([string]$Name, [System.Collections.IDictionary]$Data)
    $Url = $Data['url']
    if (-not [string]::IsNullOrWhiteSpace($Url) -and (Test-LineageUrl $Url)) {
        $Data['url_status'] = 200
        return 'valid'
    }
    $WikiUrl = Get-LineageWikipediaUrl $Name
    if ($WikiUrl) {
        $Data['url'] = $WikiUrl
        $Data['url_status'] = 200
        Write-Verbose "  Wiki fallback: $Name → $WikiUrl"
        return 'wiki'
    }
    $Data['url'] = $null
    $Data['url_status'] = 'cleared'
    Write-Verbose "  Cleared: $Name (no valid URL found)"
    'cleared'
}

function Sync-LineageEntryUrl {
    # Copies cached URLs onto the rich lineage entries of $Nodes. Returns how many entries changed.
    param($Nodes, [System.Collections.IDictionary]$Cache)
    $Changed = 0
    foreach ($Node in $Nodes) {
        $GA = Get-LineageNodeAttribute $Node
        if ($null -eq $GA) { continue }
        foreach ($LinEntry in @($GA.intellectual_lineage)) {
            if ($LinEntry -is [string] -or -not $LinEntry.PSObject.Properties['name'] -or -not $Cache.ContainsKey($LinEntry.name)) { continue }
            $Cached = $Cache[$LinEntry.name]
            $NewUrl = if ($Cached['url']) { $Cached['url'] } else { $null }
            if ($LinEntry.url -ne $NewUrl) {
                $LinEntry.url = $NewUrl
                $Changed++
            }
        }
    }
    $Changed
}

function Sync-LineageTaxonomyUrl {
    # Writes the fixed URLs into every POV file that has a changed entry. Returns the entries changed.
    param([string]$TaxDir, [System.Collections.IDictionary]$Cache)
    $TaxUpdated = 0
    foreach ($PovName in $script:LineagePovFiles) {
        $FilePath = Join-Path $TaxDir "$PovName.json"
        if (-not (Test-Path $FilePath)) { continue }
        $TaxFileData = Get-Content $FilePath -Raw | ConvertFrom-Json
        $Changed = Sync-LineageEntryUrl -Nodes $TaxFileData.nodes -Cache $Cache
        if ($Changed -gt 0) {
            Assert-DataWriteAllowed -Path $FilePath  # t/2902
            $TaxFileData | ConvertTo-Json -Depth 20 | Set-Content -Path $FilePath -Encoding UTF8
            Write-Host "  Saved $PovName.json" -ForegroundColor Green
        }
        $TaxUpdated += $Changed
    }
    $TaxUpdated
}

function Invoke-LineageUrlFix {
    # -FixUrls: validate cached URLs via GET with a Wikipedia fallback, then push them into the POV files.
    param([System.Collections.IDictionary]$Cache, [string]$CachePath, [string]$TaxDir)
    if ($Cache.Count -eq 0) {
        Write-Warning 'Cache is empty — run Repair-PovLineage first to populate it'
        return
    }

    Write-Host '=== Fix Broken URLs ===' -ForegroundColor Cyan
    $ToCheck = @(Get-LineageUrlCheckList -Cache $Cache)
    Write-Host "  Entries to check: $($ToCheck.Count) / $($Cache.Count)"

    if ($WhatIfPreference) {
        Write-Host "`nWhatIf: Would validate $($ToCheck.Count) URLs via GET with Wikipedia fallback"
        $ToCheck | Select-Object -First 10 | ForEach-Object {
            Write-Host "  $($_.Key): $($_.Value['url'])" -ForegroundColor DarkGray
        }
        return
    }

    $Tally = @{ valid = 0; wiki = 0; cleared = 0 }
    foreach ($Entry in $ToCheck) { $Tally[(Repair-LineageCacheUrl -Name $Entry.Key -Data $Entry.Value)]++ }
    Write-Host "  Already valid: $($Tally.valid) | Wikipedia fallback: $($Tally.wiki) | Cleared: $($Tally.cleared)"

    $Cache | ConvertTo-Json -Depth 5 | Set-Content -Path $CachePath -Encoding UTF8
    Write-Host "Cache saved" -ForegroundColor Green

    $TaxUpdated = Sync-LineageTaxonomyUrl -TaxDir $TaxDir -Cache $Cache
    Write-Host "Updated $TaxUpdated lineage entries in taxonomy files" -ForegroundColor Green
}

# ── -RegenerateContent ────────────────────────────────────────────────────────

function ConvertTo-LineageRegenItem {
    # One -RegenerateContent work item (the node's rich lineage entries plus prompt context), or $null.
    param($Node, [string]$PovName)
    $GA = Get-LineageNodeAttribute $Node
    if ($null -eq $GA) { return $null }
    $LinEntries = @($GA.intellectual_lineage)
    if ($LinEntries.Count -eq 0) { return $null }

    # Only process rich entries (have a name property)
    $RichEntries = @($LinEntries | Where-Object { $_ -isnot [string] -and $_.PSObject.Properties['name'] })
    if ($RichEntries.Count -eq 0) { return $null }

    $NodeCategory = if ($Node.PSObject.Properties['category']) { $Node.category } else { 'Situation' }
    $NodeDesc = if ($Node.PSObject.Properties['description']) { $Node.description } else { '' }
    @{
        pov      = $PovName
        node_id  = $Node.id
        label    = $Node.label
        desc     = $NodeDesc
        category = $NodeCategory
        entries  = $RichEntries
    }
}

function Get-LineageRegenNode {
    # Every node in $PovFiles (optionally filtered) with at least one rich lineage entry.
    param([string]$TaxDir, [string[]]$PovFiles, $FilterNodeIds)
    $NodesToProcess = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($PovName in $PovFiles) {
        $FilePath = Join-Path $TaxDir "$PovName.json"
        if (-not (Test-Path $FilePath)) { continue }
        $Data = Get-Content $FilePath -Raw | ConvertFrom-Json
        foreach ($Node in $Data.nodes) {
            if ($FilterNodeIds -and -not $FilterNodeIds.Contains($Node.id)) { continue }
            $Item = ConvertTo-LineageRegenItem -Node $Node -PovName $PovName
            if ($null -ne $Item) { $NodesToProcess.Add($Item) }
        }
    }
    , $NodesToProcess
}

function Format-LineageRegenPrompt {
    # The user prompt for one batch of -RegenerateContent nodes.
    param([object[]]$Batch)
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

    @"
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
}

function Merge-LineageRegenNode {
    # Applies one node's regenerated descriptions (over 100 chars) in place. Returns updated, unchanged or failed.
    param([hashtable]$Item, $Regenerated, [hashtable]$PovModified)
    $NodeId = $Item.node_id
    if (-not $Regenerated.PSObject.Properties[$NodeId]) {
        Write-Verbose "  $NodeId — not in response, skipping"
        return 'failed'
    }
    $NewEntries = @($Regenerated.$NodeId)
    if ($NewEntries.Count -eq 0) {
        Write-Verbose "  $NodeId — empty entries in response"
        return 'failed'
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
        if (-not $DescLookup.ContainsKey($OrigEntry.name)) { continue }
        $NewDesc = $DescLookup[$OrigEntry.name]
        if ($NewDesc.Length -gt 100) {
            $OrigEntry.description = $NewDesc
            $Updated++
        }
    }
    if ($Updated -eq 0) { return 'unchanged' }
    $PovModified[$Item.pov] = $true
    Write-Verbose "  $NodeId — $Updated/$($Item.entries.Count) entries updated"
    'updated'
}

function Invoke-LineageRegenBatch {
    # One AI call for a batch of nodes. Returns { Updated; Failed; NoResponse }.
    param([object[]]$Batch, [string]$SystemPrompt, [string]$Model, [string]$ResolvedKey, [hashtable]$PovModified)
    $Outcome = @{ Updated = 0; Failed = 0; NoResponse = $false }
    try {
        $Result = Invoke-AIApi -Prompt (Format-LineageRegenPrompt -Batch $Batch) -SystemInstruction $SystemPrompt `
            -Model $Model -ApiKey $ResolvedKey `
            -Temperature 0.3 -MaxTokens 16384 -JsonMode

        if (-not $Result -or -not $Result.Text) {
            Write-Host " no response" -ForegroundColor Red
            $Outcome.Failed += $Batch.Count
            $Outcome.NoResponse = $true
            return $Outcome
        }

        $Regenerated = ConvertFrom-LineageAiJson -Text $Result.Text -Open '{' -Close '}'
        foreach ($Item in $Batch) {
            switch (Merge-LineageRegenNode -Item $Item -Regenerated $Regenerated -PovModified $PovModified) {
                'updated' { $Outcome.Updated++ }
                'failed'  { $Outcome.Failed++ }
            }
        }
        Write-Host " done ($($Batch.Count) nodes)" -ForegroundColor Green
    }
    catch {
        Write-Host " failed: $($_.Exception.Message)" -ForegroundColor Red
        $Outcome.Failed += $Batch.Count
    }
    $Outcome
}

function Save-LineageRegenFile {
    # Re-reads each modified POV file, swaps in the regenerated entries, and writes it.
    param([string]$TaxDir, [hashtable]$PovModified, $NodesToProcess)
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

        Assert-DataWriteAllowed -Path $FilePath  # t/2902
        $Data | ConvertTo-Json -Depth 20 | Set-Content -Path $FilePath -Encoding UTF8
        Write-Host "  Saved $PovName.json" -ForegroundColor Green
    }
}

function Invoke-LineageRegenerate {
    # -RegenerateContent: per-node 2-4 paragraph descriptions for existing rich lineage entries.
    param([string]$TaxDir, [string[]]$PovFiles, $FilterNodeIds, [string]$Model, [string]$ApiKey, [int]$NodeBatchSize)
    $SystemPrompt = Get-Prompt -Name 'lineage-regenerate'

    $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend (Resolve-LineageBackend $Model)
    if ([string]::IsNullOrWhiteSpace($ResolvedKey)) {
        throw (New-ActionableError `
            -Goal 'Regenerate lineage content' `
            -Problem 'No API key available' `
            -Location 'Repair-PovLineage -RegenerateContent' `
            -NextSteps @('Set GEMINI_API_KEY or ANTHROPIC_API_KEY environment variable', 'Pass -ApiKey parameter'))
    }

    $NodesToProcess = Get-LineageRegenNode -TaxDir $TaxDir -PovFiles $PovFiles -FilterNodeIds $FilterNodeIds

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

        $Outcome = Invoke-LineageRegenBatch -Batch $Batch -SystemPrompt $SystemPrompt -Model $Model -ResolvedKey $ResolvedKey -PovModified $PovModified
        $TotalUpdated += $Outcome.Updated
        $TotalFailed += $Outcome.Failed

        # A batch with no response skips the pause, as it always has.
        if (-not $Outcome.NoResponse -and $BatchNum -lt $TotalBatches) { Start-Sleep -Seconds 1 }
    }

    Save-LineageRegenFile -TaxDir $TaxDir -PovModified $PovModified -NodesToProcess $NodesToProcess

    Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
    Write-Host "  Nodes updated: $TotalUpdated"
    Write-Host "  Nodes failed: $TotalFailed"
    Write-Host "  POV files saved: $($PovModified.Keys -join ', ')"
}
