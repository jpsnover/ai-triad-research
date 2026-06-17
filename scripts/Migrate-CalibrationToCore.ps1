<#
.SYNOPSIS
    Migrates calibration data to the three-tier core/users/integration structure.
.DESCRIPTION
    One-time migration script for the calibration multi-user epic (t/624).

    1. Creates calibration/core/ and calibration/users/ directories
    2. Converts calibration-log.json (JSON array) → core/calibration-log.jsonl
    3. Converts extraction-metrics.json (JSON array) → core/extraction-metrics.jsonl
    4. Copies lineage-enrichments.json → core/lineage-enrichments.json with
       updated_by/updated_at metadata per key and lowercase key normalization
    5. Creates empty integration-log.jsonl
    6. Preserves originals as .bak files

    Idempotent: safe to re-run. Skips steps where output already exists unless -Force.
.PARAMETER Force
    Overwrite existing core/ files even if they already exist.
.PARAMETER WhatIf
    Show what would happen without making changes.
.EXAMPLE
    .\Migrate-CalibrationToCore.ps1
    .\Migrate-CalibrationToCore.ps1 -Force
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Locate data root ─────────────────────────────────────────────────────────
$ScriptDir = Split-Path $MyInvocation.MyCommand.Path -Parent
$RepoRoot = Split-Path $ScriptDir -Parent

if (-not [string]::IsNullOrWhiteSpace($env:AI_TRIAD_DATA_ROOT)) {
    $DataRoot = $env:AI_TRIAD_DATA_ROOT
} else {
    $ConfigPath = Join-Path $RepoRoot '.aitriad.json'
    if (Test-Path $ConfigPath) {
        $Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
        $DataRoot = Join-Path $RepoRoot $Config.data_root
    } else {
        $DataRoot = Join-Path (Split-Path $RepoRoot -Parent) 'ai-triad-data'
    }
}

$DataRoot = (Resolve-Path $DataRoot -ErrorAction Stop).Path
$CalibDir = Join-Path $DataRoot 'calibration'

if (-not (Test-Path $CalibDir)) {
    Write-Error "Calibration directory not found: $CalibDir"
    return
}

$CoreDir = Join-Path $CalibDir 'core'
$UsersDir = Join-Path $CalibDir 'users'
$MigrationTimestamp = (Get-Date).ToUniversalTime().ToString('o')

Write-Host "`n=== Calibration Migration ===" -ForegroundColor Cyan
Write-Host "  Source:  $CalibDir"
Write-Host "  Target:  $CoreDir"
Write-Host "  Force:   $Force"
Write-Host ""

# ── Step 1: Create directories ───────────────────────────────────────────────
foreach ($Dir in @($CoreDir, $UsersDir)) {
    if (-not (Test-Path $Dir)) {
        if ($PSCmdlet.ShouldProcess($Dir, 'Create directory')) {
            $null = New-Item -ItemType Directory -Path $Dir -Force
            Write-Host "  Created: $Dir" -ForegroundColor Green
        }
    } else {
        Write-Host "  Exists:  $Dir" -ForegroundColor DarkGray
    }
}

# ── Step 2: Convert calibration-log.json → core/calibration-log.jsonl ────────
$CalLogSource = Join-Path $CalibDir 'calibration-log.json'
$CalLogTarget = Join-Path $CoreDir 'calibration-log.jsonl'

if ((Test-Path $CalLogTarget) -and -not $Force) {
    $ExistingLines = @(Get-Content $CalLogTarget).Count
    Write-Host "  Skip:    calibration-log.jsonl already exists ($ExistingLines lines). Use -Force to overwrite." -ForegroundColor Yellow
} elseif (Test-Path $CalLogSource) {
    if ($PSCmdlet.ShouldProcess($CalLogSource, 'Convert to JSONL')) {
        Write-Host "  Reading: calibration-log.json..." -NoNewline
        $CalLogData = Get-Content $CalLogSource -Raw | ConvertFrom-Json
        $EntryCount = @($CalLogData).Count
        Write-Host " $EntryCount entries"

        # Write JSONL — one compressed JSON object per line
        $Sb = [System.Text.StringBuilder]::new($EntryCount * 4096)
        foreach ($Entry in $CalLogData) {
            $null = $Sb.AppendLine(($Entry | ConvertTo-Json -Depth 10 -Compress))
        }
        [System.IO.File]::WriteAllText($CalLogTarget, $Sb.ToString(), [System.Text.UTF8Encoding]::new($false))

        # Verify
        $LineCount = @(Get-Content $CalLogTarget).Count
        Write-Host "  Written: calibration-log.jsonl ($LineCount lines)" -ForegroundColor Green

        # Backup original
        $BakPath = "$CalLogSource.bak"
        if (-not (Test-Path $BakPath)) {
            Copy-Item $CalLogSource $BakPath
            Write-Host "  Backup:  calibration-log.json.bak" -ForegroundColor DarkGray
        }
    }
} else {
    Write-Host "  Skip:    calibration-log.json not found (nothing to migrate)" -ForegroundColor Yellow
}

# ── Step 3: Convert extraction-metrics.json → core/extraction-metrics.jsonl ──
$MetricsSource = Join-Path $CalibDir 'extraction-metrics.json'
$MetricsTarget = Join-Path $CoreDir 'extraction-metrics.jsonl'

if ((Test-Path $MetricsTarget) -and -not $Force) {
    $ExistingLines = @(Get-Content $MetricsTarget).Count
    Write-Host "  Skip:    extraction-metrics.jsonl already exists ($ExistingLines lines). Use -Force to overwrite." -ForegroundColor Yellow
} elseif (Test-Path $MetricsSource) {
    if ($PSCmdlet.ShouldProcess($MetricsSource, 'Convert to JSONL')) {
        Write-Host "  Reading: extraction-metrics.json..." -NoNewline
        $MetricsData = Get-Content $MetricsSource -Raw | ConvertFrom-Json
        $EntryCount = @($MetricsData).Count
        Write-Host " $EntryCount entries"

        $Sb = [System.Text.StringBuilder]::new($EntryCount * 1024)
        foreach ($Entry in $MetricsData) {
            $null = $Sb.AppendLine(($Entry | ConvertTo-Json -Depth 10 -Compress))
        }
        [System.IO.File]::WriteAllText($MetricsTarget, $Sb.ToString(), [System.Text.UTF8Encoding]::new($false))

        $LineCount = @(Get-Content $MetricsTarget).Count
        Write-Host "  Written: extraction-metrics.jsonl ($LineCount lines)" -ForegroundColor Green

        $BakPath = "$MetricsSource.bak"
        if (-not (Test-Path $BakPath)) {
            Copy-Item $MetricsSource $BakPath
            Write-Host "  Backup:  extraction-metrics.json.bak" -ForegroundColor DarkGray
        }
    }
} else {
    Write-Host "  Skip:    extraction-metrics.json not found (nothing to migrate)" -ForegroundColor Yellow
}

# ── Step 4: Copy lineage-enrichments.json → core/ with metadata ──────────────
$LineageSource = Join-Path $CalibDir 'lineage-enrichments.json'
$LineageTarget = Join-Path $CoreDir 'lineage-enrichments.json'

if ((Test-Path $LineageTarget) -and -not $Force) {
    Write-Host "  Skip:    core/lineage-enrichments.json already exists. Use -Force to overwrite." -ForegroundColor Yellow
} elseif (Test-Path $LineageSource) {
    if ($PSCmdlet.ShouldProcess($LineageSource, 'Copy with metadata to core/')) {
        Write-Host "  Reading: lineage-enrichments.json..." -NoNewline
        $LineageData = Get-Content $LineageSource -Raw | ConvertFrom-Json -AsHashtable
        Write-Host " $($LineageData.Count) keys"

        # Normalize keys to lowercase and add updated_by/updated_at
        $Normalized = [ordered]@{}
        $DupeCount = 0
        foreach ($Key in @($LineageData.Keys)) {
            $LowerKey = $Key.ToLowerInvariant()
            $Value = $LineageData[$Key]

            # Add audit metadata if missing
            if (-not $Value.ContainsKey('updated_by')) {
                $Value['updated_by'] = 'migration'
            }
            if (-not $Value.ContainsKey('updated_at')) {
                $Value['updated_at'] = $MigrationTimestamp
            }

            if ($Normalized.Contains($LowerKey)) {
                $DupeCount++
                # Keep the entry with more complete data (longer description)
                $ExistingDesc = if ($Normalized[$LowerKey].ContainsKey('description')) { $Normalized[$LowerKey]['description'] } else { '' }
                $NewDesc = if ($Value.ContainsKey('description')) { $Value['description'] } else { '' }
                if ($NewDesc.Length -gt $ExistingDesc.Length) {
                    $Normalized[$LowerKey] = $Value
                }
            } else {
                $Normalized[$LowerKey] = $Value
            }
        }

        $Normalized | ConvertTo-Json -Depth 5 | Set-Content -Path $LineageTarget -Encoding UTF8
        Write-Host "  Written: core/lineage-enrichments.json ($($Normalized.Count) keys, $DupeCount case-dupes merged)" -ForegroundColor Green

        $BakPath = "$LineageSource.bak"
        if (-not (Test-Path $BakPath)) {
            Copy-Item $LineageSource $BakPath
            Write-Host "  Backup:  lineage-enrichments.json.bak" -ForegroundColor DarkGray
        }
    }
} else {
    Write-Host "  Skip:    lineage-enrichments.json not found (nothing to migrate)" -ForegroundColor Yellow
}

# ── Step 5: Create empty integration-log.jsonl ───────────────────────────────
$IntegrationLog = Join-Path $CalibDir 'integration-log.jsonl'

if (-not (Test-Path $IntegrationLog)) {
    if ($PSCmdlet.ShouldProcess($IntegrationLog, 'Create empty integration log')) {
        [System.IO.File]::WriteAllText($IntegrationLog, '', [System.Text.UTF8Encoding]::new($false))
        Write-Host "  Created: integration-log.jsonl (empty)" -ForegroundColor Green
    }
} else {
    Write-Host "  Exists:  integration-log.jsonl" -ForegroundColor DarkGray
}

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host "`n=== Migration Complete ===" -ForegroundColor Cyan
Write-Host "  Core dir:         $CoreDir"
Write-Host "  Users dir:        $UsersDir"
Write-Host "  Integration log:  $IntegrationLog"
Write-Host ""
Write-Host "  Next: Update PS cmdlets to read from core/ (t/630)" -ForegroundColor DarkGray
Write-Host "  Then: Remove .bak files after verifying read-path works" -ForegroundColor DarkGray
Write-Host ""
