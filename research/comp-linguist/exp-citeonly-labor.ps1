# One-topic rerun: labor-policy cite-only (cite=flash-lite, brief=Opus).
# The first attempt failed on a transient Opus-brief 120s timeout (not a flash-lite fault).
# Fresh run, file-redirected, session-poll. Run: pwsh -File research/comp-linguist/exp-citeonly-labor.ps1
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
$LogDir   = Join-Path $PSScriptRoot 'citeonly-logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Npx = (Get-Command npx.cmd -ErrorAction SilentlyContinue) ?? (Get-Command npx)
$TimeoutMin = 60
$CiteModel  = 'gemini-flash-lite-latest'

$slug = 'exp-citeonly-labor-policy-cheap'
$topic = "As AI automates cognitive labor, should policy prioritize redistributive mechanisms (UBI, robot taxes) or transition mechanisms (retraining, wage insurance), and through what pathways does each reshape the incentives of firms, displaced workers, and innovators — given the tension between cushioning disruption and preserving economic dynamism?"

# Mark complete only when the harvest artifact exists (the secondary -debate.json in cli-runs
# is transient; the harvest.json is the durable completion marker for this slug).
$harvest = Join-Path $OutDir "$slug-harvest.json"
$sessionTmp = Join-Path $OutDir "$slug-debate.json"

Write-Host "=== $slug (cite=$CiteModel, brief=Opus; timeout ${TimeoutMin}m) ===" -ForegroundColor Cyan
$cfg = [ordered]@{
    activePovers=@('accelerationist','safetyist','skeptic'); model='claude-opus-4'; rounds=4
    responseLength='medium'; protocolId='structured'; outputDir=$OutDir; outputFormat='json'
    slug=$slug; temperature=0.3; topic=$topic; stageModels=@{ cite = $CiteModel }
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
    if (Test-Path $sessionTmp) { Start-Sleep -Seconds 10; $status='ok_session'; break }
}
if ($status -eq 'running') { $status='timeout' }
if (-not $proc.HasExited) { try { $proc.Kill($true) } catch {} }
$haveHarvest = Test-Path $harvest
Write-Host "  status=$status harvest=$haveHarvest" -ForegroundColor ($haveHarvest ? 'Green' : 'Yellow')
