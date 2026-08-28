#Requires -Version 7.0
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.
#
# Pure predicate for the share-data freshness gate (t/3091).
# Dot-sourceable by both Invoke-ShareFreshnessGateCheck.ps1 and Pester tests.
# No I/O — accepts pre-fetched data, returns structured result.

function Test-ShareManifestPredicate {
    <#
    .SYNOPSIS
        Pure predicate for the share freshness gate (t/3091). No I/O.
    .DESCRIPTION
        Checks three independent failure classes:
        1. Canonical mismatch: data repo blob_sha advanced since seed (seed-lag).
        2. File missing from canonical tree (file removed from data repo — unusual but detectable).
        3. Upload truncation: share file size < 90% of seeded size.
        Returns @{ Pass=[bool]; Reasons=[string[]] }.
    .PARAMETER Manifest
        Parsed seed-manifest.json PSCustomObject: .files.<path>.blob_sha / .size_bytes
    .PARAMETER CanonicalTree
        Array of tree-entry PSCustomObjects from the GitHub Git Trees API:
        each entry has .path (string) and .sha (string).
    .PARAMETER ShareFileSizes
        Hashtable of { "relative/path" = <long size_bytes> } for files on the share.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [pscustomobject] $Manifest,
        [Parameter(Mandatory)] [AllowEmptyCollection()] [pscustomobject[]] $CanonicalTree,
        [Parameter(Mandatory)] [hashtable] $ShareFileSizes
    )

    $reasons = [System.Collections.Generic.List[string]]::new()

    # Index canonical tree by path for O(1) lookup
    $treeIndex = @{}
    foreach ($entry in $CanonicalTree) {
        $treeIndex[$entry.path] = $entry
    }

    foreach ($prop in $manifest.files.PSObject.Properties) {
        $filePath      = $prop.Name
        $seedBlobSha   = $prop.Value.blob_sha
        $seedSizeBytes = [long]$prop.Value.size_bytes
        $minBytes      = [long][math]::Floor($seedSizeBytes * 0.9)

        # ── Primary: canonical blob_sha comparison (detects seed-lag) ────────
        if (-not $treeIndex.ContainsKey($filePath)) {
            $reasons.Add("[$filePath] not found in data-repo canonical tree — file may have been moved or removed")
            continue
        }
        $canonicalSha = $treeIndex[$filePath].sha
        if ($canonicalSha -ne $seedBlobSha) {
            $reasons.Add("[$filePath] data repo has advanced since seed (canonical sha=$canonicalSha, seeded sha=$seedBlobSha) — re-run deploy.ps1 -SeedData")
            # Fall through to also check truncation against seeded size
        }

        # ── Secondary: share upload truncation guard (independent of sha) ────
        if (-not $ShareFileSizes.ContainsKey($filePath)) {
            $reasons.Add("[$filePath] not found on share — may not have been uploaded")
            continue
        }
        $actualBytes = $ShareFileSizes[$filePath]
        if ($actualBytes -lt $minBytes) {
            $aMB = [math]::Round($actualBytes  / 1MB, 1)
            $sMB = [math]::Round($seedSizeBytes / 1MB, 1)
            $mMB = [math]::Round($minBytes      / 1MB, 1)
            $reasons.Add("[$filePath] UNDERSIZED on share: $aMB MB vs seeded $sMB MB (min $mMB MB) — possible upload truncation")
        }
    }

    return [pscustomobject]@{
        Pass    = $reasons.Count -eq 0
        Reasons = $reasons.ToArray()
    }
}
