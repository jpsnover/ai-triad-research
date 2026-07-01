# t/1252 verification — run 3 debates on the post-fix build (topic_resolution) spanning topic
# shapes, to confirm conclusions now open with a restated question and topic-keyterm overlap
# rises above the audited 0.43 baseline. Direct CLI, file-redirected, session-poll.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -Namespace Win32 -Name Power -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
[void][Win32.Power]::SetThreadExecutionState(([uint32]'0x80000000') -bor ([uint32]'0x00000001') -bor ([uint32]'0x00000040'))

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$CliPath  = Join-Path $RepoRoot 'lib/debate/cli.ts'
$OutDir   = 'C:\Users\jsnov\repos\ai-triad-data\debates\cli-runs'
$LogDir   = Join-Path $PSScriptRoot 'topicres-logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Npx = (Get-Command npx.cmd -ErrorAction SilentlyContinue) ?? (Get-Command npx)
$TimeoutMin = 45

$Topics = @(
    @{ id='binary';     text="Is the precautionary principle appropriate for AI regulation?" }
    @{ id='open';       text="How should democratic nations govern frontier AI development?" }
    @{ id='structured'; text="Under what conditions, and through which enforcement mechanisms, would compute-threshold licensing for frontier AI reduce catastrophic risk without entrenching incumbents?" }
)

foreach ($t in $Topics) {
    $slug = "exp-topicres-$($t.id)"
    $harvest = Join-Path $OutDir "$slug-harvest.json"
    if (Test-Path $harvest) { Write-Host "=== $slug done — skip ===" -ForegroundColor DarkGray; continue }
    Write-Host "=== $slug (rounds=3; timeout ${TimeoutMin}m) ===" -ForegroundColor Cyan
    $cfg = [ordered]@{
        activePovers=@('accelerationist','safetyist','skeptic'); model='claude-opus-4'; rounds=3
        responseLength='medium'; protocolId='structured'; outputDir=$OutDir; outputFormat='json'
        slug=$slug; temperature=0.3; topic=$t.text
    }
    $cfgPath = Join-Path $LogDir "$slug.config.json"
    $cfg | ConvertTo-Json -Depth 8 | Set-Content -Path $cfgPath -Encoding utf8NoBOM
    $out = Join-Path $LogDir "$slug.out.log"; $err = Join-Path $LogDir "$slug.err.log"
    $proc = Start-Process -FilePath $Npx.Source -ArgumentList @('tsx',$CliPath,'--config',$cfgPath) `
        -WorkingDirectory $RepoRoot -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -NoNewWindow
    $deadline = (Get-Date).AddMinutes($TimeoutMin); $status='running'
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 20
        if ($proc.HasExited) { $status = ($proc.ExitCode -eq 0 ? 'ok' : "exit_$($proc.ExitCode)"); break }
        if (Test-Path $harvest) { Start-Sleep -Seconds 10; $status='ok_session'; break }
    }
    if ($status -eq 'running') { $status='timeout' }
    if (-not $proc.HasExited) { try { $proc.Kill($true) } catch {} }
    Write-Host "  $slug status=$status harvest=$(Test-Path $harvest)" -ForegroundColor ((Test-Path $harvest) ? 'Green' : 'Yellow')
}
Write-Host "=== topicres runs complete ===" -ForegroundColor Green
