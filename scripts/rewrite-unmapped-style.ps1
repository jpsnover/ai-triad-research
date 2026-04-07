# One-shot script: rewrite all unmapped concept labels/descriptions to plain-language style
# Also rewrites taxonomy nodes that were added from unmapped concepts.

#Requires -Version 5.1
Set-StrictMode -Version Latest

Import-Module (Join-Path (Join-Path $PSScriptRoot 'AITriad') 'AITriad.psd1') -Force
Import-Module (Join-Path $PSScriptRoot 'AIEnrich.psm1') -Force

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')

# Collect all items to rewrite
$Items = [System.Collections.Generic.List[PSCustomObject]]::new()

# 1. Unmapped concepts from summaries
$SummariesDir = Join-Path $RepoRoot 'summaries'
foreach ($f in Get-ChildItem (Join-Path $SummariesDir '*.json')) {
    $s = Get-Content $f.FullName -Raw | ConvertFrom-Json
    if (-not $s.unmapped_concepts) { continue }
    for ($i = 0; $i -lt $s.unmapped_concepts.Count; $i++) {
        $uc = $s.unmapped_concepts[$i]
        $Items.Add([PSCustomObject]@{
            type        = 'unmapped'
            file        = $f.Name
            index       = $i
            label       = $uc.suggested_label
            description = $uc.suggested_description
            id          = $null
        })
    }
}

# 2. Taxonomy nodes that came from resolved unmapped concepts
$resolvedIds = [System.Collections.Generic.HashSet[string]]::new()
foreach ($f in Get-ChildItem (Join-Path $SummariesDir '*.json')) {
    $s = Get-Content $f.FullName -Raw | ConvertFrom-Json
    if (-not $s.unmapped_concepts) { continue }
    foreach ($uc in $s.unmapped_concepts) {
        if ($uc.PSObject.Properties['resolved_node_id'] -and $uc.resolved_node_id) {
            [void]$resolvedIds.Add($uc.resolved_node_id)
        }
    }
}

$TaxDir = Join-Path (Join-Path $RepoRoot 'taxonomy') 'Origin'
foreach ($taxFile in Get-ChildItem (Join-Path $TaxDir '*.json') -Exclude 'embeddings.json','edges.json') {
    $tax = Get-Content $taxFile.FullName -Raw | ConvertFrom-Json
    foreach ($node in $tax.nodes) {
        if ($resolvedIds.Contains($node.id)) {
            $Items.Add([PSCustomObject]@{
                type        = 'taxonomy'
                file        = $taxFile.Name
                index       = -1
                label       = $node.label
                description = $node.description
                id          = $node.id
            })
        }
    }
}

$unmappedCount = @($Items | Where-Object { $_.type -eq 'unmapped' }).Count
$taxCount      = @($Items | Where-Object { $_.type -eq 'taxonomy' }).Count
Write-Host "Items to rewrite: $($Items.Count) ($unmappedCount unmapped + $taxCount taxonomy nodes)"

# Build batched prompt
$entries = [System.Collections.Generic.List[string]]::new()
for ($i = 0; $i -lt $Items.Count; $i++) {
    $item = $Items[$i]
    if ($item.label) { $lbl = $item.label } else { $lbl = '(no label)' }
    if ($item.description) { $desc = $item.description } else { $desc = '(no description)' }
    $entries.Add("[$i] LABEL: $lbl`nDESCRIPTION: $desc")
}

$prompt = @'
You are rewriting taxonomy labels and descriptions to match a plain-language style.

STYLE RULES:
- Write for a policy reporter — active voice, named actors, one idea per sentence, concrete examples over abstractions. Every sentence quotable without rewriting. No nominalizations or hedge stacking. Technical terms fine when load-bearing; define on first use.
- Labels: 3-8 words, like a newspaper headline. Simple and direct.
  GOOD: "New Tech Takes Time to Spread", "Attacks That Break AI Safety Rules", "AIs Don't Follow Their Rules"
  BAD:  "Innovation-Diffusion Lag", "Denial-of-Governance Attacks", "AI Goal Misalignment"
- Descriptions: short sentences, concrete analogies, no jargon or acronyms.
  Keep the same meaning and length (2-5 sentences), just make it simpler.
- Do NOT change the core meaning — only rephrase for clarity and accessibility.

Rewrite EACH of the following items. Return a JSON array where each element has:
  {"index": N, "label": "new label", "description": "new description"}

Return ONLY the JSON array. No markdown fences.

'@ + "`n`n" + ($entries -join "`n`n")

Write-Host "Prompt length: $($prompt.Length) chars (~$([int]($prompt.Length/4)) tokens)"

$response = Invoke-AIApi -Prompt $prompt -Model 'gemini-2.5-flash' -MaxTokens 32768 -Temperature 0.3 -TimeoutSec 300
if (-not $response) {
    Write-Error 'AI API returned null'
    return
}

# Extract text — Invoke-AIApi may return string or object
if ($response -is [string]) { $responseText = $response } elseif ($response.Text) { $responseText = $response.Text } else { $responseText = "$response" }

# Parse response
$cleaned = ($responseText -replace '(?s)^```json\s*', '' -replace '```\s*$', '').Trim()
try {
    $rewrites = $cleaned | ConvertFrom-Json
} catch {
    Write-Error "Failed to parse response: $_"
    Write-Host $cleaned.Substring(0, [Math]::Min(500, $cleaned.Length))
    return
}

Write-Host "Parsed $($rewrites.Count) rewrites"

# Apply rewrites
$summaryCache = @{}
$taxCache     = @{}

foreach ($rw in $rewrites) {
    $idx = [int]$rw.index
    if ($idx -lt 0 -or $idx -ge $Items.Count) { continue }
    $item = $Items[$idx]

    if ($item.type -eq 'unmapped') {
        if (-not $summaryCache.ContainsKey($item.file)) {
            $summaryCache[$item.file] = Get-Content (Join-Path $SummariesDir $item.file) -Raw | ConvertFrom-Json
        }
        $s = $summaryCache[$item.file]
        $uc = $s.unmapped_concepts[$item.index]
        $uc | Add-Member -NotePropertyName 'suggested_label'       -NotePropertyValue $rw.label       -Force
        $uc | Add-Member -NotePropertyName 'suggested_description' -NotePropertyValue $rw.description -Force
    }
    elseif ($item.type -eq 'taxonomy') {
        if (-not $taxCache.ContainsKey($item.file)) {
            $taxCache[$item.file] = Get-Content (Join-Path $TaxDir $item.file) -Raw | ConvertFrom-Json
        }
        $tax = $taxCache[$item.file]
        $node = $tax.nodes | Where-Object { $_.id -eq $item.id }
        if ($node) {
            $node.label       = $rw.label
            $node.description = $rw.description
        }
    }
}

# Write updated files
foreach ($key in $summaryCache.Keys) {
    $path = Join-Path $SummariesDir $key
    $summaryCache[$key] | ConvertTo-Json -Depth 20 | Set-Content -Path $path -Encoding UTF8
    Write-Host "  Updated: summaries/$key"
}
foreach ($key in $taxCache.Keys) {
    $path = Join-Path $TaxDir $key
    $taxCache[$key] | ConvertTo-Json -Depth 20 | Set-Content -Path $path -Encoding UTF8
    Write-Host "  Updated: taxonomy/Origin/$key"
}

Write-Host "`nDone! Rewrote $($rewrites.Count) labels/descriptions to plain-language style."
