# Delta re-review side probes (t/2947, CL Main) — empirical, not inferred.
# P1: reconcile PS's predicted baseline count (33,448) with the guard's key count.
# P2: does a committed-but-EMPTY `edges` array fail open SILENTLY (no Write-Verbose)?

param(
    [string]$CodeWt = 'C:/Users/jsnov/repos/ai-triad-research/.worktrees/cl-t2947-c',
    [string]$DataWt = 'C:/Users/jsnov/.claude/jobs/8a1caf99/tmp/data-ba3128f5'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$EdgesPath = Join-Path $DataWt 'taxonomy/Origin/edges.json'

[Environment]::SetEnvironmentVariable('AI_TRIAD_EDGE_RATIONALE_GATE', $null)
. (Join-Path $CodeWt 'scripts/AITriad/Private/New-ActionableError.ps1')
. (Join-Path $CodeWt 'scripts/AITriad/Private/Test-EdgeRationaleRegression.ps1')

Write-Host "=== P1: rationaled EDGES vs distinct rationaled KEYS at ba3128f5 ==="
$doc = Get-Content -LiteralPath $EdgesPath -Raw | ConvertFrom-Json
$all = @($doc.edges)
$rationaledEdges = 0
$keys = @{}
$dupKeys = @{}
foreach ($e in $all) {
    if (-not ($e.PSObject.Properties['source'] -and $e.PSObject.Properties['type'] -and $e.PSObject.Properties['target'])) { continue }
    $r = if ($e.PSObject.Properties['rationale']) { [string]$e.rationale } else { '' }
    if (-not [string]::IsNullOrWhiteSpace($r)) {
        $rationaledEdges++
        $k = "$($e.source)|$($e.type)|$($e.target)"
        if ($keys.ContainsKey($k)) { $dupKeys[$k] = ($keys[$k] + 1); $keys[$k] = $keys[$k] + 1 } else { $keys[$k] = 1 }
    }
}
Write-Host ("  total edges                 : {0}" -f $all.Count)
Write-Host ("  edges carrying a rationale  : {0}" -f $rationaledEdges)
Write-Host ("  DISTINCT rationaled keys    : {0}" -f $keys.Count)
Write-Host ("  collisions (key seen >1x)   : {0}" -f $dupKeys.Count)
foreach ($k in $dupKeys.Keys) { Write-Host ("    dup x{0}: {1}" -f $dupKeys[$k], $k) }
Write-Host ("  => edges - keys = {0}" -f ($rationaledEdges - $keys.Count))

Write-Host "`n=== P2: committed edges.json with an EMPTY edges array ==="
$sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ("cl-t2947-p2-" + [System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $sandbox -Force | Out-Null
Push-Location $sandbox
try {
    & git init -q . 2>&1 | Out-Null
    & git config user.email 'cl@local' ; & git config user.name 'cl'
    '{ "edges": [] }' | Set-Content -LiteralPath (Join-Path $sandbox 'edges.json') -Encoding utf8
    & git add edges.json 2>&1 | Out-Null
    & git commit -q -m 'empty edges baseline' --no-verify 2>&1 | Out-Null
    Write-Host ("  sandbox HEAD: " + (& git rev-parse --short HEAD))

    $payload = [pscustomobject]@{ edges = @([pscustomobject]@{ source = 'a'; type = 'SUPPORTS'; target = 'b' }) }
    $v = @()
    $rv = Test-EdgeRationaleRegression -EdgesData $payload -Path (Join-Path $sandbox 'edges.json') -Verbose 4>&1 |
          ForEach-Object {
              if ($_ -is [System.Management.Automation.VerboseRecord]) { $script:v += [string]$_.Message; $null }
              else { $_ }
          }
    Write-Host ("  return       : {0}" -f $rv)
    Write-Host ("  verbose lines: {0}" -f @($v).Count)
    foreach ($m in @($v)) { Write-Host "    V: $m" }
    if (@($v).Count -eq 0) { Write-Host "  => SILENT fail-open (no verbose emitted) — Finding-2 contract gap" }
    else { Write-Host "  => fail-open IS annotated" }

    Write-Host "`n  -- P2b: same sandbox, second call (cache-hit path) --"
    $v2 = @()
    $rv2 = Test-EdgeRationaleRegression -EdgesData $payload -Path (Join-Path $sandbox 'edges.json') -Verbose 4>&1 |
           ForEach-Object {
               if ($_ -is [System.Management.Automation.VerboseRecord]) { $script:v2 += [string]$_.Message; $null }
               else { $_ }
           }
    Write-Host ("  return       : {0}" -f $rv2)
    foreach ($m in @($v2)) { Write-Host "    V: $m" }
}
finally {
    Pop-Location
    Remove-Item -LiteralPath $sandbox -Recurse -Force -ErrorAction SilentlyContinue
}
