# Phase 2 (direct-CLI) — bypass Invoke-AITDebate; run lib/debate/cli.ts directly with
# file-redirected output (no pipe deadlock) and a HARD per-debate timeout so a single
# hung debate is killed and the batch continues. Sessions are crash-safe on disk.
# Run: pwsh -File research/comp-linguist/exp-phase2-direct.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Keep-awake
Add-Type -Namespace Win32 -Name Power -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
[void][Win32.Power]::SetThreadExecutionState(([uint32]'0x80000000') -bor ([uint32]'0x00000001') -bor ([uint32]'0x00000040'))

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$CliPath  = Join-Path $RepoRoot 'lib/debate/cli.ts'
$OutDir   = 'C:\Users\jsnov\repos\ai-triad-data\debates\cli-runs'
$LogDir   = Join-Path $PSScriptRoot 'phase2-logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Manifest = Join-Path $PSScriptRoot 'exp-phase2-manifest.json'
$Npx = (Get-Command npx.cmd -ErrorAction SilentlyContinue) ?? (Get-Command npx)
$TimeoutMin = 60
$CheapModel = 'gemini-flash-lite-latest'

$Topics = @(
    @{ id='compute-licensing'; text="Should frontier AI development be gated by compute-threshold licensing, and through what pathways would such a regime reshape the incentives of large labs, open-source developers, insurers, and national competitiveness — given the tension between preventing catastrophic capability concentration and chilling broad-based innovation?" }
    @{ id='labor-policy';       text="As AI automates cognitive labor, should policy prioritize redistributive mechanisms (UBI, robot taxes) or transition mechanisms (retraining, wage insurance), and through what pathways does each reshape the incentives of firms, displaced workers, and innovators — given the tension between cushioning disruption and preserving economic dynamism?" }
)

$results = [System.Collections.Generic.List[object]]::new()

function Build-Config($topic, $slug, $arm) {
    $cfg = [ordered]@{
        activePovers   = @('accelerationist','safetyist','skeptic')
        model          = 'claude-opus-4'
        rounds         = 4
        responseLength = 'medium'
        protocolId     = 'structured'
        outputDir      = $OutDir
        outputFormat   = 'json'
        slug           = $slug
        temperature    = 0.3
        topic          = $topic
    }
    if ($arm -eq 'cheap') { $cfg.stageModels = @{ brief = $CheapModel; cite = $CheapModel } }
    return $cfg
}

foreach ($t in $Topics) {
    foreach ($arm in @('expensive','cheap')) {
        $slug = "exp-phase2-$($t.id)-$arm"
        $session = Join-Path $OutDir "$slug-debate.json"
        if (Test-Path $session) {
            Write-Host "=== $slug already complete — skipping ===" -ForegroundColor DarkGray
            $results.Add([ordered]@{ topic=$t.id; arm=$arm; name=$slug; status='already_done'; durationSec=0; sessionPath=$session; ok=$true })
            $results | ConvertTo-Json -Depth 6 | Set-Content -Path $Manifest -Encoding utf8NoBOM
            continue
        }
        Write-Host "=== $slug (timeout ${TimeoutMin}m) ===" -ForegroundColor Cyan
        $cfgPath = Join-Path $LogDir "$slug.config.json"
        (Build-Config $t.text $slug $arm) | ConvertTo-Json -Depth 8 | Set-Content -Path $cfgPath -Encoding utf8NoBOM
        $out = Join-Path $LogDir "$slug.out.log"; $err = Join-Path $LogDir "$slug.err.log"
        $start = [DateTime]::UtcNow
        $proc = Start-Process -FilePath $Npx.Source `
            -ArgumentList @('tsx', $CliPath, '--config', $cfgPath) `
            -WorkingDirectory $RepoRoot -RedirectStandardOutput $out -RedirectStandardError $err `
            -PassThru -NoNewWindow
        # Poll for the session file — the CLI lingers after finalization, so advance as
        # soon as the session lands rather than waiting for the process to exit.
        $deadline = (Get-Date).AddMinutes($TimeoutMin)
        $status = 'running'
        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 20
            if ($proc.HasExited) { $status = ($proc.ExitCode -eq 0 ? 'ok' : "exit_$($proc.ExitCode)"); break }
            if (Test-Path $session) { Start-Sleep -Seconds 10; $status = 'ok_session'; break }
        }
        if ($status -eq 'running') { $status = 'timeout' }
        if (-not $proc.HasExited) { try { $proc.Kill($true) } catch {} }
        $dur = [int]((Get-Date) - $start).TotalSeconds
        $haveSession = Test-Path $session
        Write-Host "  status=$status dur=${dur}s session=$haveSession" -ForegroundColor ($haveSession ? 'Green' : 'Yellow')
        $results.Add([ordered]@{ topic=$t.id; arm=$arm; name=$slug; status=$status; durationSec=$dur; sessionPath=($haveSession ? $session : $null); ok=$haveSession })
        $results | ConvertTo-Json -Depth 6 | Set-Content -Path $Manifest -Encoding utf8NoBOM
    }
}

Write-Host "`n=== Phase 2 (direct) complete — manifest: $Manifest ===" -ForegroundColor Green
$results | ForEach-Object { Write-Host ("{0,-30} {1,-9} {2,5}s  session={3}" -f $_.name, $_.status, $_.durationSec, $_.ok) }
