# THROWAWAY — t/3607 Arm E (red-then-label). Do NOT merge.
# Deliberately-failing gated test: lives in tests/ so the paths-filter sets powershell=true,
# so test-powershell runs it and goes RED → ci-gate red. Then a label toggle (same SHA) tests
# whether the Option-1 filter-skip lets ci-gate flip GREEN (unsafe) or stays RED (safe).
Describe 'GV3607-ArmE-deterministic-fail' {
    It 'always fails so ci-gate is red' {
        $true | Should -Be $false
    }
}
