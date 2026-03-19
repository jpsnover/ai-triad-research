# One-shot script: add "(about ...)" context to bare intellectual_lineage entries
#Requires -Version 7.0
Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'AITriad' 'AITriad.psd1') -Force
Import-Module (Join-Path $PSScriptRoot 'AIEnrich.psm1') -Force

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$TaxDir   = Join-Path $RepoRoot 'taxonomy' 'Origin'

# Collect all bare lineage entries (no parenthetical context)
$Items = [System.Collections.Generic.List[PSCustomObject]]::new()
$Seen  = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

foreach ($pov in 'accelerationist', 'safetyist', 'skeptic', 'cross-cutting') {
    $data = Get-Content (Join-Path $TaxDir "$pov.json") -Raw | ConvertFrom-Json
    foreach ($n in $data.nodes) {
        if (-not $n.graph_attributes -or -not $n.graph_attributes.intellectual_lineage) { continue }
        foreach ($il in $n.graph_attributes.intellectual_lineage) {
            if ($il -match '\(') { continue }  # already has context
            if ($Seen.Contains($il)) { continue }
            [void]$Seen.Add($il)
            $Items.Add([PSCustomObject]@{
                original = $il
                node_id  = $n.id
                label    = $n.label
            })
        }
    }
}

Write-Host "Unique bare lineage entries to annotate: $($Items.Count)"

# Build batched prompt
$entries = [System.Collections.Generic.List[string]]::new()
for ($i = 0; $i -lt $Items.Count; $i++) {
    $entries.Add("[$i] $($Items[$i].original)")
}

$promptTemplate = @'
You are annotating intellectual lineage entries for an AI policy taxonomy.

Each entry is a bare name of a thinker, movement, theory, or framework.
Add a SHORT parenthetical "(about ...)" that explains what it is in plain language.

RULES:
- Keep the original name EXACTLY as-is. Only append "(about ...)".
- The parenthetical should be 5-15 words, plain language, grade-10 level.
- Focus on WHAT IT IS, not why it matters.
- If the entry already contains enough context, add a minimal clarification.

EXAMPLES:
  "Singularitarianism" → "Singularitarianism (about the belief that AI will trigger rapid, irreversible change)"
  "Schumpeterian innovation theory" → "Schumpeterian innovation theory (about how new inventions destroy old industries to create new ones)"
  "Nuclear Arms Race analogy" → "Nuclear Arms Race analogy (about comparing AI competition to Cold War weapons buildup)"
  "Virtue ethics" → "Virtue ethics (about judging actions by character traits rather than rules or outcomes)"

Return a JSON array where each element has:
  {"index": N, "annotated": "original name (about ...)"}

Return ONLY the JSON array. No markdown fences.

'@

Write-Host "Unique entries: $($Items.Count), will process in batches of 200"

# Process in batches of 200 to avoid truncation
$BatchSize = 200
$LookupMap = @{}

for ($batchStart = 0; $batchStart -lt $Items.Count; $batchStart += $BatchSize) {
    $batchEnd = [Math]::Min($batchStart + $BatchSize, $Items.Count) - 1
    $batchItems = $Items[$batchStart..$batchEnd]

    $batchEntries = [System.Collections.Generic.List[string]]::new()
    for ($j = 0; $j -lt $batchItems.Count; $j++) {
        $globalIdx = $batchStart + $j
        $batchEntries.Add("[$globalIdx] $($batchItems[$j].original)")
    }

    $batchPrompt = $promptTemplate + "`n`n" + ($batchEntries -join "`n")
    $batchNum = [Math]::Floor($batchStart / $BatchSize) + 1
    $totalBatches = [Math]::Ceiling($Items.Count / $BatchSize)
    Write-Host "Batch $batchNum/$totalBatches : $($batchItems.Count) entries, $($batchPrompt.Length) chars"

    $response = Invoke-AIApi -Prompt $batchPrompt -Model 'gemini-2.5-flash' -MaxTokens 32768 -Temperature 0.3 -TimeoutSec 300
    if (-not $response) {
        Write-Error "AI API returned null for batch $batchNum"
        continue
    }

    $responseText = if ($response -is [string]) { $response } elseif ($response.Text) { $response.Text } else { "$response" }

    $cleaned = ($responseText -replace '(?s)^```json\s*', '' -replace '```\s*$', '').Trim()
    try {
        $rewrites = $cleaned | ConvertFrom-Json
    } catch {
        Write-Error "Failed to parse batch $batchNum response: $_"
        Write-Host $cleaned.Substring(0, [Math]::Min(500, $cleaned.Length))
        continue
    }

    Write-Host "  Parsed $($rewrites.Count) annotations from batch $batchNum"

    foreach ($rw in $rewrites) {
        $idx = [int]$rw.index
        if ($idx -lt 0 -or $idx -ge $Items.Count) { continue }
        $LookupMap[$Items[$idx].original] = $rw.annotated
    }
}

Write-Host "Mapped $($LookupMap.Count) annotations"

# Apply to all taxonomy files
foreach ($pov in 'accelerationist', 'safetyist', 'skeptic', 'cross-cutting') {
    $filePath = Join-Path $TaxDir "$pov.json"
    $data = Get-Content $filePath -Raw | ConvertFrom-Json
    $changed = $false

    foreach ($n in $data.nodes) {
        if (-not $n.graph_attributes -or -not $n.graph_attributes.intellectual_lineage) { continue }
        $newLineage = @()
        foreach ($il in $n.graph_attributes.intellectual_lineage) {
            if ($il -notmatch '\(' -and $LookupMap.ContainsKey($il)) {
                $newLineage += $LookupMap[$il]
                $changed = $true
            } else {
                $newLineage += $il
            }
        }
        $n.graph_attributes.intellectual_lineage = $newLineage
    }

    if ($changed) {
        $data | ConvertTo-Json -Depth 20 | Set-Content -Path $filePath -Encoding UTF8
        Write-Host "  Updated: taxonomy/Origin/$pov.json"
    }
}

Write-Host "`nDone! Annotated $($LookupMap.Count) intellectual lineage entries with '(about ...)' context."
