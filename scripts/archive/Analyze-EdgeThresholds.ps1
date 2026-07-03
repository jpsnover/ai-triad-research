# Analyze existing edges vs embedding similarity to recommend discovery threshold (t/159).
# Also builds similarity cache for t/158.

[CmdletBinding()]
param(
    [int]$TopK = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Config = Get-Content (Join-Path $RepoRoot '.aitriad.json') -Raw | ConvertFrom-Json
$TaxDir = Join-Path (Join-Path $RepoRoot $Config.data_root) $Config.taxonomy_dir

Write-Host "`n== Edge Threshold Analysis ==" -ForegroundColor Cyan

# ── Load embeddings ──
Write-Host "Loading embeddings..." -ForegroundColor Gray
$EmbData = Get-Content (Join-Path $TaxDir 'embeddings.json') -Raw | ConvertFrom-Json
$Vectors = @{}  # id → double[]
foreach ($Prop in $EmbData.nodes.PSObject.Properties) {
    if ($Prop.Value.PSObject.Properties['vector']) {
        $Vectors[$Prop.Name] = [double[]]$Prop.Value.vector
    }
}
Write-Host "  $($Vectors.Count) vectors loaded (dim $($Vectors.Values | Select-Object -First 1 | ForEach-Object { $_.Count }))"

# ── Load edges ──
Write-Host "Loading edges..." -ForegroundColor Gray
$EdgesRaw = Get-Content (Join-Path $TaxDir 'edges.json') -Raw | ConvertFrom-Json
$Edges = @($EdgesRaw.edges)
Write-Host "  $($Edges.Count) edges"

# ── Cosine similarity helper ──
function Get-CosineSim {
    param([double[]]$A, [double[]]$B)
    $Dot = 0.0
    for ($i = 0; $i -lt $A.Count; $i++) { $Dot += $A[$i] * $B[$i] }
    return $Dot  # vectors are L2-normalized
}

# ── Step 1: Compute similarity for every existing edge ──
Write-Host "`nComputing edge similarities..." -ForegroundColor Yellow
$EdgeSims = [System.Collections.Generic.List[double]]::new()
$MissingEmb = 0
$ByType = @{}  # edge_type → list of sims

foreach ($Edge in $Edges) {
    $Src = if ($Edge.PSObject.Properties['source']) { $Edge.source } else { $null }
    $Tgt = if ($Edge.PSObject.Properties['target']) { $Edge.target } else { $null }
    if (-not $Src -or -not $Tgt) { continue }
    if (-not $Vectors.ContainsKey($Src) -or -not $Vectors.ContainsKey($Tgt)) {
        $MissingEmb++
        continue
    }

    $Sim = Get-CosineSim $Vectors[$Src] $Vectors[$Tgt]
    $EdgeSims.Add($Sim)

    $EType = if ($Edge.PSObject.Properties['type']) { $Edge.type } else { 'unknown' }
    if (-not $ByType.ContainsKey($EType)) { $ByType[$EType] = [System.Collections.Generic.List[double]]::new() }
    $ByType[$EType].Add($Sim)
}

Write-Host "  Computed: $($EdgeSims.Count) edges with embeddings, $MissingEmb missing"

# ── Step 2: Threshold analysis ──
Write-Host "`n=== THRESHOLD ANALYSIS ===" -ForegroundColor Cyan
Write-Host "`n  Threshold | Edges Captured | Recall"
Write-Host "  ---------|----------------|-------"

$Thresholds = @(0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.70)
$Total = $EdgeSims.Count

foreach ($T in $Thresholds) {
    $Captured = @($EdgeSims | Where-Object { $_ -ge $T }).Count
    $Recall = if ($Total -gt 0) { [Math]::Round($Captured / $Total * 100, 1) } else { 0 }
    $Bar = '*' * [Math]::Min(50, [int]($Recall / 2))
    Write-Host "    $($T.ToString('F2'))   |  $($Captured.ToString().PadLeft(6))       | $($Recall.ToString().PadLeft(5))%  $Bar"
}

# ── Step 3: Distribution by edge type ──
Write-Host "`n=== BY EDGE TYPE ===" -ForegroundColor Cyan
Write-Host "`n  Type           | Count  | Mean Sim | Median | P10    | P90"
Write-Host "  ---------------|--------|----------|--------|--------|------"

foreach ($EType in ($ByType.Keys | Sort-Object)) {
    $Sims = @($ByType[$EType] | Sort-Object)
    $Count = $Sims.Count
    if ($Count -eq 0) { continue }
    $Mean = [Math]::Round(($Sims | Measure-Object -Average).Average, 3)
    $Median = $Sims[[Math]::Min([int]($Count / 2), $Count - 1)]
    $P10 = $Sims[[Math]::Min([int]($Count * 0.10), $Count - 1)]
    $P90 = $Sims[[Math]::Min([int]($Count * 0.90), $Count - 1)]
    Write-Host "  $($EType.PadRight(15))| $($Count.ToString().PadLeft(6)) | $($Mean.ToString('F3').PadLeft(8)) | $([Math]::Round($Median, 3).ToString('F3').PadLeft(6)) | $([Math]::Round($P10, 3).ToString('F3').PadLeft(6)) | $([Math]::Round($P90, 3).ToString('F3').PadLeft(6))"
}

# ── Step 4: False positive estimate at various thresholds ──
Write-Host "`n=== FALSE POSITIVE ESTIMATE ===" -ForegroundColor Cyan

# Sample random non-edge pairs (full N×N is too expensive)
$NodeIds = @($Vectors.Keys | Where-Object { $_ -notlike 'pol-*' })  # taxonomy nodes only
$SampleSize = 10000
$Random = [System.Random]::new(42)
$NonEdgeSims = [System.Collections.Generic.List[double]]::new()

# Build existing edge set for lookup
$ExistingEdges = [System.Collections.Generic.HashSet[string]]::new()
foreach ($Edge in $Edges) {
    if ($Edge.PSObject.Properties['source'] -and $Edge.PSObject.Properties['target']) {
        $null = $ExistingEdges.Add("$($Edge.source)|$($Edge.target)")
    }
}

Write-Host "  Sampling $SampleSize random non-edge pairs..."
$Sampled = 0
while ($Sampled -lt $SampleSize -and $NodeIds.Count -gt 1) {
    $A = $NodeIds[$Random.Next($NodeIds.Count)]
    $B = $NodeIds[$Random.Next($NodeIds.Count)]
    if ($A -eq $B) { continue }
    if ($ExistingEdges.Contains("$A|$B") -or $ExistingEdges.Contains("$B|$A")) { continue }
    if (-not $Vectors.ContainsKey($A) -or -not $Vectors.ContainsKey($B)) { continue }

    $Sim = Get-CosineSim $Vectors[$A] $Vectors[$B]
    $NonEdgeSims.Add($Sim)
    $Sampled++
}

$TotalPossible = $NodeIds.Count * ($NodeIds.Count - 1) / 2
Write-Host "  Total possible pairs: ~$([Math]::Round($TotalPossible / 1000))K"
Write-Host "`n  Threshold | FP Rate (sample) | Est. FP Candidates"
Write-Host "  ---------|------------------|-------------------"

foreach ($T in $Thresholds) {
    $FpSample = @($NonEdgeSims | Where-Object { $_ -ge $T }).Count
    $FpRate = if ($SampleSize -gt 0) { [Math]::Round($FpSample / $SampleSize * 100, 1) } else { 0 }
    $EstFp = [int]($FpRate / 100 * $TotalPossible)
    Write-Host "    $($T.ToString('F2'))   |   $($FpRate.ToString().PadLeft(5))%          | $($EstFp.ToString().PadLeft(8))"
}

# ── Step 5: Recommendation ──
# Find threshold where recall >= 95%
$Sorted = @($EdgeSims | Sort-Object)
$P5Index = [int]($Sorted.Count * 0.05)  # 5th percentile of edge similarities
$RecThreshold = if ($Sorted.Count -gt 0) { [Math]::Round($Sorted[$P5Index], 2) } else { 0.30 }

Write-Host "`n=== RECOMMENDATION ===" -ForegroundColor Green
Write-Host "  95% recall threshold: $RecThreshold"
$RecCapture = @($EdgeSims | Where-Object { $_ -ge $RecThreshold }).Count
Write-Host "  Edges captured: $RecCapture / $Total ($([Math]::Round($RecCapture/$Total*100, 1))%)"
$RecFpSample = @($NonEdgeSims | Where-Object { $_ -ge $RecThreshold }).Count
$RecFpRate = [Math]::Round($RecFpSample / $SampleSize * 100, 1)
Write-Host "  Estimated FP rate: $RecFpRate%"
Write-Host "  Estimated FP candidates: $([int]($RecFpRate / 100 * $TotalPossible))"

# ── Step 6: Build similarity cache (t/158) ──
Write-Host "`n== Building Similarity Cache (t/158) ==" -ForegroundColor Cyan
$CachePath = Join-Path $TaxDir 'similarity-cache.json'
$EmbHash = (Get-FileHash (Join-Path $TaxDir 'embeddings.json') -Algorithm SHA256).Hash.Substring(0, 16)

Write-Host "  Computing top-$TopK per node ($($NodeIds.Count) nodes)..."
$Cache = [ordered]@{
    embeddings_hash = $EmbHash
    generated_at    = (Get-Date -Format 'o')
    top_k           = $TopK
    node_count      = $NodeIds.Count
    entries         = [ordered]@{}
}

$Done = 0
foreach ($NodeA in $NodeIds) {
    if (-not $Vectors.ContainsKey($NodeA)) { continue }
    $VecA = $Vectors[$NodeA]
    $Scores = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($NodeB in $NodeIds) {
        if ($NodeA -eq $NodeB) { continue }
        if (-not $Vectors.ContainsKey($NodeB)) { continue }
        $Sim = Get-CosineSim $VecA $Vectors[$NodeB]
        $Scores.Add([PSCustomObject]@{ id = $NodeB; sim = [Math]::Round($Sim, 4) })
    }

    $TopScores = @($Scores | Sort-Object sim -Descending | Select-Object -First $TopK |
        ForEach-Object { [ordered]@{ id = $_.id; sim = $_.sim } })
    $Cache.entries[$NodeA] = $TopScores

    $Done++
    if ($Done % 100 -eq 0) {
        Write-Host "  $Done / $($NodeIds.Count)..." -ForegroundColor Gray
    }
}

$Cache | ConvertTo-Json -Depth 5 -Compress | Set-Content $CachePath -Encoding UTF8
$CacheSize = [Math]::Round((Get-Item $CachePath).Length / 1MB, 1)
Write-Host "  Cache saved: $CachePath ($CacheSize MB, $($Cache.entries.Count) nodes × $TopK)"
