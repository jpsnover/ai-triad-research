$debateDir = "C:\Users\jsnov\repos\ai-triad-data\debates"
$files = @(
    "debate-396208e0-60d6-4d60-a9e4-3af6b4cf9501.json",
    "debate-aba5274a-bc5a-4463-b76f-34bd92456c61.json",
    "debate-9152a7fd-d477-44d3-a5e1-29fa06943ba4.json",
    "debate-07a7dec5-f746-4438-b48d-8085163d7e12.json",
    "debate-1e459fb1-8a82-4016-9ea7-c5bda1494ebf.json"
)

$allResults = @()
$aggTurns = 0
$aggRetries = 0
$aggTriggers = @{}
$aggMicroFix = 0
$aggHintCategories = @{}

foreach ($file in $files) {
    $path = Join-Path $debateDir $file
    $debateId = $file -replace '^debate-' -replace '\.json$'
    $shortId = $debateId.Substring(0, 8)

    Write-Host "Processing $shortId ..." -ForegroundColor Cyan
    $json = Get-Content $path -Raw | ConvertFrom-Json

    # Count statement turns in transcript
    $statements = $json.transcript | Where-Object { $_.type -eq 'statement' }
    $totalStatements = $statements.Count

    # Analyze turn_validations
    $tv = $json.turn_validations
    $tvMap = if ($tv -and $tv.Count -gt 0) { $tv[0] } else { $null }

    $retries = 0
    $triggers = @{}
    $microFixCount = 0
    $turnDetails = @()

    if ($tvMap) {
        $turnKeys = $tvMap.PSObject.Properties.Name
        foreach ($k in $turnKeys) {
            $entry = $tvMap.$k
            $attemptCount = $entry.attempts.Count
            $final = $entry.final
            $retryTrigger = $final.retry_trigger
            $outcome = $final.outcome
            $hints = $final.repairHints

            $isRetried = ($attemptCount -gt 1)
            if ($isRetried) { $retries++ }

            # Classify trigger
            if ($retryTrigger -and $retryTrigger -ne 'none') {
                if (-not $triggers[$retryTrigger]) { $triggers[$retryTrigger] = 0 }
                $triggers[$retryTrigger]++
                if (-not $aggTriggers[$retryTrigger]) { $aggTriggers[$retryTrigger] = 0 }
                $aggTriggers[$retryTrigger]++
            }

            # Classify hint categories
            if ($hints) {
                foreach ($h in $hints) {
                    $hl = $h.ToLower()
                    if ($hl -match 'abstract|specificity|vague|generic') {
                        $cat = 'abstract_claims'
                    } elseif ($hl -match 'citation|source|reference|doi') {
                        $cat = 'citation_quality'
                    } elseif ($hl -match 'intervention|compliance') {
                        $cat = 'intervention_compliance'
                    } elseif ($hl -match 'evidence|empirical|data') {
                        $cat = 'evidence_quality'
                    } elseif ($hl -match 'operationalize|mechanism|specify') {
                        $cat = 'operationalization'
                    } else {
                        $cat = 'other'
                    }
                    if (-not $aggHintCategories[$cat]) { $aggHintCategories[$cat] = 0 }
                    $aggHintCategories[$cat]++
                }
            }

            # Check for micro_fix in attempts
            foreach ($att in $entry.attempts) {
                if ($att.PSObject.Properties['micro_fix'] -or $att.PSObject.Properties['microFix']) {
                    $microFixCount++
                }
                # Also check in prompt_delta for micro-fix
                if ($att.prompt_delta -and $att.prompt_delta -match 'micro.?fix') {
                    $microFixCount++
                }
            }

            # Also check statements metadata for micro_fix
        }
    }

    # Check statement metadata for micro_fix
    foreach ($s in $statements) {
        $m = $s.metadata
        if ($m.PSObject.Properties['micro_fix'] -or $m.PSObject.Properties['microFix']) {
            $microFixCount++
        }
    }

    $retryRate = if ($totalStatements -gt 0) { [math]::Round(($retries / $totalStatements) * 100, 1) } else { 0 }

    $allResults += [PSCustomObject]@{
        DebateId = $shortId
        Title = $json.title.Substring(0, [Math]::Min(40, $json.title.Length))
        Statements = $totalStatements
        Retries = $retries
        RetryRate = "$retryRate%"
        Triggers = ($triggers.GetEnumerator() | ForEach-Object { "$($_.Key):$($_.Value)" }) -join ', '
        MicroFix = $microFixCount
    }

    $aggTurns += $totalStatements
    $aggRetries += $retries
    $aggMicroFix += $microFixCount
}

Write-Host ""
Write-Host "=" * 110 -ForegroundColor Yellow
Write-Host "RETRY RATE ANALYSIS — 5 RECENT DEBATES" -ForegroundColor Yellow
Write-Host "=" * 110 -ForegroundColor Yellow
Write-Host ""

# Per-debate table
$allResults | Format-Table -AutoSize -Property DebateId, Title, Statements, Retries, RetryRate, Triggers, MicroFix

# Aggregate
$aggRetryRate = if ($aggTurns -gt 0) { [math]::Round(($aggRetries / $aggTurns) * 100, 1) } else { 0 }

Write-Host ""
Write-Host "AGGREGATE" -ForegroundColor Green
Write-Host "  Total turns:    $aggTurns"
Write-Host "  Total retries:  $aggRetries"
Write-Host "  Retry rate:     $aggRetryRate% (baseline: 29.9% = 20/67)"
Write-Host "  Micro-fix:      $aggMicroFix"
Write-Host ""

Write-Host "RETRY TRIGGER DISTRIBUTION" -ForegroundColor Green
if ($aggTriggers.Count -eq 0) {
    Write-Host "  (no retry triggers recorded)"
} else {
    $aggTriggers.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object {
        $pct = [math]::Round(($_.Value / [Math]::Max(1, $aggRetries)) * 100, 1)
        Write-Host ("  {0,-30} {1,4} ({2}%)" -f $_.Key, $_.Value, $pct)
    }
}

Write-Host ""
Write-Host "REPAIR HINT CATEGORIES (across all turns, not just retried)" -ForegroundColor Green
$aggHintCategories.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object {
    Write-Host ("  {0,-30} {1,4}" -f $_.Key, $_.Value)
}

Write-Host ""
Write-Host "COMPARISON TO BASELINE" -ForegroundColor Magenta
Write-Host "  Baseline:  29.9% retry rate (20/67 turns), 100% abstract_claims trigger"
Write-Host "  Current:   $aggRetryRate% retry rate ($aggRetries/$aggTurns turns)"
if ($aggTriggers.Count -gt 0) {
    $abstractCount = if ($aggTriggers['stageA_error']) { $aggTriggers['stageA_error'] } else { 0 }
    $abstractPct = if ($aggRetries -gt 0) { [math]::Round(($abstractCount / $aggRetries) * 100, 1) } else { 0 }
    Write-Host "  Abstract trigger share: $abstractPct% ($abstractCount/$aggRetries retries)"
} else {
    Write-Host "  No retries recorded — trigger distribution N/A"
}
