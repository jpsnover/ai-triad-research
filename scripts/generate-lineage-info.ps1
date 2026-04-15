# One-shot script: generate intellectualLineageInfo.ts entries for missing values
#Requires -Version 5.1
Set-StrictMode -Version Latest

Import-Module (Join-Path (Join-Path $PSScriptRoot 'AITriad') 'AITriad.psd1') -Force
Import-Module (Join-Path $PSScriptRoot 'AIEnrich.psm1') -Force

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$TaxDir   = Join-Path (Join-Path $RepoRoot 'taxonomy') 'Origin'

# Get all lineage values from taxonomy
$allLineage = [System.Collections.Generic.HashSet[string]]::new()
foreach ($pov in 'accelerationist', 'safetyist', 'skeptic', 'situations') {
    $data = Get-Content (Join-Path $TaxDir "$pov.json") -Raw | ConvertFrom-Json
    foreach ($n in $data.nodes) {
        if ($n.PSObject.Properties['graph_attributes'] -and $n.graph_attributes.intellectual_lineage) {
            foreach ($il in $n.graph_attributes.intellectual_lineage) {
                [void]$allLineage.Add($il)
            }
        }
    }
}

# Get existing keys from intellectualLineageInfo.ts
$tsFile = Join-Path (Join-Path (Join-Path (Join-Path (Join-Path $RepoRoot 'taxonomy-editor') 'src') 'renderer') 'data') 'intellectualLineageInfo.ts'
$tsContent = Get-Content $tsFile -Raw
$existingKeys = [System.Collections.Generic.HashSet[string]]::new()
foreach ($m in [regex]::Matches($tsContent, '(?m)^"([^"]+)":\s*\{')) {
    [void]$existingKeys.Add($m.Groups[1].Value)
}

$missing = @($allLineage | Where-Object { -not $existingKeys.Contains($_) } | Sort-Object)
Write-Host "Missing entries to generate: $($missing.Count)"

if ($missing.Count -eq 0) {
    Write-Host "All lineage values already have info entries."
    return
}

$promptTemplate = @'
You are generating reference content for an AI policy taxonomy tool's "About" panel.

For each intellectual lineage item below, produce a JSON object with these fields:
  - "key": the EXACT string as provided (case-sensitive)
  - "label": title-cased display name
  - "summary": 2-4 sentences explaining what this tradition/framework/thinker is and how it connects to AI policy. Write for a policy reporter — active voice, concrete examples, quotable sentences. Be specific and informative.
  - "example": 1 sentence starting with "A node tagged with this attribute..." showing how this appears in the taxonomy.
  - "frequency": 1 sentence like "Appears in [POV] nodes discussing [topic area]."
  - "links": array of 1-2 objects with "label" and "url" (Wikipedia preferred, use real URLs only)

RULES:
- summary should explain the concept itself AND its relevance to AI policy debates
- Do NOT use jargon without explanation
- URLs must be real Wikipedia or well-known reference URLs
- Escape single quotes in strings with \'
- Return ONLY a JSON array. No markdown fences.

'@

# Process in batches
$BatchSize = 35
$AllResults = [System.Collections.Generic.List[PSObject]]::new()

for ($batchStart = 0; $batchStart -lt $missing.Count; $batchStart += $BatchSize) {
    $batchEnd = [Math]::Min($batchStart + $BatchSize, $missing.Count) - 1
    $batchItems = $missing[$batchStart..$batchEnd]

    $itemList = ($batchItems | ForEach-Object { "- $_" }) -join "`n"
    $batchPrompt = $promptTemplate + "`n" + $itemList

    $batchNum = [Math]::Floor($batchStart / $BatchSize) + 1
    $totalBatches = [Math]::Ceiling($missing.Count / $BatchSize)
    Write-Host "Batch $batchNum/$totalBatches : $($batchItems.Count) entries ($($batchPrompt.Length) chars)"

    $response = Invoke-AIApi -Prompt $batchPrompt -Model 'gemini-2.5-flash' -MaxTokens 32768 -Temperature 0.3 -TimeoutSec 300
    if (-not $response) {
        Write-Error "AI API returned null for batch $batchNum"
        continue
    }

    if ($response -is [string]) { $responseText = $response } elseif ($response.Text) { $responseText = $response.Text } else { $responseText = "$response" }
    $cleaned = ($responseText -replace '(?s)^```json\s*', '' -replace '```\s*$', '').Trim()

    try {
        $parsed = $cleaned | ConvertFrom-Json
    } catch {
        Write-Error "Failed to parse batch $batchNum : $_"
        Write-Host $cleaned.Substring(0, [Math]::Min(500, $cleaned.Length))
        continue
    }

    Write-Host "  Parsed $($parsed.Count) entries"
    foreach ($item in $parsed) {
        $AllResults.Add($item)
    }
}

Write-Host "`nTotal generated: $($AllResults.Count)"

# Generate TypeScript to append
$tsLines = [System.Collections.Generic.List[string]]::new()
foreach ($item in $AllResults) {
    $key     = $item.key -replace "'", "\'"
    $label   = $item.label -replace "'", "\'" -replace '"', '\"'
    $summary = $item.summary -replace "'", "\'" -replace '"', '\"'
    $example = $item.example -replace "'", "\'" -replace '"', '\"'
    $freq    = $item.frequency -replace "'", "\'" -replace '"', '\"'

    $tsLines.Add("`"$key`": {")
    $tsLines.Add("  label: `"$label`",")
    $tsLines.Add("  summary: `"$summary`",")
    $tsLines.Add("  example: `"$example`",")
    $tsLines.Add("  frequency: `"$freq`",")

    if ($item.links -and $item.links.Count -gt 0) {
        $linkStrs = foreach ($lnk in $item.links) {
            $ll = $lnk.label -replace '"', '\"'
            $lu = $lnk.url -replace '"', '\"'
            "    { label: `"$ll`", url: `"$lu`" }"
        }
        $tsLines.Add("  links: [")
        $tsLines.Add(($linkStrs -join ",`n"))
        $tsLines.Add("  ]")
    }
    $tsLines.Add("},")
}

$outputPath = Join-Path (Join-Path $RepoRoot 'scripts') 'lineage-info-additions.ts'
$tsLines | Write-Utf8NoBom -Path $outputPath 
Write-Host "`nGenerated TypeScript fragment: $outputPath"
Write-Host "Entries: $($AllResults.Count)"
Write-Host "`nManually insert these before the closing '};' in intellectualLineageInfo.ts"
