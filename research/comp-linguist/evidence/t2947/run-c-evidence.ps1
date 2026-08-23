# (c) real-data evidence run — t/2947, CL Main.
# Head discipline: guard code is dot-sourced from the code worktree pinned at the FLIP head
# 775537b3; baseline HEAD is the ai-triad-data worktree pinned at ba3128f5.
# Read-only: no PS file is edited; the strip arm mutates an in-memory payload only.

param(
    # Code worktree pinned at the commit under evidence (the flip head 775537b3 for this run).
    [string]$CodeWt = 'C:/Users/jsnov/repos/ai-triad-research/.worktrees/cl-t2947-c',
    # ai-triad-data worktree pinned at the baseline commit (ba3128f5 for this run).
    [string]$DataWt = 'C:/Users/jsnov/.claude/jobs/8a1caf99/tmp/data-ba3128f5'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$EdgesPath = Join-Path $DataWt 'taxonomy/Origin/edges.json'

# Environment must be UNSET so we exercise the new DEFAULT (Block), not an explicit mode.
[Environment]::SetEnvironmentVariable('AI_TRIAD_EDGE_RATIONALE_GATE', $null)

. (Join-Path $CodeWt 'scripts/AITriad/Private/New-ActionableError.ps1')
. (Join-Path $CodeWt 'scripts/AITriad/Private/Test-EdgeRationaleRegression.ps1')

Write-Host "=== HEAD DISCIPLINE ==="
Write-Host ("code worktree HEAD : " + (& git -C $CodeWt rev-parse HEAD))
Write-Host ("data worktree HEAD : " + (& git -C $DataWt rev-parse HEAD))
Write-Host ("guard file sha     : " + (& git -C $CodeWt rev-parse 'HEAD:scripts/AITriad/Private/Test-EdgeRationaleRegression.ps1'))
Write-Host ("env gate           : '" + [Environment]::GetEnvironmentVariable('AI_TRIAD_EDGE_RATIONALE_GATE') + "' (unset => default)")

$swLoad = [System.Diagnostics.Stopwatch]::StartNew()
$doc = Get-Content -LiteralPath $EdgesPath -Raw | ConvertFrom-Json
$swLoad.Stop()
$totalEdges = @($doc.edges).Count
Write-Host ("payload edges      : {0} (load+parse {1:N1}s)" -f $totalEdges, $swLoad.Elapsed.TotalSeconds)

function Invoke-Arm {
    param([string]$Name, $Payload)
    $verbose = $null; $warn = $null; $rv = $null; $threw = $null
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $rv = Test-EdgeRationaleRegression -EdgesData $Payload -Path $EdgesPath `
                -Verbose -WarningVariable warn 4>&1 |
              ForEach-Object { $_ }   # merge verbose into the pipeline for capture
    } catch {
        $threw = $_
    }
    $sw.Stop()
    [pscustomobject]@{
        Name = $Name; Raw = $rv; Warnings = @($warn); Threw = $threw; Seconds = $sw.Elapsed.TotalSeconds
    }
}

function Split-Stream {
    param($Raw)
    $v = @(); $r = $null
    foreach ($item in @($Raw)) {
        if ($item -is [System.Management.Automation.VerboseRecord]) { $v += [string]$item.Message }
        elseif ($item -is [int]) { $r = $item }
        elseif ($null -ne $item) { $v += "[other:$($item.GetType().Name)] $item" }
    }
    [pscustomobject]@{ Verbose = $v; Return = $r }
}

# ── ARM 1: CLEAN (real full tree, unmodified payload) ─────────────────────────
Write-Host "`n=== ARM 1: CLEAN (uncached baseline resolve) ==="
$a1 = Invoke-Arm -Name 'clean' -Payload $doc
$s1 = Split-Stream $a1.Raw
$s1.Verbose | ForEach-Object { Write-Host "  V: $_" }
Write-Host ("  return   : {0}" -f $s1.Return)
Write-Host ("  warnings : {0}" -f $a1.Warnings.Count)
Write-Host ("  threw    : {0}" -f ($null -ne $a1.Threw))
Write-Host ("  wall     : {0:N2}s" -f $a1.Seconds)

# ── ARM 1b: CLEAN again (cache-hit path, wall-clock delta) ────────────────────
Write-Host "`n=== ARM 1b: CLEAN repeat (cache hit) ==="
$a1b = Invoke-Arm -Name 'clean-cached' -Payload $doc
$s1b = Split-Stream $a1b.Raw
$s1b.Verbose | ForEach-Object { Write-Host "  V: $_" }
Write-Host ("  return   : {0}   wall: {1:N2}s" -f $s1b.Return, $a1b.Seconds)

# ── ARM 2: FIRE (deliberate strip on the same real baseline) ──────────────────
Write-Host "`n=== ARM 2: FIRE (deliberate rationale strip, in-memory copy) ==="
$stripN = 5
$stripped = [pscustomobject]@{ edges = @() }
$newEdges = New-Object System.Collections.Generic.List[object]
$done = 0
$strippedKeys = @()
foreach ($e in @($doc.edges)) {
    $hasR = ($e.PSObject.Properties['rationale']) -and -not [string]::IsNullOrWhiteSpace([string]$e.rationale)
    if ($hasR -and $done -lt $stripN) {
        $copy = [pscustomobject]@{}
        foreach ($p in $e.PSObject.Properties) {
            if ($p.Name -ne 'rationale') { $copy | Add-Member -NotePropertyName $p.Name -NotePropertyValue $p.Value }
        }
        $newEdges.Add($copy)
        $strippedKeys += "$($e.source)|$($e.type)|$($e.target)"
        $done++
    } else {
        $newEdges.Add($e)
    }
}
$stripped.edges = $newEdges.ToArray()
Write-Host ("  stripped {0} edge(s); keys: {1}" -f $done, ($strippedKeys -join ' ; '))

$a2 = Invoke-Arm -Name 'fire' -Payload $stripped
$s2 = Split-Stream $a2.Raw
$s2.Verbose | ForEach-Object { Write-Host "  V: $_" }
Write-Host ("  return   : {0}" -f $s2.Return)
Write-Host ("  warnings : {0}" -f $a2.Warnings.Count)
if ($a2.Threw) {
    Write-Host "  THREW    : yes"
    Write-Host ("  --- error text ---`n{0}`n  --- end ---" -f $a2.Threw.Exception.Message)
} else {
    Write-Host "  THREW    : NO  <-- FAIL: Block default did not throw"
}
Write-Host ("  wall     : {0:N2}s" -f $a2.Seconds)

# ── ARM 3: message-split classification (missing KEY vs emptied array) ────────
Write-Host "`n=== ARM 3: emptied-array vs missing-key message split ==="
$emptied = [pscustomobject]@{ edges = @() }
$missing = [pscustomobject]@{ nodes = @() }
$a3a = Split-Stream (Invoke-Arm -Name 'emptied' -Payload $emptied).Raw
$a3b = Split-Stream (Invoke-Arm -Name 'missing' -Payload $missing).Raw
Write-Host "  emptied-array verbose:"; $a3a.Verbose | ForEach-Object { Write-Host "    V: $_" }
Write-Host "  missing-key   verbose:"; $a3b.Verbose | ForEach-Object { Write-Host "    V: $_" }

$emptiedMsgs = @($a3a.Verbose)
$missingMsgs = @($a3b.Verbose)
$scanTokenHitsEmptied = @($emptiedMsgs | Where-Object { $_ -match 'payload scanned' }).Count
$scanTokenHitsMissing = @($missingMsgs | Where-Object { $_ -match 'payload scanned' }).Count
$keyTokenHitsEmptied  = @($emptiedMsgs | Where-Object { $_ -match 'no edges KEY' }).Count
$keyTokenHitsMissing  = @($missingMsgs | Where-Object { $_ -match 'no edges KEY' }).Count
Write-Host ("  'payload scanned' -> emptied:{0} missing:{1}" -f $scanTokenHitsEmptied, $scanTokenHitsMissing)
Write-Host ("  'no edges KEY'    -> emptied:{0} missing:{1}" -f $keyTokenHitsEmptied, $keyTokenHitsMissing)

# ── ASSERTIONS ────────────────────────────────────────────────────────────────
Write-Host "`n=== (c) ASSERTIONS ==="
$fail = 0
function Assert-True { param([string]$Label, [bool]$Cond, [string]$Detail = '')
    if ($Cond) { Write-Host "  PASS  $Label $Detail" } else { Write-Host "  FAIL  $Label $Detail"; $script:fail++ }
}

$baseLine = @($s1.Verbose | Where-Object { $_ -match 'HEAD baseline resolved' }) | Select-Object -First 1
$baseCount = if ($baseLine -match 'resolved — ([\d,]+) rationaled key') { [int](($Matches[1]) -replace ',', '') } else { -1 }
Assert-True 'positive #1 baseline-resolved emitted, count > 0' ($baseCount -gt 0) "(count=$baseCount)"

$scanLine = @($s1.Verbose | Where-Object { $_ -match 'payload scanned' }) | Select-Object -First 1
$checked = -1; $skipped = -1
if ($scanLine -match 'checked ([\d,]+) edge\(s\), skipped ([\d,]+)') {
    $checked = [int](($Matches[1]) -replace ',', ''); $skipped = [int](($Matches[2]) -replace ',', '')
}
Assert-True 'positive #2 payload-scanned emitted, checked > 0' ($checked -gt 0) "(checked=$checked)"
Assert-True 'positive #2 skipped == 0'                        ($skipped -eq 0) "(skipped=$skipped)"
Assert-True 'payload-scanned checked == payload edge count'   ($checked -eq $totalEdges) "($checked vs $totalEdges)"
Assert-True 'clean arm returns 0'                             ($s1.Return -eq 0)
Assert-True 'clean arm emits ZERO warnings'                   ($a1.Warnings.Count -eq 0) "(n=$($a1.Warnings.Count))"
Assert-True 'clean arm does not throw'                        ($null -eq $a1.Threw)

Assert-True 'FIRE arm THROWS on default (Block flip)'         ($null -ne $a2.Threw)
if ($a2.Threw) {
    $t = [string]$a2.Threw.Exception.Message
    # New-ActionableError renders the four fields as Goal:/Error:/Location:/Resolve:
    Assert-True 'throw carries Goal'      ($t -match '(?im)^\s*Goal:')
    Assert-True 'throw carries Problem'   ($t -match '(?im)^\s*Error:')
    Assert-True 'throw carries Location'  ($t -match '(?im)^\s*Location:')
    Assert-True 'throw carries NextSteps' ($t -match '(?im)^\s*Resolve:')
    Assert-True 'throw names the strip count' ($t -match [regex]::Escape("$done edge(s) carrying a rationale"))
}
Assert-True 'FIRE arm emits no Write-Warning (throw, not warn)' ($a2.Warnings.Count -eq 0) "(n=$($a2.Warnings.Count))"

Assert-True 'split: emptied array reports payload scanned'      ($scanTokenHitsEmptied -eq 1)
Assert-True 'split: emptied array does NOT report no-edges-KEY' ($keyTokenHitsEmptied -eq 0)
Assert-True 'split: missing key reports no-edges-KEY'           ($keyTokenHitsMissing -eq 1)
Assert-True 'split: missing key does NOT report payload scanned' ($scanTokenHitsMissing -eq 0)

Write-Host ("`n=== WALL CLOCK ===")
Write-Host ("  clean (uncached baseline resolve) : {0:N2}s" -f $a1.Seconds)
Write-Host ("  clean (cache hit)                 : {0:N2}s" -f $a1b.Seconds)
Write-Host ("  fire  (cache hit)                 : {0:N2}s" -f $a2.Seconds)

Write-Host ("`n=== RESULT: {0} ({1} failed assertion(s)) ===" -f $(if ($fail -eq 0) { 'PASS' } else { 'FAIL' }), $fail)
exit $fail
