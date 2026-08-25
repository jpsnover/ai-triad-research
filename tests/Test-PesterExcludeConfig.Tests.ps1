# Guard test: proves data-compliance tests are excluded from the test-powershell Pester config.
#
# Prevention for t/3010 (incident t/2971 / t/3007): the ExcludePath decouple silently
# "worked" only because live data happened to pass (440/440 coincidence). This test proves
# the exclusion pattern actually filters data-compliance containers via real Pester discovery
# (not re-implemented glob matching), using the shared helper that ci.yml also dot-sources.
#
# Design: TestDrive fixture tree (no live-data needed) + Invoke-Pester with SkipRun so only
# discovery runs. Containers is post-filter in Pester 5/6 — excluded paths absent entirely
# (confirmed empirically 2026-08-24 with probe; SkipRun also confirmed to populate Containers).
#
# CLEAN arm: Get-PesterExcludePaths + SkipRun → dc container absent, sibling present.
# FIRE arm:  broken './tests/data-compliance/' + SkipRun → dc container leaks into Containers.
# Automated flip: swap helper to broken pattern → CLEAN assertion fails (dc appears).

BeforeAll {
    . "$PSScriptRoot/../operations/devops/Get-PesterExcludePaths.ps1"
}

Describe "Pester ExcludePath configuration — data-compliance isolation (t/3010)" {
    BeforeAll {
        New-Item -ItemType Directory "$TestDrive/data-compliance" -Force | Out-Null
        Set-Content "$TestDrive/data-compliance/Fixture.Compliance.Tests.ps1" `
            "Describe 'Fixture DC' { It 'stub' { `$true | Should -BeTrue } }"
        Set-Content "$TestDrive/Fixture.Other.Tests.ps1" `
            "Describe 'Fixture Other' { It 'stub' { `$true | Should -BeTrue } }"
    }

    It "CLEAN: correct ExcludePath excludes data-compliance from real Pester discovery" {
        $cfg = New-PesterConfiguration
        $cfg.Run.Path = "$TestDrive"
        $cfg.Run.ExcludePath = Get-PesterExcludePaths
        $cfg.Run.PassThru = $true
        $cfg.Run.SkipRun = $true
        $cfg.Output.Verbosity = 'None'
        $result = Invoke-Pester -Configuration $cfg

        $dcContainers = $result.Containers | Where-Object { $_.Item.FullName -like '*data-compliance*' }
        $dcContainers | Should -BeNullOrEmpty -Because "correct ExcludePath must prevent data-compliance containers from appearing in discovery"
        $result.Containers.Count | Should -BeGreaterThan 0 -Because "non-data-compliance sibling must still be discovered"
    }

    It "FIRE: broken ExcludePath leaks data-compliance into real Pester discovery" {
        $cfg = New-PesterConfiguration
        $cfg.Run.Path = "$TestDrive"
        $cfg.Run.ExcludePath = @('./tests/data-compliance/')  # old broken relative-path pattern
        $cfg.Run.PassThru = $true
        $cfg.Run.SkipRun = $true
        $cfg.Output.Verbosity = 'None'
        $result = Invoke-Pester -Configuration $cfg

        $dcContainers = $result.Containers | Where-Object { $_.Item.FullName -like '*data-compliance*' }
        $dcContainers | Should -Not -BeNullOrEmpty -Because "broken ExcludePath must fail to exclude data-compliance containers (proving the regression)"
    }
}
