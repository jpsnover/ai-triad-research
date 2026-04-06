# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-OntologyCompliance {
    <#
    .SYNOPSIS
        Tests taxonomy data for ontological compliance (DOLCE, BDI, AIF).
    .DESCRIPTION
        Runs structured checks against the taxonomy, summaries, edges, conflicts,
        and debates to verify compliance with the project's ontological framework:

        - Schema validation against JSON schemas
        - Referential integrity (edges, situation_refs, conflict_ids)
        - DOLCE checks (genus-differentia descriptions, D&S roles)
        - BDI checks (category/bdi_layer alignment)
        - AIF checks (canonical edge types, node_scope population)

        Each check emits pass/fail with actionable fix instructions.
    .PARAMETER RepoRoot
        Repository root path. Defaults to module-resolved root.
    .PARAMETER PassThru
        Return the results object for piping.
    .PARAMETER Quiet
        Only show failures and warnings.
    .EXAMPLE
        Test-OntologyCompliance
    .EXAMPLE
        $r = Test-OntologyCompliance -PassThru; $r.Failures
    #>
    [CmdletBinding()]
    param(
        [string]$RepoRoot = $script:RepoRoot,
        [switch]$PassThru,
        [switch]$Quiet
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $TaxDir       = Get-TaxonomyDir
    $SummariesDir = Get-SummariesDir
    $ConflictsDir = Get-ConflictsDir
    $DebatesDir   = Get-DebatesDir

    $Results = [System.Collections.Generic.List[PSObject]]::new()
    $Passed = 0; $Failed = 0; $Warned = 0

    function Add-Check {
        param(
            [string]$Category,
            [string]$Check,
            [ValidateSet('pass','fail','warn')]
            [string]$Status,
            [string]$Detail,
            [string[]]$Fix = @()
        )
        $Results.Add([PSCustomObject][ordered]@{
            Category = $Category
            Check    = $Check
            Status   = $Status
            Detail   = $Detail
            Fix      = $Fix -join '; '
        })
        switch ($Status) {
            'pass' { Set-Variable -Name Passed -Value ($Passed + 1) -Scope 1; if (-not $Quiet) { Write-Host "  PASS  $Category / $Check" -ForegroundColor Green } }
            'fail' { Set-Variable -Name Failed -Value ($Failed + 1) -Scope 1; Write-Host "  FAIL  $Category / $Check — $Detail" -ForegroundColor Red; if ($Fix) { foreach ($F in $Fix) { Write-Host "        Fix: $F" -ForegroundColor Yellow } } }
            'warn' { Set-Variable -Name Warned -Value ($Warned + 1) -Scope 1; Write-Host "  WARN  $Category / $Check — $Detail" -ForegroundColor Yellow }
        }
    }

    Write-Host "`n══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  ONTOLOGY COMPLIANCE AUDIT" -ForegroundColor White
    Write-Host "══════════════════════════════════════════════════════════════`n" -ForegroundColor Cyan

    # ── Load data ─────────────────────────────────────────────────────────────
    $AllNodes = @{}
    $PovFiles = @{
        accelerationist = 'accelerationist.json'
        safetyist       = 'safetyist.json'
        skeptic         = 'skeptic.json'
        situations      = 'situations.json'
    }

    foreach ($PovKey in $PovFiles.Keys) {
        $FilePath = Join-Path $TaxDir $PovFiles[$PovKey]
        if (Test-Path $FilePath) {
            try {
                $Data = Get-Content -Raw -Path $FilePath | ConvertFrom-Json
                foreach ($Node in $Data.nodes) {
                    $AllNodes[$Node.id] = @{ Node = $Node; POV = $PovKey }
                }
            }
            catch {
                Add-Check -Category 'Schema' -Check "Parse $($PovFiles[$PovKey])" -Status 'fail' `
                    -Detail "JSON parse failed: $($_.Exception.Message)" `
                    -Fix "Fix JSON syntax in $($PovFiles[$PovKey])"
            }
        }
    }

    $EdgesPath = Join-Path $TaxDir 'edges.json'
    $AllEdges = @()
    if (Test-Path $EdgesPath) {
        try {
            $EdgesData = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json
            $AllEdges = @($EdgesData.edges)
        }
        catch {
            Add-Check -Category 'Schema' -Check 'Parse edges.json' -Status 'fail' `
                -Detail "JSON parse failed: $($_.Exception.Message)"
        }
    }

    # ══════════════════════════════════════════════════════════════════════════
    # 1. SCHEMA VALIDATION
    # ══════════════════════════════════════════════════════════════════════════
    Write-Host "── Schema ──" -ForegroundColor Cyan

    # Check all taxonomy files parse
    foreach ($PovKey in $PovFiles.Keys) {
        $FilePath = Join-Path $TaxDir $PovFiles[$PovKey]
        if (Test-Path $FilePath) {
            Add-Check -Category 'Schema' -Check "Parse $($PovFiles[$PovKey])" -Status 'pass' -Detail 'OK'
        }
        else {
            Add-Check -Category 'Schema' -Check "Exists $($PovFiles[$PovKey])" -Status 'fail' `
                -Detail "File not found" -Fix "Ensure $($PovFiles[$PovKey]) exists in taxonomy/Origin/"
        }
    }

    # Check required fields on all nodes
    $MissingId = 0; $MissingLabel = 0; $MissingDesc = 0
    foreach ($Entry in $AllNodes.Values) {
        $N = $Entry.Node
        if (-not $N.PSObject.Properties['id'] -or -not $N.id) { $MissingId++ }
        if (-not $N.PSObject.Properties['label'] -or -not $N.label) { $MissingLabel++ }
        if (-not $N.PSObject.Properties['description'] -or -not $N.description) { $MissingDesc++ }
    }

    if ($MissingId -eq 0 -and $MissingLabel -eq 0 -and $MissingDesc -eq 0) {
        Add-Check -Category 'Schema' -Check 'Required fields (id, label, description)' -Status 'pass' -Detail "All $($AllNodes.Count) nodes OK"
    }
    else {
        Add-Check -Category 'Schema' -Check 'Required fields' -Status 'fail' `
            -Detail "Missing: id=$MissingId, label=$MissingLabel, description=$MissingDesc" `
            -Fix 'Run: grep for nodes with null id/label/description fields'
    }

    # ══════════════════════════════════════════════════════════════════════════
    # 2. REFERENTIAL INTEGRITY
    # ══════════════════════════════════════════════════════════════════════════
    Write-Host "── Referential Integrity ──" -ForegroundColor Cyan

    # Edge references valid nodes
    $OrphanEdges = 0
    $OrphanEdgeDetails = [System.Collections.Generic.List[string]]::new()
    foreach ($Edge in $AllEdges) {
        $SrcOk = $AllNodes.ContainsKey($Edge.source) -or $Edge.source -match '^pol-'
        $TgtOk = $AllNodes.ContainsKey($Edge.target) -or $Edge.target -match '^pol-'
        if (-not $SrcOk -or -not $TgtOk) {
            $OrphanEdges++
            if ($OrphanEdgeDetails.Count -lt 5) {
                $OrphanEdgeDetails.Add("$($Edge.source) → $($Edge.target)")
            }
        }
    }

    if ($OrphanEdges -eq 0) {
        Add-Check -Category 'Integrity' -Check 'Edge node references' -Status 'pass' -Detail "All $($AllEdges.Count) edges valid"
    }
    else {
        Add-Check -Category 'Integrity' -Check 'Edge node references' -Status 'fail' `
            -Detail "$OrphanEdges edge(s) reference missing nodes (e.g. $($OrphanEdgeDetails[0]))" `
            -Fix 'Run: Get-Edge | Where-Object orphan to find and remove stale edges'
    }

    # situation_refs reference valid cc- nodes
    $BadRefs = 0
    foreach ($Entry in $AllNodes.Values) {
        $N = $Entry.Node
        $Refs = $null
        if ($N.PSObject.Properties['situation_refs']) { $Refs = $N.situation_refs }
        elseif ($N.PSObject.Properties['cross_cutting_refs']) { $Refs = $N.cross_cutting_refs }
        if ($Refs) {
            foreach ($Ref in @($Refs)) {
                if ($Ref -and -not $AllNodes.ContainsKey($Ref)) { $BadRefs++ }
            }
        }
    }

    if ($BadRefs -eq 0) {
        Add-Check -Category 'Integrity' -Check 'situation_refs targets' -Status 'pass' -Detail 'All refs valid'
    }
    else {
        Add-Check -Category 'Integrity' -Check 'situation_refs targets' -Status 'fail' `
            -Detail "$BadRefs ref(s) point to missing nodes" `
            -Fix 'Grep for situation_refs values that are not in situations.json node IDs'
    }

    # parent_id references valid nodes in same file
    $BadParents = 0
    foreach ($Entry in $AllNodes.Values) {
        $N = $Entry.Node
        if ($N.PSObject.Properties['parent_id'] -and $N.parent_id) {
            if (-not $AllNodes.ContainsKey($N.parent_id)) { $BadParents++ }
        }
    }

    if ($BadParents -eq 0) {
        Add-Check -Category 'Integrity' -Check 'parent_id references' -Status 'pass' -Detail 'All valid'
    }
    else {
        Add-Check -Category 'Integrity' -Check 'parent_id references' -Status 'fail' `
            -Detail "$BadParents node(s) have parent_id pointing to missing nodes" `
            -Fix 'Set orphaned parent_id to $null or correct the reference'
    }

    # ══════════════════════════════════════════════════════════════════════════
    # 3. DOLCE CHECKS
    # ══════════════════════════════════════════════════════════════════════════
    Write-Host "── DOLCE ──" -ForegroundColor Cyan

    # Genus-differentia pattern compliance
    $GenusOk = 0; $GenusFail = 0
    $GenusFailIds = [System.Collections.Generic.List[string]]::new()
    foreach ($Entry in $AllNodes.Values) {
        $N = $Entry.Node; $Pov = $Entry.POV
        if (-not $N.description) { $GenusFail++; continue }

        if ($Pov -eq 'situations') {
            $IsGenus = $N.description -match '^A\s+situation\s+that\s+'
        }
        else {
            $IsGenus = $N.description -match '^An?\s+(Belief|Desire|Intention)\s+within\s+'
        }

        if ($IsGenus) { $GenusOk++ }
        else {
            $GenusFail++
            if ($GenusFailIds.Count -lt 10) { $GenusFailIds.Add($N.id) }
        }
    }

    $GenusPct = [Math]::Round($GenusOk / [Math]::Max(1, $AllNodes.Count) * 100, 1)
    if ($GenusPct -ge 90) {
        Add-Check -Category 'DOLCE' -Check "Genus-differentia descriptions ($GenusPct%)" -Status 'pass' `
            -Detail "$GenusOk/$($AllNodes.Count) nodes compliant"
    }
    elseif ($GenusPct -ge 50) {
        Add-Check -Category 'DOLCE' -Check "Genus-differentia descriptions ($GenusPct%)" -Status 'warn' `
            -Detail "$GenusFail node(s) non-compliant (e.g. $($GenusFailIds[0]))" `
            -Fix 'Run Invoke-AttributeExtraction to regenerate descriptions'
    }
    else {
        Add-Check -Category 'DOLCE' -Check "Genus-differentia descriptions ($GenusPct%)" -Status 'fail' `
            -Detail "$GenusFail node(s) non-compliant" `
            -Fix @('Run Invoke-AttributeExtraction -Force to regenerate', "First 10: $($GenusFailIds -join ', ')")
    }

    # Category field present on POV nodes
    $PovNoCat = 0
    foreach ($Entry in $AllNodes.Values) {
        if ($Entry.POV -eq 'situations') { continue }
        $N = $Entry.Node
        if (-not $N.PSObject.Properties['category'] -or -not $N.category) { $PovNoCat++ }
    }

    if ($PovNoCat -eq 0) {
        Add-Check -Category 'DOLCE' -Check 'Category field on POV nodes' -Status 'pass' -Detail 'All POV nodes have category'
    }
    else {
        Add-Check -Category 'DOLCE' -Check 'Category field on POV nodes' -Status 'fail' `
            -Detail "$PovNoCat POV node(s) missing category" `
            -Fix 'Add category (Beliefs/Desires/Intentions) to nodes missing it'
    }

    # ══════════════════════════════════════════════════════════════════════════
    # 4. BDI CHECKS
    # ══════════════════════════════════════════════════════════════════════════
    Write-Host "── BDI ──" -ForegroundColor Cyan

    # Category values are valid BDI names
    $ValidCats = @('Beliefs', 'Desires', 'Intentions')
    $InvalidCats = 0; $LegacyCats = 0
    foreach ($Entry in $AllNodes.Values) {
        if ($Entry.POV -eq 'situations') { continue }
        $N = $Entry.Node
        if ($N.PSObject.Properties['category'] -and $N.category) {
            if ($N.category -in @('Data/Facts', 'Goals/Values', 'Methods/Arguments')) { $LegacyCats++ }
            elseif ($N.category -notin $ValidCats) { $InvalidCats++ }
        }
    }

    if ($LegacyCats -eq 0 -and $InvalidCats -eq 0) {
        Add-Check -Category 'BDI' -Check 'Category values (Beliefs/Desires/Intentions)' -Status 'pass' -Detail 'All valid'
    }
    else {
        $Msg = @()
        if ($LegacyCats -gt 0) { $Msg += "$LegacyCats legacy (pre-BDI migration)" }
        if ($InvalidCats -gt 0) { $Msg += "$InvalidCats invalid" }
        Add-Check -Category 'BDI' -Check 'Category values' -Status 'fail' `
            -Detail ($Msg -join ', ') `
            -Fix 'Run Invoke-BDIMigration.ps1 to migrate remaining legacy values'
    }

    # bdi_layer values on debates
    $BadBdi = 0
    $ValidBdiLayers = @('belief', 'desire', 'intention')
    $LegacyBdiLayers = @('value', 'conceptual')
    if (Test-Path $DebatesDir) {
        foreach ($DebFile in Get-ChildItem -Path $DebatesDir -Filter '*.json' -File -ErrorAction SilentlyContinue) {
            try {
                $Raw = Get-Content -Raw -Path $DebFile.FullName
                foreach ($Legacy in $LegacyBdiLayers) {
                    if ($Raw -match """bdi_layer""\s*:\s*""$Legacy""") { $BadBdi++ }
                }
            }
            catch { }
        }
    }

    if ($BadBdi -eq 0) {
        Add-Check -Category 'BDI' -Check 'bdi_layer values (no legacy)' -Status 'pass' -Detail 'No legacy values found'
    }
    else {
        Add-Check -Category 'BDI' -Check 'bdi_layer values' -Status 'fail' `
            -Detail "$BadBdi occurrence(s) of legacy bdi_layer values" `
            -Fix 'Run Invoke-BDIMigration.ps1 to fix value→desire, conceptual→intention'
    }

    # ══════════════════════════════════════════════════════════════════════════
    # 5. AIF CHECKS
    # ══════════════════════════════════════════════════════════════════════════
    Write-Host "── AIF ──" -ForegroundColor Cyan

    # Canonical edge types
    $CanonicalTypes = @('SUPPORTS', 'CONTRADICTS', 'ASSUMES', 'WEAKENS', 'RESPONDS_TO', 'TENSION_WITH', 'INTERPRETS')
    $NonCanonical = 0
    $NonCanonicalTypes = @{}
    foreach ($Edge in $AllEdges) {
        if ($Edge.type -notin $CanonicalTypes) {
            $NonCanonical++
            if (-not $NonCanonicalTypes.ContainsKey($Edge.type)) { $NonCanonicalTypes[$Edge.type] = 0 }
            $NonCanonicalTypes[$Edge.type]++
        }
    }

    if ($NonCanonical -eq 0) {
        Add-Check -Category 'AIF' -Check 'Canonical edge types' -Status 'pass' -Detail "All $($AllEdges.Count) edges use canonical types"
    }
    else {
        $TypeList = ($NonCanonicalTypes.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object { "$($_.Key):$($_.Value)" }) -join ', '
        Add-Check -Category 'AIF' -Check 'Canonical edge types' -Status 'warn' `
            -Detail "$NonCanonical edge(s) use non-canonical types ($TypeList)" `
            -Fix 'Map legacy edge types to canonical 7 (see AGENTS.md edge type list)'
    }

    # node_scope coverage
    $ScopeCount = 0
    foreach ($Entry in $AllNodes.Values) {
        $N = $Entry.Node
        if ($N.PSObject.Properties['graph_attributes']) { $GA = $N.graph_attributes } else { $GA = $null }
        if ($GA -and $GA.PSObject.Properties['node_scope'] -and $GA.node_scope) {
            $ScopeCount++
        }
    }

    $ScopePct = [Math]::Round($ScopeCount / [Math]::Max(1, $AllNodes.Count) * 100, 1)
    if ($ScopePct -ge 90) {
        Add-Check -Category 'AIF' -Check "node_scope populated ($ScopePct%)" -Status 'pass' -Detail "$ScopeCount/$($AllNodes.Count) nodes"
    }
    elseif ($ScopePct -ge 50) {
        Add-Check -Category 'AIF' -Check "node_scope populated ($ScopePct%)" -Status 'warn' `
            -Detail "$($AllNodes.Count - $ScopeCount) node(s) missing node_scope" `
            -Fix 'Run Invoke-AttributeExtraction for nodes without graph_attributes'
    }
    else {
        Add-Check -Category 'AIF' -Check "node_scope populated ($ScopePct%)" -Status 'fail' `
            -Detail "$($AllNodes.Count - $ScopeCount) node(s) missing node_scope" `
            -Fix 'Run Invoke-AttributeExtraction -Force to populate all nodes'
    }

    # ══════════════════════════════════════════════════════════════════════════
    # SUMMARY
    # ══════════════════════════════════════════════════════════════════════════
    Write-Host "`n══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  RESULTS: $Passed passed, $Warned warnings, $Failed failed" -ForegroundColor $(if ($Failed -gt 0) { 'Red' } elseif ($Warned -gt 0) { 'Yellow' } else { 'Green' })
    Write-Host "══════════════════════════════════════════════════════════════`n" -ForegroundColor Cyan

    if ($PassThru) {
        return [PSCustomObject][ordered]@{
            Timestamp = (Get-Date).ToString('o')
            NodeCount = $AllNodes.Count
            EdgeCount = $AllEdges.Count
            Passed    = $Passed
            Warned    = $Warned
            Failed    = $Failed
            Checks    = $Results.ToArray()
            Failures  = @($Results | Where-Object { $_.Status -eq 'fail' })
            Warnings  = @($Results | Where-Object { $_.Status -eq 'warn' })
        }
    }
}
