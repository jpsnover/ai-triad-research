# t/4080 GV arm (a) — PROBE, never merge. Deterministic data-driven failure: must stay RED.
Describe 'ProbeT4080A' {
    It 'probe-a <Name>' -ForEach @(@{ Name = 'alpha'; V = 1 }, @{ Name = 'beta'; V = 2 }) {
        $V | Should -Be 1
    }
}
