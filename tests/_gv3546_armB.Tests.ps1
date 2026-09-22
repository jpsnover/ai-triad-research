# THROWAWAY — t/3546 GV Arm B (one-shot flake). Do not merge.
# Fails on first execution, passes on the rerun (marker file persists in the same job).
# Expect: test-powershell GREEN (self-healed) — proves the 5s pre-rerun delay does NOT
# break the heal path.
Describe 'GV3546-ArmB-flake' {
    It 'fails on first execution, passes on rerun' {
        $marker = Join-Path ([System.IO.Path]::GetTempPath()) 'gv3546_armB.flag'
        if (Test-Path -LiteralPath $marker) {
            $true | Should -BeTrue
        } else {
            New-Item -ItemType File -Path $marker -Force | Out-Null
            throw 'GV3546 Arm B: simulated first-run flake'
        }
    }
}
