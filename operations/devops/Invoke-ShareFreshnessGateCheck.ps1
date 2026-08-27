#Requires -Version 7.0
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Post-deploy gate: verify the Azure Files share is seeded with fresh, full-size data.
.DESCRIPTION
    Reads seed-manifest.json from the share root (written by deploy.ps1 -SeedData).
    Fails if:
      - manifest is missing (share never seeded or seeded before t/3091 fix)
      - any asserted file is absent from the share
      - any asserted file is undersized vs the manifest (>10% shrinkage — stale/truncated)
      - seeded_at age exceeds -MaxAgeDays (silent lag detection; catches the t/3090 pattern)

    Requires the calling identity to have Storage File Data SMB Share Reader role on
    the storage account, or pass -StorageKey for key-based auth.

    GV FIRE arm:  delete seed-manifest.json OR upload a stale/undersized manifest → gate fires.
    GV CLEAN arm: present, fresh, correctly-sized manifest → passes silently, zero noise.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $StorageAccount,
    [string] $ShareName  = 'taxonomy-data',
    [int]    $MaxAgeDays = 180,
    [string] $StorageKey = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$authArgs = if ($StorageKey) { @('--account-key', $StorageKey) }
            else             { @('--auth-mode', 'login') }

# ── Download seed-manifest.json ──────────────────────────────────────────────
$tmp = [IO.Path]::GetTempFileName()
try {
    $dlOut = az storage file download `
        --account-name $StorageAccount `
        --share-name   $ShareName `
        --path         'seed-manifest.json' `
        --dest         $tmp `
        @authArgs `
        --output none 2>&1
    if ($LASTEXITCODE -ne 0) {
        $errText = ($dlOut | Out-String).Trim()
        if ($errText -match 'ResourceNotFound|does not exist|The specified resource does not exist') {
            Write-Host ("::error::Share freshness gate FAIL: seed-manifest.json not found on " +
                "share '$ShareName' (account=$StorageAccount). " +
                "Run deploy.ps1 -SeedData to seed the share. (t/3091)")
        } else {
            Write-Host "::error::Share freshness gate FAIL: could not read seed-manifest.json — $errText (t/3091)"
        }
        throw "Share freshness gate failed — manifest missing or inaccessible"
    }

    $manifest = Get-Content $tmp -Raw | ConvertFrom-Json

    # ── Check seeded_at age ──────────────────────────────────────────────────
    $seededAt = [DateTimeOffset]::Parse($manifest.seeded_at)
    $ageDays  = ([DateTimeOffset]::UtcNow - $seededAt).TotalDays
    if ($ageDays -gt $MaxAgeDays) {
        Write-Host ("::error::Share freshness gate FAIL: share data is {0:F0} days old " +
            "(seeded_at={1}, threshold={2} days). Re-run deploy.ps1 -SeedData. (t/3091)") `
            -f $ageDays, $manifest.seeded_at, $MaxAgeDays
        throw "Share freshness gate failed — data stale ($([math]::Round($ageDays,0)) days > $MaxAgeDays)"
    }
    Write-Host "  [OK] seeded_at=$($manifest.seeded_at) ($([math]::Round($ageDays,1)) days ago)"

    # ── Check each asserted file against the manifest ────────────────────────
    $failed = @()
    foreach ($entry in $manifest.files.PSObject.Properties) {
        $filePath      = $entry.Name
        $expectedBytes = [long]$entry.Value.size_bytes
        $minBytes      = [long][math]::Floor($expectedBytes * 0.9)  # 10% tolerance

        $showRaw = az storage file show `
            --account-name $StorageAccount `
            --share-name   $ShareName `
            --path         $filePath `
            @authArgs `
            --output json 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host ("::error::  [$filePath] MISSING from share " +
                "(expected ~$([math]::Round($expectedBytes/1MB,1)) MB). (t/3091)")
            $failed += $filePath
            continue
        }
        $fileInfo    = ($showRaw | Out-String) | ConvertFrom-Json
        # az storage file show places size at .contentLength or .properties.contentLength
        $props       = $fileInfo.properties
        $actualBytes = if ($null -ne $fileInfo.contentLength)             { [long]$fileInfo.contentLength }
                       elseif ($null -ne $props -and
                               $null -ne $props.contentLength)            { [long]$props.contentLength }
                       else                                               { 0L }

        if ($actualBytes -lt $minBytes) {
            Write-Host ("::error::  [{0}] UNDERSIZED: {1:F1} MB on share, " +
                "expected >= {2:F1} MB (manifest={3:F1} MB). Share may be stale or truncated. (t/3091)") `
                -f $filePath, ($actualBytes/1MB), ($minBytes/1MB), ($expectedBytes/1MB)
            $failed += $filePath
        } else {
            Write-Host "  [OK] $filePath — $([math]::Round($actualBytes/1MB,1)) MB"
        }
    }

    if ($failed.Count -gt 0) {
        throw "Share freshness gate failed — $($failed.Count) file(s) missing or undersized: $($failed -join ', ')"
    }

    $fileCount = @($manifest.files.PSObject.Properties).Count
    Write-Host "Share freshness gate passed: manifest valid, $fileCount file(s) verified. (t/3091)"

} finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}
