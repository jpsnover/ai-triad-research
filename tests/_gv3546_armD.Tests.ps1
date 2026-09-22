# THROWAWAY — t/3546 GV Arm D (discovery/parse error). Do not merge.
# Expect: test-powershell RED FAST via the FailedContainersCount branch (no rerun) —
# proves the discovery-error path is unchanged by the t/3546 verdict rework.
Describe 'GV3546-ArmD-syntax-error' {
    It 'unreachable — discovery fails first' {
        $true | Should -BeTrue
    }
}
# Deliberate parse error (unterminated hashtable) → ParseException at discovery:
$broken = @{
