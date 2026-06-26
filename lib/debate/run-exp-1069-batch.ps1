# Run t/1069 model substitution experiments sequentially
# 12 debates: 4 conditions x 3 topics
# Usage: pwsh lib/debate/run-exp-1069-batch.ps1
# Requires: ANTHROPIC_API_KEY and GEMINI_API_KEY env vars

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)

$dataRoot = Resolve-Path '../ai-triad-data'
$outputDir = Join-Path $dataRoot 'debates'
$batchFile = if ($args[0]) { $args[0] } else { 'lib/debate/exp-1069-coarse-batch.json' }

$batch = Get-Content $batchFile -Raw | ConvertFrom-Json
$total = $batch.Count

Write-Host "[exp-1069] Starting $total model substitution experiments"
Write-Host "[exp-1069] Output dir: $outputDir"
Write-Host "[exp-1069] Conditions: control, summary->flash-lite, evaluator->flash-lite, scope->flash-lite"
Write-Host ""

$passed = 0
$failed = 0
$results = @()

for ($i = 0; $i -lt $total; $i++) {
    $n = $i + 1
    $cfg = $batch[$i]
    $name = $cfg.name

    Write-Host "[exp-1069] ======================================="
    Write-Host "[exp-1069] Debate $n/$total`: $name"
    Write-Host "[exp-1069] ======================================="

    $cfgCopy = $cfg | ConvertTo-Json -Depth 5 | ConvertFrom-Json
    $cfgCopy | Add-Member -NotePropertyName 'outputDir' -NotePropertyValue $outputDir -Force

    $tmpFile = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.json'
    $cfgCopy | ConvertTo-Json -Depth 5 | Set-Content $tmpFile -Encoding utf8

    $startTime = Get-Date
    try {
        $output = npx tsx lib/debate/cli.ts --config $tmpFile 2>&1
        $exitCode = $LASTEXITCODE
        $elapsed = (Get-Date) - $startTime

        if ($exitCode -eq 0) {
            Write-Host "[exp-1069] OK Debate $n/$total completed: $name ($([math]::Round($elapsed.TotalMinutes, 1)) min)"
            $passed++
            $results += [PSCustomObject]@{ Name = $name; Status = 'PASS'; Minutes = [math]::Round($elapsed.TotalMinutes, 1) }
        } else {
            Write-Host "[exp-1069] FAIL Debate $n/$total FAILED: $name (exit $exitCode)"
            $failed++
            $results += [PSCustomObject]@{ Name = $name; Status = 'FAIL'; Minutes = [math]::Round($elapsed.TotalMinutes, 1) }
        }
    } catch {
        $elapsed = (Get-Date) - $startTime
        Write-Host "[exp-1069] FAIL Debate $n/$total ERROR: $name - $_"
        $failed++
        $results += [PSCustomObject]@{ Name = $name; Status = 'ERROR'; Minutes = [math]::Round($elapsed.TotalMinutes, 1) }
    } finally {
        Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "[exp-1069] ======================================="
Write-Host "[exp-1069] Batch complete: $passed passed, $failed failed out of $total"
Write-Host "[exp-1069] ======================================="
$results | Format-Table -AutoSize
Write-Host "[exp-1069] Output files:"
Get-ChildItem "$outputDir/exp-1069-*" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
