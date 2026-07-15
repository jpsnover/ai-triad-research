# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-CcToSitMigration {
    <#
    .SYNOPSIS
        Migrate legacy cc-* situation IDs to fresh sit-* IDs across every
        authoritative reference surface (t/1308 B-301 Stages 2-3).
    .DESCRIPTION
        One-way-door data migration. Renames every cc-NNN situation node to
        sit-<Offset+NNN> and rewrites every cross-reference in-place. Writes
        a durable mapping file so historical readers (debate transcripts,
        calibration logs, .bak snapshots) can resolve cc-* → current sit-*.

        Default -Offset=200 produces sit-201..sit-446 for cc-001..cc-246,
        leaving 19 numbers (sit-182..sit-200) as a buffer for organic sit-*
        creation. This choice was approved by TL + owner in t/1308.

        AUTHORITATIVE SURFACES REWRITTEN:
          - taxonomy/Origin/situations.json            (246 node IDs + 182 cross-refs)
          - taxonomy/Origin/edges.json                 (5,047 cc-touching edges)
          - taxonomy/Origin/embeddings.json            (246 embedding keys)
          - conflicts/conflicts.json                   (31 refs)
          - conflicts/_conflict-index.json             (31 refs)
          - taxonomy/Origin/source_evidence_index.json (5 refs)
          - summaries/*.json                           (~157 refs across ~92 files)
          - chats/*.json                               (occasional refs)

        FROZEN SURFACES (NOT rewritten, per t/1308 design):
          - *.bak files (historical snapshots)
          - edge_discovery_log.json
          - debates/*.json (completed transcripts are frozen artifacts)
          - research-artifacts/** (research corpora)
          - calibration/* (historical logs)

        Per-file writes are atomic (temp file → File.Move). If any write
        fails mid-run the partial state is left in place and the mapping
        file is NOT written so re-runs can proceed from a known point.
    .PARAMETER DataRoot
        Override the data repo root. Defaults to Get-DataRoot.
    .PARAMETER Offset
        Numeric offset added to each cc-NNN to produce sit-*. Default 200.
    .PARAMETER DryRun
        Print the planned change set (per-surface counts + sample mapping)
        without writing anything.
    .PARAMETER MappingOut
        Path to write the mapping file. Default
        <DataRoot>/taxonomy/Origin/cc-to-sit-mapping.json.
    .PARAMETER SkipSurfaces
        Surface names to skip (e.g. 'summaries','chats'). Available:
        'situations','edges','embeddings','conflicts','sources','summaries','chats'.
    .PARAMETER Force
        Skip the interactive confirmation prompt.
    .PARAMETER Reverse
        Apply the reverse migration from an existing mapping file. Path to
        cc-to-sit-mapping.json; rewrites sit-201..sit-446 back to cc-001..cc-246.
        Useful as a soft rollback if a corruption is spotted before the
        pre-cc-migration tag is force-restored.
    .OUTPUTS
        PSCustomObject with per-surface change counts and the resolved mapping.
    .EXAMPLE
        Invoke-CcToSitMigration -DryRun
    .EXAMPLE
        Invoke-CcToSitMigration        # interactive
    .EXAMPLE
        Invoke-CcToSitMigration -Force -SkipSurfaces summaries,chats
    .LINK
        Show-AITriadHelp
    .LINK
        Find-SituationCandidates
    .LINK
        Invoke-SchemaMigration
    #>
    [CmdletBinding(SupportsShouldProcess, DefaultParameterSetName='Forward')]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(ParameterSetName='Forward')]
        [Parameter(ParameterSetName='Reverse')]
        [string]$DataRoot,

        [Parameter(ParameterSetName='Forward')]
        [ValidateRange(0, 9000)]
        [int]$Offset = 200,

        [Parameter(ParameterSetName='Forward')]
        [Parameter(ParameterSetName='Reverse')]
        [switch]$DryRun,

        [Parameter(ParameterSetName='Forward')]
        [string]$MappingOut,

        [Parameter(ParameterSetName='Forward')]
        [Parameter(ParameterSetName='Reverse')]
        [ValidateSet('situations','edges','embeddings','conflicts','sources','summaries','chats')]
        [string[]]$SkipSurfaces = @(),

        [Parameter(ParameterSetName='Forward')]
        [Parameter(ParameterSetName='Reverse')]
        [switch]$Force,

        [Parameter(ParameterSetName='Reverse', Mandatory)]
        [string]$Reverse
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── Resolve paths ─────────────────────────────────────────────────────
    if (-not $DataRoot) { $DataRoot = Get-DataRoot }
    if (-not (Test-Path $DataRoot)) {
        throw (New-ActionableError -PassThru `
            -Goal 'Locate data repo for cc→sit migration' `
            -Problem "Data root not found at $DataRoot" `
            -Location 'Invoke-CcToSitMigration' `
            -NextSteps @(
                'Verify ../ai-triad-data exists',
                'Check .aitriad.json data_root setting',
                'Pass an explicit -DataRoot path'
            ))
    }
    $TaxDir       = Join-Path (Join-Path $DataRoot 'taxonomy') 'Origin'
    $ConflictsDir = Join-Path $DataRoot 'conflicts'
    $SummariesDir = Join-Path $DataRoot 'summaries'
    $ChatsDir     = Join-Path $DataRoot 'chats'
    if (-not $MappingOut) { $MappingOut = Join-Path $TaxDir 'cc-to-sit-mapping.json' }

    # ── Build mapping ─────────────────────────────────────────────────────
    $Mapping = [ordered]@{}
    $IsReverse = $PSCmdlet.ParameterSetName -eq 'Reverse'

    if ($IsReverse) {
        if (-not (Test-Path $Reverse)) {
            throw (New-ActionableError -PassThru `
                -Goal 'Reverse cc→sit migration' `
                -Problem "Mapping file not found at $Reverse" `
                -Location 'Invoke-CcToSitMigration' `
                -NextSteps @("Confirm the path to the cc-to-sit-mapping.json produced by the original migration"))
        }
        try {
            $ExistingMap = Get-Content -Raw -Path $Reverse -Encoding utf8 | ConvertFrom-Json
        } catch {
            throw (New-ActionableError -PassThru `
                -Goal 'Parse mapping file' `
                -Problem "Failed to parse $Reverse : $($_.Exception.Message)" `
                -Location 'Invoke-CcToSitMigration' `
                -NextSteps @('Validate the mapping file JSON syntax'))
        }
        if (-not $ExistingMap.PSObject.Properties['mapping']) {
            throw (New-ActionableError -PassThru `
                -Goal 'Reverse cc→sit migration' `
                -Problem 'Mapping file has no "mapping" key' `
                -Location 'Invoke-CcToSitMigration' `
                -NextSteps @('Verify the mapping file is the one written by an earlier forward run'))
        }
        # Invert: sit-201 → cc-001, etc.
        foreach ($p in $ExistingMap.mapping.PSObject.Properties) {
            $Mapping[[string]$p.Value] = [string]$p.Name
        }
        Write-Host "Reverse mode: $($Mapping.Count) sit-* → cc-* mappings loaded from $Reverse" -ForegroundColor Yellow
    } else {
        $SitJsonPath = Join-Path $TaxDir 'situations.json'
        if (-not (Test-Path $SitJsonPath)) {
            throw (New-ActionableError -PassThru `
                -Goal 'Build cc→sit mapping' `
                -Problem "situations.json not found at $SitJsonPath" `
                -Location 'Invoke-CcToSitMigration' `
                -NextSteps @('Verify the data repo taxonomy/Origin directory'))
        }
        try {
            $SitData = Get-Content -Raw -Path $SitJsonPath -Encoding utf8 | ConvertFrom-Json
        } catch {
            throw (New-ActionableError -PassThru `
                -Goal 'Parse situations.json' `
                -Problem "Failed to parse situations.json: $($_.Exception.Message)" `
                -Location 'Invoke-CcToSitMigration' `
                -NextSteps @('Validate the JSON syntax'))
        }
        $CcIds = @()
        $ExistingSitIds = [System.Collections.Generic.HashSet[string]]::new()
        foreach ($n in @($SitData.nodes)) {
            $id = if ($n.PSObject.Properties['id']) { [string]$n.id } else { '' }
            if ($id.StartsWith('cc-')) { $CcIds += $id }
            elseif ($id.StartsWith('sit-')) { $ExistingSitIds.Add($id) | Out-Null }
        }
        if ($CcIds.Count -eq 0) {
            Write-Host "No cc-* nodes found in situations.json — migration is a no-op." -ForegroundColor Green
            return [PSCustomObject]@{
                MappingCount = 0
                Applied      = $false
                Reason       = 'no cc-* nodes present'
            }
        }
        # Build mapping deterministically ordered by numeric suffix
        $Sorted = $CcIds | Sort-Object { [int]($_ -replace '^cc-','') }
        foreach ($cc in $Sorted) {
            $num = [int]($cc -replace '^cc-','')
            $sit = 'sit-{0:d3}' -f ($num + $Offset)
            $Mapping[$cc] = $sit
        }
        # Collision check
        $Collisions = @()
        foreach ($sit in $Mapping.Values) {
            if ($ExistingSitIds.Contains($sit)) { $Collisions += $sit }
        }
        if ($Collisions.Count -gt 0) {
            throw (New-ActionableError -PassThru `
                -Goal 'Verify cc→sit mapping has no collisions' `
                -Problem "$($Collisions.Count) proposed sit-* id(s) already exist in situations.json (sample: $(($Collisions | Select-Object -First 5) -join ', '))" `
                -Location 'Invoke-CcToSitMigration' `
                -NextSteps @(
                    "Increase -Offset to move the migrated block above the collision range",
                    "Or verify situations.json wasn't extended into the sit-201+ range since design approval"
                ))
        }
        Write-Host "Forward mode: $($Mapping.Count) cc-* → sit-* mappings built (range sit-$($Offset+1) .. sit-$($Offset + $CcIds.Count | ForEach-Object { '{0:d3}' -f $_ }))" -ForegroundColor Cyan
    }

    # ── Enumerate change surfaces ─────────────────────────────────────────
    $Surfaces = [System.Collections.Generic.List[PSCustomObject]]::new()

    $AddSurface = {
        param([string]$Name, [string]$Path)
        if ($SkipSurfaces -contains $Name) { return }
        if (-not (Test-Path $Path)) { return }
        $Surfaces.Add([PSCustomObject]@{
            Name    = $Name
            Path    = $Path
        })
    }

    & $AddSurface 'situations'  (Join-Path $TaxDir       'situations.json')
    & $AddSurface 'edges'       (Join-Path $TaxDir       'edges.json')
    & $AddSurface 'embeddings'  (Join-Path $TaxDir       'embeddings.json')
    & $AddSurface 'sources'     (Join-Path $TaxDir       'source_evidence_index.json')
    & $AddSurface 'conflicts'   (Join-Path $ConflictsDir 'conflicts.json')
    & $AddSurface 'conflicts'   (Join-Path $ConflictsDir '_conflict-index.json')

    # summaries + chats: directory scans (many files)
    if (-not ($SkipSurfaces -contains 'summaries') -and (Test-Path $SummariesDir)) {
        foreach ($f in Get-ChildItem -Path $SummariesDir -Filter '*.json' -File -ErrorAction SilentlyContinue) {
            $Surfaces.Add([PSCustomObject]@{ Name = 'summaries'; Path = $f.FullName })
        }
    }
    if (-not ($SkipSurfaces -contains 'chats') -and (Test-Path $ChatsDir)) {
        foreach ($f in Get-ChildItem -Path $ChatsDir -Filter '*.json' -File -ErrorAction SilentlyContinue) {
            $Surfaces.Add([PSCustomObject]@{ Name = 'chats'; Path = $f.FullName })
        }
    }

    # Build regex + callback once (shared across surfaces)
    $Pattern = [regex]'\bcc-\d{3}\b'
    $Callback = [System.Text.RegularExpressions.MatchEvaluator]{
        param($m)
        $key = $m.Value
        if ($Mapping.Contains($key)) { return $Mapping[$key] } else { return $key }
    }
    if ($IsReverse) {
        # In reverse mode the sources are sit-* IDs in the migrated range
        $Pattern = [regex]'\bsit-\d{3}\b'
    }

    # ── Dry-run: count planned rewrites per surface ───────────────────────
    Write-Host ''
    Write-Host 'Planned change surfaces:' -ForegroundColor Cyan
    $SurfaceCounts = @{}
    $GrandTotal = 0
    foreach ($s in $Surfaces) {
        $content = Get-Content -Raw -Path $s.Path -Encoding utf8
        $matchCount = 0
        foreach ($m in $Pattern.Matches($content)) {
            if ($Mapping.Contains($m.Value)) { $matchCount++ }
        }
        if (-not $SurfaceCounts.ContainsKey($s.Name)) {
            $SurfaceCounts[$s.Name] = @{ Files = 0; Refs = 0 }
        }
        $SurfaceCounts[$s.Name].Files += 1
        $SurfaceCounts[$s.Name].Refs  += $matchCount
        $GrandTotal += $matchCount
    }
    foreach ($n in @('situations','edges','embeddings','sources','conflicts','summaries','chats')) {
        if ($SurfaceCounts.ContainsKey($n)) {
            $c = $SurfaceCounts[$n]
            Write-Host ("  {0,-12} {1,3} file(s), {2,6} refs to rewrite" -f $n, $c.Files, $c.Refs) -ForegroundColor Gray
        }
    }
    Write-Host ("  {0,-12} {1,3} file(s), {2,6} refs total" -f '(TOTAL)', @($Surfaces).Count, $GrandTotal) -ForegroundColor White
    Write-Host ''
    Write-Host 'Sample mapping (first 3):' -ForegroundColor Cyan
    $sampleN = [Math]::Min(3, @($Mapping.Keys).Count)
    foreach ($k in (@($Mapping.Keys) | Select-Object -First $sampleN)) {
        Write-Host ("  {0} → {1}" -f $k, $Mapping[$k]) -ForegroundColor Gray
    }

    if ($DryRun) {
        Write-Host ''
        Write-Host 'DRY RUN — no writes performed.' -ForegroundColor Yellow
        return [PSCustomObject]@{
            Mode         = if ($IsReverse) { 'reverse-dry-run' } else { 'forward-dry-run' }
            MappingCount = $Mapping.Count
            Surfaces     = @($Surfaces | Group-Object Name | ForEach-Object {
                [PSCustomObject]@{ Name = $_.Name; Files = $_.Count }
            })
            SurfaceCounts = $SurfaceCounts
            TotalRefs    = $GrandTotal
            Applied      = $false
        }
    }

    # ── Confirm ───────────────────────────────────────────────────────────
    if (-not $Force -and -not $PSCmdlet.ShouldProcess("$($Surfaces.Count) file(s), $GrandTotal ref(s)", 'Apply cc→sit migration')) {
        return [PSCustomObject]@{ Applied = $false; Reason = 'user declined' }
    }

    # ── Apply per-surface (atomic per file) ───────────────────────────────
    $Written = [System.Collections.Generic.List[PSObject]]::new()
    $Failed = [System.Collections.Generic.List[PSObject]]::new()
    foreach ($s in $Surfaces) {
        try {
            $orig = Get-Content -Raw -Path $s.Path -Encoding utf8
            $new  = $Pattern.Replace($orig, $Callback)
            if ($new -ne $orig) {
                $tmp = $s.Path + '.tmp'
                Set-Content -Path $tmp -Value $new -Encoding utf8NoBOM -NoNewline
                [System.IO.File]::Move($tmp, $s.Path, $true)
                $Written.Add([PSCustomObject]@{ Name = $s.Name; Path = $s.Path })
            }
        } catch {
            $Failed.Add([PSCustomObject]@{ Name = $s.Name; Path = $s.Path; Error = $_.Exception.Message })
            Write-Warning "Failed to rewrite $($s.Path): $($_.Exception.Message)"
        }
    }
    if ($Failed.Count -gt 0) {
        throw (New-ActionableError -PassThru `
            -Goal 'Apply cc→sit migration' `
            -Problem "$($Failed.Count) surface(s) failed to rewrite. Partial state left in place; mapping file NOT written." `
            -Location 'Invoke-CcToSitMigration' `
            -NextSteps @(
                "Inspect $($Failed[0].Path): $($Failed[0].Error)",
                'Restore from pre-cc-migration git tag if partial state is broken',
                'Fix the failure, then re-run Invoke-CcToSitMigration to complete'
            ))
    }

    # ── Write mapping file (forward mode only; reverse doesn't overwrite it) ──
    if (-not $IsReverse) {
        $now = (Get-Date).ToString('yyyy-MM-dd')
        $mappingObj = [ordered]@{
            _schema_version         = '1.0.0'
            _doc                    = "cc-* → sit-* ID migration record (t/1308). Applied $now. Historical readers (debate transcripts, .bak snapshots, calibration logs) should treat cc-* as an alias for the mapped sit-* per this file."
            applied_at              = $now
            count                   = $Mapping.Count
            range_before            = "cc-{0:d3}..cc-{1:d3}" -f 1, $Mapping.Count
            range_after             = "sit-{0:d3}..sit-{1:d3}" -f ($Offset + 1), ($Offset + $Mapping.Count)
            mapping                 = [ordered]@{}
        }
        foreach ($k in $Mapping.Keys) { $mappingObj.mapping[$k] = $Mapping[$k] }
        $json = ($mappingObj | ConvertTo-Json -Depth 8)
        $tmp = $MappingOut + '.tmp'
        Set-Content -Path $tmp -Value $json -Encoding utf8NoBOM -NoNewline
        [System.IO.File]::Move($tmp, $MappingOut, $true)
        Write-Host ''
        Write-Host "Mapping file written: $MappingOut" -ForegroundColor Green
    }

    Write-Host ''
    Write-Host "Migration applied: $($Written.Count) file(s) rewritten, $GrandTotal ref(s) migrated." -ForegroundColor Green

    return [PSCustomObject]@{
        Mode          = if ($IsReverse) { 'reverse-applied' } else { 'forward-applied' }
        MappingCount  = $Mapping.Count
        Offset        = $Offset
        FilesWritten  = $Written.Count
        TotalRefs     = $GrandTotal
        SurfaceCounts = $SurfaceCounts
        MappingFile   = if ($IsReverse) { $Reverse } else { $MappingOut }
        Applied       = $true
    }
}
