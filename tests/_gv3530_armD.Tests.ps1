# t/3530 GV Arm D — container/discovery error (unterminated hashtable = parse error at
# discovery). Yields FailedContainersCount>0 (FailedCount can be 0) -> gate must stay RED
# and must NOT enter the flake-rerun path. THROWAWAY evidence file.
Describe 'GV3530-ArmD-syntax-error' {
    It 'never runs — file has a parse error' {
        $broken = @{
    }
}
