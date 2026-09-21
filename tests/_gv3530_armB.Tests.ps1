# t/3530 GV Arm B — one-shot flake. Fails on its FIRST execution, passes on the rerun
# (a sentinel file created in run 1 persists to the rerun in the same job/filesystem).
# Gate must go GREEN with a loud ::warning:: naming this test. THROWAWAY evidence file.
Describe 'GV3530-ArmB-flake' {
    It 'fails on first execution, passes on rerun' {
        $sentinel = Join-Path ($env:RUNNER_TEMP ?? [System.IO.Path]::GetTempPath()) 'gv3530_armB.sentinel'
        if (-not (Test-Path $sentinel)) {
            New-Item -ItemType File -Path $sentinel -Force | Out-Null
            throw 'GV3530 Arm B: simulated first-run flake'
        }
        $true | Should -BeTrue
    }
}
