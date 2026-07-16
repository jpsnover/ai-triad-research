<#
.SYNOPSIS
    Run the t/1438 A/B corpus-coverage experiment batch.
    Calls cli.ts directly (bypasses Invoke-AITDebate) to use enableCorpusCoverage.
.DESCRIPTION
    12 debates: 6 paired topics, interleaved C/T arms.
    CL conditions (t/1438#8):
      1. Interleave arms (C,T per topic) - enforced by config ordering
      2. Verify lever fired in treatment debates - checked post-run via flight recorder
      3. Archive exact inputs - batch config + coverage map snapshot
#>
[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'exp-1438-results'),
    [switch]$StopOnFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$BatchConfig = Join-Path $PSScriptRoot 'exp-1438-batch.json'
if (-not (Test-Path $BatchConfig)) {
    throw "Batch config not found: $BatchConfig"
}

$Batch = Get-Content -Raw -Path $BatchConfig | ConvertFrom-Json
$Debates = @($Batch.debates)

if (-not (Test-Path $OutputDirectory)) {
    $null = New-Item -ItemType Directory -Path $OutputDirectory -Force
}

# Archive inputs (CL condition #3)
$ArchiveDir = Join-Path $OutputDirectory 'archived-inputs'
if (-not (Test-Path $ArchiveDir)) {
    $null = New-Item -ItemType Directory -Path $ArchiveDir -Force
}
Copy-Item -Path $BatchConfig -Destination (Join-Path $ArchiveDir 'exp-1438-batch.json') -Force

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$DataRoot = (Resolve-Path (Join-Path $RepoRoot '../ai-triad-data')).Path
$CoverageMap = Join-Path $DataRoot 'calibration/corpus-coverage.json'
if (Test-Path $CoverageMap) {
    Copy-Item -Path $CoverageMap -Destination (Join-Path $ArchiveDir 'corpus-coverage.json') -Force
}

$CliPath = Join-Path $PSScriptRoot 'cli.ts'
$NpxCmd = Get-Command npx.cmd -ErrorAction SilentlyContinue
if (-not $NpxCmd) { $NpxCmd = Get-Command npx -ErrorAction SilentlyContinue }
if (-not $NpxCmd) { throw "npx not found — install Node.js 18+" }

Write-Host ''
Write-Host "Experiment t/1438 A/B batch: $($Debates.Count) debates" -ForegroundColor Cyan
Write-Host "  Output: $OutputDirectory"
Write-Host ''

$Results = [System.Collections.Generic.List[PSObject]]::new()
$BatchStart = Get-Date

foreach ($D in $Debates) {
    $Name = [string]$D.name
    $Arm = if ($D.enableCorpusCoverage) { 'TREATMENT' } else { 'CONTROL' }
    Write-Host "[$($Results.Count + 1)/$($Debates.Count)] $Arm  $Name" -ForegroundColor Cyan -NoNewline

    # Skip if already completed (resume logic)
    $ExistingDebate = @(Get-ChildItem -Path $OutputDirectory -Filter "$Name-debate.json" -ErrorAction SilentlyContinue)
    if ($ExistingDebate.Count -gt 0) {
        Write-Host " - SKIPPED (already exists)" -ForegroundColor DarkGray
        $Results.Add([PSCustomObject]@{ Name = $Name; Arm = $Arm; Status = 'skipped'; ElapsedMin = 0; Error = $null })
        continue
    }
    Write-Host ''

    # Write per-debate config to temp file
    $ConfigObj = @{
        topic              = [string]$D.topic
        name               = $Name
        model              = [string]$D.model
        useAdaptiveStaging = [bool]$D.useAdaptiveStaging
        pacing             = [string]$D.pacing
        outputDir          = $OutputDirectory
        slug               = $Name
        activePovers       = @('accelerationist', 'safetyist', 'skeptic')
        enableCorpusCoverage = [bool]$D.enableCorpusCoverage
    }
    $TempConfig = [System.IO.Path]::GetTempFileName()
    $ConfigObj | ConvertTo-Json -Depth 10 | Set-Content -Path $TempConfig -Encoding utf8NoBOM -NoNewline

    try {
        $DebateStart = Get-Date
        $Psi = [System.Diagnostics.ProcessStartInfo]::new()
        $Psi.FileName = $NpxCmd.Source
        $Psi.Arguments = "tsx `"$CliPath`" --config `"$TempConfig`""
        $Psi.UseShellExecute = $false
        $Psi.RedirectStandardOutput = $true
        $Psi.RedirectStandardError = $true
        $Psi.CreateNoWindow = $true

        $Proc = [System.Diagnostics.Process]::Start($Psi)
        $StdoutTask = $Proc.StandardOutput.ReadToEndAsync()
        $Stderr = $Proc.StandardError.ReadToEnd()
        $Proc.WaitForExit()
        $Stdout = $StdoutTask.GetAwaiter().GetResult()

        $Elapsed = ((Get-Date) - $DebateStart).TotalMinutes

        if ($Proc.ExitCode -ne 0) {
            Write-Warning "  FAILED ($([Math]::Round($Elapsed, 1)) min): $Stderr"
            $Results.Add([PSCustomObject]@{ Name = $Name; Arm = $Arm; Status = 'failed'; ElapsedMin = [Math]::Round($Elapsed, 2); Error = $Stderr })
            if ($StopOnFailure) {
                Write-Warning "Stopping batch due to -StopOnFailure"
                break
            }
        } else {
            Write-Host "  Done ($([Math]::Round($Elapsed, 1)) min)" -ForegroundColor Green
            # Save stdout (session JSON) to results
            $SessionPath = Join-Path $OutputDirectory "$Name.json"
            if (-not (Test-Path $SessionPath)) {
                $Stdout | Set-Content -Path $SessionPath -Encoding utf8NoBOM -NoNewline
            }
            $Results.Add([PSCustomObject]@{ Name = $Name; Arm = $Arm; Status = 'done'; ElapsedMin = [Math]::Round($Elapsed, 2); Error = $null })
        }
    } catch {
        Write-Warning "  EXCEPTION: $($_.Exception.Message)"
        $Results.Add([PSCustomObject]@{ Name = $Name; Arm = $Arm; Status = 'failed'; ElapsedMin = 0; Error = $_.Exception.Message })
        if ($StopOnFailure) { break }
    } finally {
        Remove-Item -Path $TempConfig -Force -ErrorAction SilentlyContinue
    }
}

$BatchElapsed = ((Get-Date) - $BatchStart).TotalMinutes
$Pass = @($Results | Where-Object { $_.Status -eq 'done' }).Count
$Fail = @($Results | Where-Object { $_.Status -eq 'failed' }).Count

Write-Host ''
Write-Host ("Batch complete: {0} done, {1} failed ({2:N1} min)" -f $Pass, $Fail, $BatchElapsed) `
    -ForegroundColor $(if ($Fail -eq 0) { 'Green' } else { 'Yellow' })

# Summary table
$Results | Format-Table Name, Arm, Status, ElapsedMin -AutoSize

# Save results summary
$SummaryPath = Join-Path $OutputDirectory 'batch-summary.json'
@{
    batch_name     = 'exp-1438-corpus-coverage-ab'
    created_at     = (Get-Date -Format 'o')
    pass           = $Pass
    fail           = $Fail
    elapsed_min    = [Math]::Round($BatchElapsed, 2)
    results        = @($Results | ForEach-Object { @{ name = $_.Name; arm = $_.Arm; status = $_.Status; elapsed_min = $_.ElapsedMin; error = $_.Error } })
} | ConvertTo-Json -Depth 5 | Set-Content -Path $SummaryPath -Encoding utf8NoBOM

[PSCustomObject]@{
    BatchName   = 'exp-1438-corpus-coverage-ab'
    Pass        = $Pass
    Fail        = $Fail
    ElapsedMin  = [Math]::Round($BatchElapsed, 2)
    SummaryPath = $SummaryPath
}
