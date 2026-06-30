# Cite-only isolation — flash-lite on CITE only (brief stays Opus), vs the existing
# all-Opus expensive baselines. Tests whether the brief+cite regression (crux_addressed,
# claims_forgotten, utilization) comes from the BRIEF stage rather than CITE.
# Direct CLI, file-redirected, session-poll (same proven harness as exp-phase2-direct.ps1).
# Run: pwsh -File research/comp-linguist/exp-citeonly.ps1

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
$Manifest = Join-Path $PSScriptRoot 'exp-citeonly-manifest.json'
$Npx = (Get-Command npx.cmd -ErrorAction SilentlyContinue) ?? (Get-Command npx)
$TimeoutMin = 60
$CiteModel  = 'gemini-flash-lite-latest'

$Topics = @(
    @{ id='compute-licensing'; text="Should frontier AI development be gated by compute-threshold licensing, and through what pathways would such a regime reshape the incentives of large labs, open-source developers, insurers, and national competitiveness — given the tension between preventing catastrophic capability concentration and chilling broad-based innovation?" }
    @{ id='labor-policy';       text="As AI automates cognitive labor, should policy prioritize redistributive mechanisms (UBI, robot taxes) or transition mechanisms (retraining, wage insurance), and through what pathways does each reshape the incentives of firms, displaced workers, and innovators — given the tension between cushioning disruption and preserving economic dynamism?" }
)

$results = [System.Collections.Generic.List[object]]::new()

foreach ($t in $Topics) {
    $slug = "exp-citeonly-$($t.id)-cheap"
    $session = Join-Path $OutDir "$slug-debate.json"
    if (Test-Path $session) {
        Write-Host "=== $slug already complete — skipping ===" -ForegroundColor DarkGray
        $results.Add([ordered]@{ topic=$t.id; name=$slug; status='already_done'; sessionPath=$session; ok=$true }); continue
    }
    Write-Host "=== $slug (cite=$CiteModel, brief=Opus; timeout ${TimeoutMin}m) ===" -ForegroundColor Cyan
    $cfg = [ordered]@{
        activePovers=@('accelerationist','safetyist','skeptic'); model='claude-opus-4'; rounds=4
        responseLength='medium'; protocolId='structured'; outputDir=$OutDir; outputFormat='json'
        slug=$slug; temperature=0.3; topic=$t.text; stageModels=@{ cite = $CiteModel }
    }
    $cfgPath = Join-Path $LogDir "$slug.config.json"
    $cfg | ConvertTo-Json -Depth 8 | Set-Content -Path $cfgPath -Encoding utf8NoBOM
    $out = Join-Path $LogDir "$slug.out.log"; $err = Join-Path $LogDir "$slug.err.log"
    $start = Get-Date
    $proc = Start-Process -FilePath $Npx.Source -ArgumentList @('tsx',$CliPath,'--config',$cfgPath) `
        -WorkingDirectory $RepoRoot -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -NoNewWindow
    $deadline = (Get-Date).AddMinutes($TimeoutMin); $status='running'
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 20
        if ($proc.HasExited) { $status = ($proc.ExitCode -eq 0 ? 'ok' : "exit_$($proc.ExitCode)"); break }
        if (Test-Path $session) { Start-Sleep -Seconds 10; $status='ok_session'; break }
    }
    if ($status -eq 'running') { $status='timeout' }
    if (-not $proc.HasExited) { try { $proc.Kill($true) } catch {} }
    $haveSession = Test-Path $session
    Write-Host "  status=$status session=$haveSession" -ForegroundColor ($haveSession ? 'Green' : 'Yellow')
    $results.Add([ordered]@{ topic=$t.id; name=$slug; status=$status; sessionPath=($haveSession ? $session : $null); ok=$haveSession })
    $results | ConvertTo-Json -Depth 6 | Set-Content -Path $Manifest -Encoding utf8NoBOM
}
Write-Host "`n=== cite-only complete — manifest: $Manifest ===" -ForegroundColor Green
$results | ForEach-Object { Write-Host ("{0,-36} {1,-11} session={2}" -f $_.name, $_.status, $_.ok) }
