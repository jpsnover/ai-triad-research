# t/4080 GV arm (c) — PROBE, never merge. Test NAME changes between run 1 and the rerun: must stay RED (NotRerun).
BeforeDiscovery {
    $m = Join-Path ([IO.Path]::GetTempPath()) 'probe-t4080-c.marker'
    if (Test-Path $m) {
        $cases = @(@{ Name = 'second-run'; V = 1 })
    } else {
        New-Item -ItemType File -Path $m | Out-Null
        $cases = @(@{ Name = 'first-run'; V = 2 })
    }
}
Describe 'ProbeT4080C' {
    It 'probe-c <Name>' -ForEach $cases {
        $V | Should -Be 1
    }
}
