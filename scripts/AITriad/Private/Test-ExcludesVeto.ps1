function Get-ExcludesFragments {
    [CmdletBinding()]
    param([string]$Description)
    $MarkerIdx = $Description.IndexOf('Excludes:', [System.StringComparison]::OrdinalIgnoreCase)
    if ($MarkerIdx -lt 0) { return $null }
    $Core = $Description.Substring(0, $MarkerIdx).Trim()
    $Excl = $Description.Substring($MarkerIdx + 'Excludes:'.Length).Trim()
    if ([string]::IsNullOrWhiteSpace($Core) -or [string]::IsNullOrWhiteSpace($Excl)) { return $null }
    return @{ Core = $Core; Excludes = $Excl }
}

function Invoke-BatchEmbedVeto {
    [CmdletBinding()]
    param([System.Collections.Generic.List[hashtable]]$Items)
    $EmbedScript = Join-Path (Join-Path $script:RepoRoot 'scripts') 'embed_taxonomy.py'
    if (-not (Test-Path $EmbedScript)) { $EmbedScript = Join-Path $script:ModuleRoot 'embed_taxonomy.py' }
    if (-not (Test-Path $EmbedScript)) { return $null }
    $BatchItems = [System.Collections.Generic.List[object]]::new()
    foreach ($Item in $Items) { $BatchItems.Add([ordered]@{ id = $Item.EmbedId; text = $Item.Text }) }
    $BatchJson = $BatchItems | ConvertTo-Json -Compress -Depth 3
    try {
        $Raw = $BatchJson | & python $EmbedScript batch-encode 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($Raw)) { return $null }
        $Parsed = $Raw | ConvertFrom-Json
        $Map = @{}
        foreach ($Prop in $Parsed.PSObject.Properties) { $Map[$Prop.Name] = [double[]]@($Prop.Value) }
        return $Map
    } catch { return $null }
}

function Test-ExcludesVeto {
    [CmdletBinding()]
    param(
        [double[]]$KpVec,
        [double[]]$CoreVec,
        [double[]]$ExclVec,
        [double]$VetoMargin
    )
    $Dim = $KpVec.Count
    if ($CoreVec.Count -ne $Dim -or $ExclVec.Count -ne $Dim) {
        return @{ Verdict = 'Pass'; Margin = 0.0 }
    }
    $KpNormSq = 0.0; $CoreNormSq = 0.0; $ExclNormSq = 0.0
    $DotCore  = 0.0; $DotExcl    = 0.0
    for ($i = 0; $i -lt $Dim; $i++) {
        $KpNormSq   += $KpVec[$i]   * $KpVec[$i]
        $CoreNormSq += $CoreVec[$i] * $CoreVec[$i]
        $ExclNormSq += $ExclVec[$i] * $ExclVec[$i]
        $DotCore    += $KpVec[$i]   * $CoreVec[$i]
        $DotExcl    += $KpVec[$i]   * $ExclVec[$i]
    }
    $KpNorm   = [Math]::Sqrt($KpNormSq)
    $CoreNorm = [Math]::Sqrt($CoreNormSq)
    $ExclNorm = [Math]::Sqrt($ExclNormSq)
    $SimCore  = if ($KpNorm * $CoreNorm -gt 0.0) { $DotCore / ($KpNorm * $CoreNorm) } else { 0.0 }
    $SimExcl  = if ($KpNorm * $ExclNorm -gt 0.0) { $DotExcl / ($KpNorm * $ExclNorm) } else { 0.0 }
    $Margin   = [Math]::Round($SimExcl - $SimCore, 6)
    $Verdict  = if ($Margin -gt $VetoMargin)    { 'Veto' }
                elseif ($Margin -gt 0.0)         { 'Ambiguous' }
                else                              { 'Pass' }
    return @{ Verdict = $Verdict; Margin = $Margin }
}

function Invoke-ExcludesVetoPass {
    [CmdletBinding()]
    param([object[]]$KeyPoints)
    if (-not $script:TaxonomyData -or $script:TaxonomyData.Count -eq 0) {
        return @{ VetoCount = 0; AmbiguousCount = 0 }
    }

    # Build flat node description map
    $NodeDescMap = @{}
    foreach ($PovKey in $script:TaxonomyData.Keys) {
        $PovObj = $script:TaxonomyData[$PovKey]
        if (-not $PovObj.PSObject.Properties['nodes']) { continue }
        foreach ($N in @($PovObj.nodes)) {
            if ($N.PSObject.Properties['id'] -and $N.PSObject.Properties['description']) {
                $NodeDescMap[[string]$N.id] = [string]$N.description
            }
        }
    }

    # Collect candidate kps and cache parsed Excludes: fragments per node
    $Candidates    = [System.Collections.Generic.List[hashtable]]::new()
    $NodeFragments = @{}  # nodeId → @{Core; Excludes} or $null sentinel
    for ($Idx = 0; $Idx -lt $KeyPoints.Count; $Idx++) {
        $kp = $KeyPoints[$Idx]
        if (-not $kp.PSObject.Properties['taxonomy_node_id']) { continue }
        $NodeId = [string]$kp.taxonomy_node_id
        if ([string]::IsNullOrWhiteSpace($NodeId)) { continue }
        if (-not $kp.PSObject.Properties['attribution_text']) { continue }
        $AttrText = [string]$kp.attribution_text
        if ([string]::IsNullOrWhiteSpace($AttrText)) { continue }
        if (-not $NodeDescMap.ContainsKey($NodeId)) { continue }
        if (-not $NodeFragments.ContainsKey($NodeId)) {
            $Frags = Get-ExcludesFragments -Description $NodeDescMap[$NodeId]
            $NodeFragments[$NodeId] = $Frags  # $null = no Excludes: marker; stored to skip re-parse
            if ($null -eq $Frags) { continue }
        } elseif ($null -eq $NodeFragments[$NodeId]) {
            continue
        }
        $Candidates.Add(@{ Idx = $Idx; KeyPoint = $kp; NodeId = $NodeId; Text = $AttrText })
    }

    if ($Candidates.Count -eq 0) { return @{ VetoCount = 0; AmbiguousCount = 0 } }

    # Build single batch: kp texts + unique core/excl node fragments
    $BatchItems = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($Cand in $Candidates) {
        $BatchItems.Add(@{ EmbedId = "vkp_$($Cand.Idx)"; Text = $Cand.Text })
    }
    foreach ($NodeId in $NodeFragments.Keys) {
        $Frags = $NodeFragments[$NodeId]
        if ($null -eq $Frags) { continue }
        $BatchItems.Add(@{ EmbedId = "vcore_$NodeId"; Text = $Frags.Core })
        $BatchItems.Add(@{ EmbedId = "vexcl_$NodeId"; Text = $Frags.Excludes })
    }

    $VectorMap = Invoke-BatchEmbedVeto -Items $BatchItems
    if ($null -eq $VectorMap) { return @{ VetoCount = 0; AmbiguousCount = 0 } }

    $VetoCount      = 0
    $AmbiguousCount = 0
    $Delta          = $script:ExcludesVetoMargin

    foreach ($Cand in $Candidates) {
        $KpId   = "vkp_$($Cand.Idx)"
        $CoreId = "vcore_$($Cand.NodeId)"
        $ExclId = "vexcl_$($Cand.NodeId)"
        if (-not $VectorMap.ContainsKey($KpId))  { continue }
        if (-not $VectorMap.ContainsKey($CoreId)) { continue }
        if (-not $VectorMap.ContainsKey($ExclId)) { continue }
        $KpVec   = [double[]]$VectorMap[$KpId]
        $CoreVec = [double[]]$VectorMap[$CoreId]
        $ExclVec = [double[]]$VectorMap[$ExclId]
        $Result  = Test-ExcludesVeto -KpVec $KpVec -CoreVec $CoreVec -ExclVec $ExclVec -VetoMargin $Delta
        switch ($Result.Verdict) {
            'Veto' {
                Set-KeyPointField $Cand.KeyPoint 'taxonomy_node_id' $null
                Set-KeyPointField $Cand.KeyPoint 'retrieval_low_confidence' $true
                $VetoCount++
            }
            'Ambiguous' {
                Set-KeyPointField $Cand.KeyPoint 'retrieval_low_confidence' $true
                $AmbiguousCount++
            }
        }
    }

    return @{ VetoCount = $VetoCount; AmbiguousCount = $AmbiguousCount }
}
