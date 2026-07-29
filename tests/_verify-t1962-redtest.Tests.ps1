# ci-gate verify — case (b): DELIBERATELY-FAILING test. DO NOT MERGE.
# Touches tests/** so the paths-filter runs test-powershell, which must FAIL,
# so ci-gate must report FAILURE and the PR must be unmergeable. This is the
# load-bearing block (TL p/28#114): a real red test must actually block.
Describe 'ci-gate verify t/1962 case (b)' {
    It 'fails on purpose to prove ci-gate blocks a red test-powershell' {
        $false | Should -BeTrue
    }
}
