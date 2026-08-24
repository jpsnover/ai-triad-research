# Guard test: proves data-compliance tests are excluded from the test-powershell Pester config.
#
# Prevention for t/3010 (incident t/2971 / t/3007): the ExcludePath decouple silently
# "worked" only because live data happened to pass (440/440 coincidence). This test proves
# the exclusion pattern actually matches data-compliance file paths via Pester's own -like
# mechanism, using the shared helper that ci.yml also dot-sources.
#
# Empirically confirmed (2026-08-24): Pester 5 PassThru $result.Containers is post-filter —
# excluded containers are absent entirely (not present with ShouldRun=$false). Assertion
# uses the same -like matching Pester applies internally to ExcludePath (confirmed via source).
#
# CLEAN arm: Get-PesterExcludePaths pattern matches data-compliance FullName → excluded.
# FIRE arm:  Old broken pattern './tests/data-compliance/' does NOT match FullName (relative
#            vs absolute) → files leak. Flip: swap helper to broken pattern → CLEAN arm fails.

BeforeAll {
    . "$PSScriptRoot/../operations/devops/Get-PesterExcludePaths.ps1"
    # Normalize to forward slashes: Pester applies ExcludePath via -like against normalized
    # paths (confirmed empirically 2026-08-24 — probe showed correct exclusion on Windows
    # with */data-compliance/* glob despite backslash FullName).
    $script:dcPath   = (Get-Item "$PSScriptRoot/data-compliance/Test-SituationBDI.LiveData.Tests.ps1").FullName.Replace('\', '/')
    $script:selfPath = (Get-Item "$PSScriptRoot/Test-PesterExcludeConfig.Tests.ps1").FullName.Replace('\', '/')
}

Describe "Pester ExcludePath configuration — data-compliance isolation (t/3010)" {

    It "CLEAN: Get-PesterExcludePaths pattern matches data-compliance file path (Pester would exclude it)" {
        $paths = Get-PesterExcludePaths
        $matched = $paths | Where-Object { $script:dcPath -like $_ }
        $matched | Should -Not -BeNullOrEmpty -Because "'*/data-compliance/*' must match the data-compliance FullName"
    }

    It "CLEAN: Get-PesterExcludePaths pattern does NOT match non-data-compliance files (no over-exclusion)" {
        $paths = Get-PesterExcludePaths
        $matched = $paths | Where-Object { $script:selfPath -like $_ }
        $matched | Should -BeNullOrEmpty -Because "pattern must not accidentally exclude tests outside data-compliance"
    }

    It "FIRE: old broken pattern './tests/data-compliance/' fails to match data-compliance FullName (regression bait)" {
        # Pre-fix pattern used a relative path. Pester matches ExcludePath against FullName
        # (absolute), so a relative pattern never matches — data-compliance tests leaked into CI.
        # This It-block is green when the broken pattern correctly fails.
        # Flip evidence: replace Get-PesterExcludePaths return value with this pattern → CLEAN arm above fails.
        $brokenPattern = @('./tests/data-compliance/')
        $matched = $brokenPattern | Where-Object { $script:dcPath -like $_ }
        $matched | Should -BeNullOrEmpty -Because "broken relative-path pattern must fail to match FullName"
    }
}
