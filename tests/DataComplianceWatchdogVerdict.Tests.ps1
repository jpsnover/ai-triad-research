# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Both-arms + fail-safe proof for the t/4053 Orca-side watchdog reader predicate: an unrouted
# `bridge-stale` alert or a stale/missing scheduled watchdog run must surface (ShouldAct); an acked
# alert with a fresh scheduled run must stay quiet.

BeforeAll {
    . (Join-Path $PSScriptRoot '..' 'operations' 'devops' 'DataComplianceWatchdogVerdict.ps1')
    $script:Now = [datetime]::new(2026, 10, 7, 12, 0, 0, [DateTimeKind]::Utc)
    $script:Fresh = [datetime]::new(2026, 10, 7, 11, 41, 0, [DateTimeKind]::Utc)
    $script:Stale = [pscustomobject]@{ number = 40; title = 'Data: citation-link integrity offender(s) on push'; url = 'u'; labels = @('data-compliance', 'bridge-stale') }
}

Describe 'Get-DataComplianceWatchdogVerdict' {
    It 'is quiet when nothing is stale and the scheduled watchdog ran recently' {
        $v = Get-DataComplianceWatchdogVerdict -StaleIssues @() -LastScheduledSuccessAt $script:Fresh -Now $script:Now
        $v.ShouldAct | Should -BeFalse
        $v.WatchdogStale | Should -BeFalse
        $v.WatchdogAgeHours | Should -Be 0.3
    }
    It 'surfaces an unrouted bridge-stale alert (arm 1: a reader notices)' {
        $v = Get-DataComplianceWatchdogVerdict -StaleIssues @($script:Stale) -LastScheduledSuccessAt $script:Fresh -Now $script:Now
        $v.ShouldAct | Should -BeTrue
        @($v.UnroutedAlerts).Count | Should -Be 1
        $v.UnroutedAlerts[0].number | Should -Be 40
    }
    It 'does NOT surface a bridge-stale alert already labelled owner-acked (arm 2)' {
        $acked = [pscustomobject]@{ number = 40; title = 't'; url = 'u'; labels = @('data-compliance', 'bridge-stale', 'owner-acked') }
        $v = Get-DataComplianceWatchdogVerdict -StaleIssues @($acked) -LastScheduledSuccessAt $script:Fresh -Now $script:Now
        $v.ShouldAct | Should -BeFalse
        @($v.UnroutedAlerts).Count | Should -Be 0
    }
    It 'surfaces a watchdog whose last successful scheduled run is older than the threshold (arm 3)' {
        $old = [datetime]::new(2026, 10, 6, 20, 0, 0, [DateTimeKind]::Utc)
        $v = Get-DataComplianceWatchdogVerdict -LastScheduledSuccessAt $old -Now $script:Now
        $v.WatchdogAgeHours | Should -Be 16
        $v.WatchdogStale | Should -BeTrue
        $v.ShouldAct | Should -BeTrue
    }
    It 'FAIL-SAFE: no successful scheduled run at all is stale, never healthy' {
        $v = Get-DataComplianceWatchdogVerdict -LastScheduledSuccessAt $null -Now $script:Now
        $v.WatchdogStale | Should -BeTrue
        $v.WatchdogReason | Should -Match 'no successful scheduled'
        $v.ShouldAct | Should -BeTrue
    }
    It 'the threshold is exclusive: exactly 12h is not yet stale' {
        $edge = $script:Now.AddHours(-12)
        $v = Get-DataComplianceWatchdogVerdict -LastScheduledSuccessAt $edge -Now $script:Now
        $v.WatchdogStale | Should -BeFalse
    }
}
