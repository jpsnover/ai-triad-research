# Phase 2 — verify the flash-lite brief+cite result on 2 more topics.
# Per topic: expensive (all claude-opus-4-8) + cheap (brief+cite = gemini-flash-lite-latest).
# Runs the 4 debates and writes a session-path manifest; measurement/comparison done separately.
# Run: pwsh -File research/comp-linguist/exp-phase2-verify.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module "$PSScriptRoot\..\..\scripts\AITriad\AITriad.psm1" -Force

# Keep-awake guard
Add-Type -Namespace Win32 -Name Power -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
[void][Win32.Power]::SetThreadExecutionState(([uint32]'0x80000000') -bor ([uint32]'0x00000001') -bor ([uint32]'0x00000040'))

$CheapModel = 'gemini-flash-lite-latest'
$ProgressFile = Join-Path $PSScriptRoot 'exp-phase2-progress.json'
$Manifest = Join-Path $PSScriptRoot 'exp-phase2-manifest.json'
$results = [System.Collections.Generic.List[object]]::new()

$Topics = @(
    @{ id = 'compute-licensing'; text = "Should frontier AI development be gated by compute-threshold licensing, and through what pathways would such a regime reshape the incentives of large labs, open-source developers, insurers, and national competitiveness — given the tension between preventing catastrophic capability concentration and chilling broad-based innovation?" }
    @{ id = 'labor-policy';       text = "As AI automates cognitive labor, should policy prioritize redistributive mechanisms (UBI, robot taxes) or transition mechanisms (retraining, wage insurance), and through what pathways does each reshape the incentives of firms, displaced workers, and innovators — given the tension between cushioning disruption and preserving economic dynamism?" }
)

$Common = @{
    Model               = 'claude-opus-4'
    ConfrontationRounds = 1
    ArgumentationRounds = 2
    ConcludingRounds    = 1
    ProgressFile        = $ProgressFile
    ProgressBatchName   = 'exp-phase2'
}

foreach ($t in $Topics) {
    foreach ($arm in @('expensive','cheap')) {
        $name = "exp-phase2-$($t.id)-$arm"
        Write-Host "=== Running $name ===" -ForegroundColor Cyan
        $params = $Common.Clone()
        $params.Topic              = $t.text
        $params.Name               = $name
        $params.ProgressDebateName = $name
        if ($arm -eq 'cheap') {
            $params.StageModels = @{ brief = $CheapModel; cite = $CheapModel }
        }
        try {
            $r = Invoke-AITDebate @params
            $sp = if ($r) { $r.SessionPath } else { $null }
            Write-Host "  -> $name complete: $sp" -ForegroundColor Green
            $results.Add([ordered]@{ topic = $t.id; arm = $arm; name = $name; sessionPath = $sp; ok = [bool]$sp })
        } catch {
            Write-Host "  -> $name FAILED: $($_.Exception.Message)" -ForegroundColor Red
            $results.Add([ordered]@{ topic = $t.id; arm = $arm; name = $name; sessionPath = $null; ok = $false; error = $_.Exception.Message })
        }
        $results | ConvertTo-Json -Depth 6 | Set-Content -Path $Manifest -Encoding utf8NoBOM
    }
}

Write-Host ""
Write-Host "=== Phase 2 debates complete — manifest: $Manifest ===" -ForegroundColor Green
$results | ForEach-Object { Write-Host ("{0,-12} {1,-10} ok={2}  {3}" -f $_.topic, $_.arm, $_.ok, $_.sessionPath) }
