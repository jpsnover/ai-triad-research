#Requires -Version 7.0
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Post-deploy gate (warn-only): verify the embeddings cache resolves a confirmed-real
    taxonomy node id via the same keyed lookup path that computeEmbeddings uses. Catches
    cache-present-but-non-resolving failures (t/3165 pattern, t/3091).
.DESCRIPTION
    Calls POST /api/embeddings/compute with canary id acc-beliefs-003 (a confirmed-real
    stored key in the production embeddings corpus). The response includes cacheHits,
    cacheMisses, and corpusNodeCount (added by ServerAPI in t/3165 PR #1704).

    cacheHits >= 1  -> PASS (canary resolved through cache hit path)
    cacheHits == 0  -> WARN (corpus is warm per warm-gate, but canary not resolving;
                             implies a genuine resolution failure on this keying path)

    Canary: acc-beliefs-003
      - Full-word stored key form (NOT the abbreviated docs form acc-bel-001)
      - Confirmed present in live production corpus by ServerAPI (p/555#4, p/555#5)
      - canaryPresent === cacheHits: both check nodes[id] != null (p/555#12) — no
        separate canaryPresent field needed
      - Warm-gate already proved nodeCount > 0, so cacheHits:0 here is a resolution
        failure, not a dead-cache (warm-gate owns that detection)

    WARN-ONLY phase: wired with continue-on-error: true in deploy-azure.yml until both GV
    arms proven on real environments. Flip-to-blocking is a separate Gate-Promotion PR per
    Gate Promotion Discipline (operations/devops/AGENTS.md).

    GV FIRE arm:  cacheHits:0 on a mis-keyed or dead-cache revision -> emits ::warning::
    GV CLEAN arm: cacheHits:1 on a healthy resolving revision -> passes silently
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $BaseUrl
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Canary   = 'acc-beliefs-003'
$Endpoint = "$($BaseUrl.TrimEnd('/'))/api/embeddings/compute"

Write-Host "Embeddings resolution gate: probing $Endpoint with canary '$Canary'..."

try {
    $body = @{
        texts = @($Canary)
        ids   = @($Canary)
    } | ConvertTo-Json -Compress

    $resp = Invoke-RestMethod `
        -Uri         $Endpoint `
        -Method      Post `
        -Body        $body `
        -ContentType 'application/json' `
        -TimeoutSec  30 `
        -ErrorAction Stop

    $cacheHitsField       = $resp.PSObject.Properties['cacheHits']
    $cacheMissesField     = $resp.PSObject.Properties['cacheMisses']
    $corpusNodeCountField = $resp.PSObject.Properties['corpusNodeCount']

    if ($null -eq $cacheHitsField) {
        # cacheHits absent — ServerAPI t/3165 PR #1704 not yet merged on this revision
        $keys = $resp.PSObject.Properties.Name -join ', '
        Write-Host ("::warning::Embeddings resolution gate: response missing 'cacheHits' field — " +
            "confirm ServerAPI t/3165 PR #1704 is merged on this revision. Response keys: $keys. (t/3091)")
        return
    }

    $cacheHits       = [int]$cacheHitsField.Value
    $cacheMisses     = [int]($null -ne $cacheMissesField     ? $cacheMissesField.Value     : -1)
    $corpusNodeCount = [int]($null -ne $corpusNodeCountField ? $corpusNodeCountField.Value : -1)

    if ($cacheHits -ge 1) {
        Write-Host ("Embeddings resolution gate PASSED: canary '$Canary' resolved from cache " +
            "(cacheHits=$cacheHits, corpusNodeCount=$corpusNodeCount). (t/3091)")
    } else {
        Write-Host ("::warning::Embeddings resolution gate FAILED: canary '$Canary' not resolved " +
            "(cacheHits=$cacheHits, cacheMisses=$cacheMisses, corpusNodeCount=$corpusNodeCount). " +
            "Warm-gate already confirmed corpus is loaded (nodeCount > 0), so this is a genuine " +
            "key-resolution failure on the compute path. This gate is warn-only pending GV. (t/3091)")
    }

} catch {
    Write-Host ("::warning::Embeddings resolution gate: POST $Endpoint failed — " +
        "$($_.Exception.Message). Skipping resolution check. (t/3091)")
}
