# Test vernacular generation prompt against sample DOLCE descriptions
# Uses Gemini flash-lite via the project's AI backend

param(
    [int]$SampleCount = 5
)

$ErrorActionPreference = 'Stop'

# Load modules
$repoRoot = (Resolve-Path "$PSScriptRoot/../../..").Path
Import-Module "$repoRoot/scripts/AITriad/AITriad.psm1" -Force
Import-Module "$repoRoot/scripts/AIEnrich.psm1" -Force

# Ensure Gemini key
if (-not $env:GEMINI_API_KEY) {
    $keyFile = 'C:\tmp\gem.txt'
    if (Test-Path $keyFile) {
        $env:GEMINI_API_KEY = (Get-Content $keyFile).Trim()
    } else {
        throw "Set GEMINI_API_KEY or place key in $keyFile"
    }
}

$systemPrompt = @'
You rewrite academic ontological descriptions into plain language that a high school student could understand.

Rules:
1. Write at a 10th-grade reading level (Flesch-Kincaid grade ~10).
2. Use as many sentences as needed to faithfully convey the full meaning. Aim for 40-150 words — shorter for simple ideas, longer for complex multi-part claims. Never pad, but never truncate a meaningful distinction either.
3. Drop the "A Belief/Desire/Intention within X discourse that..." opener — start directly with the idea.
4. Convert "Encompasses:" items into natural prose — weave them into the explanation rather than dropping them. These sub-concepts are important.
5. Drop the "Excludes:" clause — it's an ontological boundary marker, not part of the idea itself.
6. Replace jargon with everyday words (e.g., "telemetry" → "monitoring", "post-scarcity" → "a world without shortages").
7. Preserve the core claim and its important nuances — do not add, soften, or editorialize.
8. Use active voice when possible.
9. Return ONLY the rewritten text — no labels, no explanation.
'@

# Load samples
$acc = (Get-Content "C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin/accelerationist.json" -Raw | ConvertFrom-Json).nodes
$saf = (Get-Content "C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin/safetyist.json" -Raw | ConvertFrom-Json).nodes
$skp = (Get-Content "C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin/skeptic.json" -Raw | ConvertFrom-Json).nodes
$sit = (Get-Content "C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin/situations.json" -Raw | ConvertFrom-Json).nodes

$samples = @(
    $acc[0],   # acc-desires-001
    $acc[2],   # acc-beliefs-003
    $acc[3],   # acc-intentions-001 (complex, multi-part)
    $saf[0],   # saf-desires-001
    $skp[7],   # skp-beliefs-006
    $skp[8],   # skp-beliefs-007 (very long, nuanced)
    $sit[5]    # sit-006
)

foreach ($node in $samples[0..([Math]::Min($SampleCount - 1, $samples.Count - 1))]) {
    Write-Host "`n=== [$($node.id)] ===" -ForegroundColor Cyan
    Write-Host "FORMAL:" -ForegroundColor Yellow
    Write-Host $node.description
    Write-Host ""

    $userPrompt = "Rewrite this node description:`n`n$($node.description)"

    $result = Invoke-AIApi -Prompt $userPrompt -SystemInstruction $systemPrompt `
        -Model 'gemini-3.5-flash-lite' -Temperature 0.2 -MaxTokens 400

    Write-Host "PLAIN:" -ForegroundColor Green
    Write-Host $result.Text
    Write-Host "---"
}
