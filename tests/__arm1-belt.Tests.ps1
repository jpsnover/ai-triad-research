# THROWAWAY — t/3607 cond-1 transition arm. Deliberately-failing belt so ci-gate stays RED
# and auto-merge can NEVER fire while I prove the guard's RED->GREEN transition. NEVER MERGE.
Describe 'arm1-belt (t3607 cond-1) — deliberate fail, throwaway' {
    It 'intentionally fails to keep ci-gate RED so auto-merge cannot complete' {
        $false | Should -BeTrue
    }
}
