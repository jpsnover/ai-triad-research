# THROWAWAY — t/3546 GV Arm A (deterministic fail). Do not merge.
# Expect: test-powershell RED; the new Format-FlakeVerdictMessage output in the log
# (duration + contention caveat + FRESH-run direction), NOT the old "FAILED (both runs)".
Describe 'GV3546-ArmA-deterministic-fail' {
    It 'always fails (both runs)' {
        $true | Should -Be $false
    }
}
