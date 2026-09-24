# THROWAWAY — t/3607 Arm A (joint-gv + auto-merge → joint-gv-guard RED). Do NOT merge.
# Deliberately fails so ci-gate stays RED — a safety belt: even with auto-merge armed on this
# joint-gv PR, GitHub can never complete the merge (a required check is red). The Arm A
# evidence is that the NEW joint-gv-guard.yml workflow goes RED once the joint-gv label is
# added while auto-merge is armed (the event-time enforcement path, t/3332 / t/3607).
Describe 'GV3607-ArmA-safety-belt' {
    It 'always fails so ci-gate is red and the throwaway cannot merge' {
        $true | Should -Be $false
    }
}
