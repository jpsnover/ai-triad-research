# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Both-arms + fail-safe proof for the t/3912 local escalation bridge predicate: an un-acked
# escalation or a stale/missing heartbeat must surface (ShouldAct); an acked escalation with a
# fresh heartbeat must stay quiet (no hourly re-ping of the same episode).

BeforeAll {
    . (Join-Path $PSScriptRoot '..' 'operations' 'devops' 'CiAlertEscalationVerdict.ps1')
    $script:Now = [datetime]::new(2026, 10, 5, 12, 0, 0, [DateTimeKind]::Utc)
    $script:FreshBody = 'main-ci-monitor heartbeat: 2026-10-05T10:00:00.000Z (run 1)'
    $script:Esc = [pscustomobject]@{ number = 2551; title = 'CANNOT EVALUATE'; url = 'u'; labels = @('main-ci-infra', 'alert-escalated') }
}

Describe 'Get-CiAlertEscalationVerdict' {
    It 'is quiet when nothing is escalated and the heartbeat is fresh' {
        $v = Get-CiAlertEscalationVerdict -EscalatedIssues @() -HeartbeatBody $script:FreshBody -Now $script:Now
        $v.ShouldAct | Should -BeFalse
        $v.HeartbeatAgeHours | Should -Be 2
        $v.HeartbeatStale | Should -BeFalse
    }
    It 'surfaces an un-acked escalation' {
        $v = Get-CiAlertEscalationVerdict -EscalatedIssues @($script:Esc) -HeartbeatBody $script:FreshBody -Now $script:Now
        $v.ShouldAct | Should -BeTrue
        @($v.UnackedEscalations).Count | Should -Be 1
        $v.UnackedEscalations[0].number | Should -Be 2551
    }
    It 'does NOT re-surface an escalation already labelled owner-acked (once per episode)' {
        $acked = [pscustomobject]@{ number = 2551; title = 't'; url = 'u'; labels = @('alert-escalated', 'owner-acked') }
        $v = Get-CiAlertEscalationVerdict -EscalatedIssues @($acked) -HeartbeatBody $script:FreshBody -Now $script:Now
        $v.ShouldAct | Should -BeFalse
        @($v.UnackedEscalations).Count | Should -Be 0
    }
    It 'surfaces a heartbeat older than the threshold (monitor dead before its own alert step)' {
        $old = 'main-ci-monitor heartbeat: 2026-10-04T20:00:00.000Z (run 1)'
        $v = Get-CiAlertEscalationVerdict -HeartbeatBody $old -Now $script:Now
        $v.HeartbeatAgeHours | Should -Be 16
        $v.HeartbeatStale | Should -BeTrue
        $v.ShouldAct | Should -BeTrue
    }
    It 'treats the observed throttled cadence (7.4h) as fresh' {
        $body = 'main-ci-monitor heartbeat: 2026-10-05T04:36:00.000Z (run 1)'
        (Get-CiAlertEscalationVerdict -HeartbeatBody $body -Now $script:Now).HeartbeatStale | Should -BeFalse
    }
    It 'fails SAFE: no heartbeat issue reads as stale, not healthy' {
        $v = Get-CiAlertEscalationVerdict -HeartbeatBody $null -Now $script:Now
        $v.HeartbeatStale | Should -BeTrue
        $v.HeartbeatReason | Should -Be 'no open heartbeat issue'
        $v.ShouldAct | Should -BeTrue
    }
    It 'fails SAFE: an unparseable stamp reads as stale' {
        $v = Get-CiAlertEscalationVerdict -HeartbeatBody 'heartbeat: garbage' -Now $script:Now
        $v.HeartbeatStale | Should -BeTrue
        $v.ShouldAct | Should -BeTrue
    }
}
