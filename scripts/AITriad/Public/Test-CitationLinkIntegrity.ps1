# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Advisory→blocking flip point (t/3598, SO + TL Gate-Verification). Stays $false until the
# Computational Linguist obtains the mandatory Second Opinion and Main (TL) Gate-Verification
# for the blocking-gate promotion. Flipping to $true makes any leg's offenders fail the gate.
$script:CitationIntegrityBlocking = $false

function Test-CitationLinkIntegrity {
    <#
    .SYNOPSIS
        Referential-integrity gate on summary→node citation links + the source_index sidecar
        (t/3598 — prevents stale-link recurrence, the 184-dead-id class). Advisory (warn-only)
        until the SO + TL-GV blocking flip.
    .DESCRIPTION
        Pure, deterministic check over committed data files — three legs, each independently
        pass/fail with its offender list (CL owns the predicate, t/3598#1/#2/#3):

          (a) Link resolution — every taxonomy id referenced by summaries/*.json
              (pov_summaries.{pov}.key_points[].taxonomy_node_id non-null +
               factual_claims[].linked_taxonomy_nodes[]) resolves to a LIVE node OF ITS CLASS:
                 ^(acc|saf|skp)-  → the POV live-node set (accelerationist/safetyist/skeptic.json)
                 ^sit-            → the live situation registry (situations.json .nodes[].id)
              sit- is resolved, NOT blanket-excluded (t/3598#2), else situation dangles pass.
          (b) Source resolution — every distinct source_id in source_index.json resolves to
              <SourcesRoot>/<id>/metadata.json AFTER stripping a trailing '-<digits>' chunk
              suffix (the summarizer's chunk→base doc_id convention, t/3598#3).
          (c) Staleness — source_index.json header inputHash == Get-SummariesInputHash over the
              current summaries, AND the index key count == the live-node count.

        Advisory: failing legs emit a WARN with offender detail and set the returned .pass to
        $false, but the cmdlet NEVER throws on offenders. When $script:CitationIntegrityBlocking
        is $true (the future SO/TL-GV flip), callers treat .pass -eq $false as a gate failure.
    .PARAMETER SummariesDir
        Summary JSON directory. Default: Get-SummariesDir.
    .PARAMETER TaxonomyDir
        POV + situations registry directory. Default: Get-TaxonomyDir.
    .PARAMETER SourceIndexPath
        The source_index.json sidecar. Default: <TaxonomyDir>/source_index.json.
    .PARAMETER SourcesRoot
        Root of the sources repo (holds <id>/metadata.json). Default: Get-SourcesRoot else
        <data_root>/../ai-triad-sources.
    .OUTPUTS
        [pscustomobject] { pass; results = @({leg; pass; offenders[]}) ; blocking }
    .EXAMPLE
        (Test-CitationLinkIntegrity).results | Format-Table leg, pass, @{n='n';e={$_.offenders.Count}}
    .LINK
        Build-NodeSourceIndex
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter()] [string]$SummariesDir,
        [Parameter()] [string]$TaxonomyDir,
        [Parameter()] [string]$SourceIndexPath,
        [Parameter()] [string]$SourcesRoot
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    if (-not $SummariesDir)    { $SummariesDir = Get-SummariesDir }
    if (-not $TaxonomyDir)     { $TaxonomyDir  = Get-TaxonomyDir }
    if (-not $SourceIndexPath) { $SourceIndexPath = Join-Path $TaxonomyDir 'source_index.json' }
    if (-not $SourcesRoot) { $SourcesRoot = Get-SourcesDir }

    # ── Live id sets ────────────────────────────────────────────────────────────
    $beliefLive = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($f in @('accelerationist.json', 'safetyist.json', 'skeptic.json')) {
        $p = Join-Path $TaxonomyDir $f
        if (-not (Test-Path -LiteralPath $p)) { continue }
        $doc = Get-Content -Raw -LiteralPath $p | ConvertFrom-Json
        if ($doc.PSObject.Properties['nodes']) {
            foreach ($n in @($doc.nodes)) {
                if ($n.PSObject.Properties['id'] -and $n.id) { [void]$beliefLive.Add([string]$n.id) }
            }
        }
    }
    $sitLive = [System.Collections.Generic.HashSet[string]]::new()
    $sitPath = Join-Path $TaxonomyDir 'situations.json'
    if (Test-Path -LiteralPath $sitPath) {
        $sitDoc = Get-Content -Raw -LiteralPath $sitPath | ConvertFrom-Json
        if ($sitDoc.PSObject.Properties['nodes']) {
            foreach ($n in @($sitDoc.nodes)) {
                if ($n.PSObject.Properties['id'] -and $n.id) { [void]$sitLive.Add([string]$n.id) }
            }
        }
    }

    # ── Leg (a): summary→node link resolution, by declared class ────────────────
    $aOff = [System.Collections.Generic.List[object]]::new()
    function script:Resolve-Ref([string]$ref, [string]$docId, $bl, $sl, $out) {
        if ([string]::IsNullOrWhiteSpace($ref)) { return }
        if ($ref -match '^(acc|saf|skp)-') {
            if (-not $bl.Contains($ref)) { $out.Add([pscustomobject]@{ docId = $docId; ref = $ref; class = 'belief' }) }
        }
        elseif ($ref -match '^sit-') {
            if (-not $sl.Contains($ref)) { $out.Add([pscustomobject]@{ docId = $docId; ref = $ref; class = 'situation' }) }
        }
        else {
            $out.Add([pscustomobject]@{ docId = $docId; ref = $ref; class = 'unknown-prefix' })
        }
    }
    foreach ($file in (Get-ChildItem -LiteralPath $SummariesDir -Filter '*.json' -File | Sort-Object Name)) {
        $s = Get-Content -Raw -LiteralPath $file.FullName | ConvertFrom-Json
        $docId = if ($s.PSObject.Properties['doc_id']) { [string]$s.doc_id } else { $file.BaseName }
        if ($s.PSObject.Properties['pov_summaries'] -and $s.pov_summaries) {
            foreach ($pov in $s.pov_summaries.PSObject.Properties.Name) {
                $block = $s.pov_summaries.$pov
                if (-not ($block.PSObject.Properties['key_points'])) { continue }
                foreach ($kp in @($block.key_points)) {
                    if ($kp.PSObject.Properties['taxonomy_node_id'] -and $null -ne $kp.taxonomy_node_id) {
                        script:Resolve-Ref ([string]$kp.taxonomy_node_id) $docId $beliefLive $sitLive $aOff
                    }
                }
            }
        }
        if ($s.PSObject.Properties['factual_claims'] -and $s.factual_claims) {
            foreach ($fc in @($s.factual_claims)) {
                if (-not $fc.PSObject.Properties['linked_taxonomy_nodes']) { continue }
                foreach ($ref in @($fc.linked_taxonomy_nodes)) {
                    script:Resolve-Ref ([string]$ref) $docId $beliefLive $sitLive $aOff
                }
            }
        }
    }

    # ── Leg (b): source_index source_id → metadata.json (strip -<digits> chunk) ─
    $bOff = [System.Collections.Generic.List[object]]::new()
    $indexExists = Test-Path -LiteralPath $SourceIndexPath
    $ix = $null
    if ($indexExists) {
        $ix = Get-Content -Raw -LiteralPath $SourceIndexPath | ConvertFrom-Json
        $seen = [System.Collections.Generic.HashSet[string]]::new()
        foreach ($nodeProp in $ix.index.PSObject.Properties) {
            foreach ($e in @($nodeProp.Value)) {
                if (-not ($e.PSObject.Properties['source_id']) -or -not $e.source_id) { continue }
                $sid = [string]$e.source_id
                if (-not $seen.Add($sid)) { continue }   # distinct only
                # Resolve as-is first (chunk dirs often exist on their own), else strip a chunk
                # '-N' suffix ONLY when it follows a '-YYYY' year — a naive '-\d+$' would eat the
                # year off every non-chunked id (t/3598#3 chunk→base convention, year-aware).
                $okAsIs = Test-Path -LiteralPath (Join-Path (Join-Path $SourcesRoot $sid) 'metadata.json')
                $base   = $sid -replace '^(.*-\d{4})-\d+$', '$1'
                $okBase = ($base -ne $sid) -and (Test-Path -LiteralPath (Join-Path (Join-Path $SourcesRoot $base) 'metadata.json'))
                if (-not ($okAsIs -or $okBase)) {
                    $bOff.Add([pscustomobject]@{ source_id = $sid; base = $base })
                }
            }
        }
    }

    # ── Leg (c): staleness — header hash + key count vs live nodes ──────────────
    $cOff = [System.Collections.Generic.List[object]]::new()
    if ($indexExists) {
        $liveCount = $beliefLive.Count
        $stored = if ($ix.PSObject.Properties['inputHash']) { [string]$ix.inputHash } else { '' }
        $recomputed = Get-SummariesInputHash -SummariesDir $SummariesDir
        if ($stored -ne $recomputed) {
            $cOff.Add([pscustomobject]@{ kind = 'stale-hash'; stored = $stored; recomputed = $recomputed })
        }
        $keyCount = @($ix.index.PSObject.Properties).Count
        if ($keyCount -ne $liveCount) {
            $cOff.Add([pscustomobject]@{ kind = 'key-count'; keys = $keyCount; liveNodes = $liveCount })
        }
    }
    else {
        $cOff.Add([pscustomobject]@{ kind = 'index-missing'; path = $SourceIndexPath })
        $bOff.Add([pscustomobject]@{ source_id = '(index-missing)'; base = $SourceIndexPath })
    }

    $results = @(
        [pscustomobject]@{ leg = 'a'; name = 'link-resolution';   pass = ($aOff.Count -eq 0); offenders = @($aOff) }
        [pscustomobject]@{ leg = 'b'; name = 'source-resolution'; pass = ($bOff.Count -eq 0); offenders = @($bOff) }
        [pscustomobject]@{ leg = 'c'; name = 'staleness';         pass = ($cOff.Count -eq 0); offenders = @($cOff) }
    )
    $overall = @($results | Where-Object { -not $_.pass }).Count -eq 0

    foreach ($r in $results) {
        if (-not $r.pass) {
            $sample = @($r.offenders | Select-Object -First 5 | ForEach-Object { $_ | ConvertTo-Json -Compress -Depth 4 }) -join '; '
            Write-Warning "Citation-integrity leg ($($r.leg)) $($r.name): $(@($r.offenders).Count) offender(s) — $sample"
        }
    }

    [pscustomobject]@{
        pass     = $overall
        blocking = $script:CitationIntegrityBlocking
        results  = $results
    }
}
