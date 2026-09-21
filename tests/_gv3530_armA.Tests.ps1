# t/3530 GV Arm A — deterministic failure. Fails run 1 AND the rerun -> gate must stay RED.
# THROWAWAY evidence file; the PR is never merged.
Describe 'GV3530-ArmA-deterministic-fail' {
    It 'always fails (both runs)' {
        $true | Should -Be $false
    }
}
