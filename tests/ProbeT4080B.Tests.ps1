# t/4080 GV arm (b) — PROBE, never merge. Fails on first attempt, passes on the in-job rerun: must heal GREEN.
Describe 'ProbeT4080B' {
    It 'probe-b flake heals on rerun' {
        $m = Join-Path ([IO.Path]::GetTempPath()) 'probe-t4080-b.marker'
        if (-not (Test-Path $m)) {
            New-Item -ItemType File -Path $m | Out-Null
            throw 'probe-b: first attempt fails by design'
        }
    }
}
