#Requires -Modules Pester
<#
.SYNOPSIS
    Standing both-arms gate for Sync-StagingEnv.ps1 (t/2630).

    Uses -MockCurrentEnvPath + -DryRun to avoid real Azure calls.
    Deploy-time condition (a) — that the synced value actually lands on the
    staging serving revision — is proved by the az containerapp revision show
    verify step in deploy-staging.yml, not here.
#>

Describe 'Sync-StagingEnv' {
    BeforeAll {
        $scriptRoot   = Split-Path $PSScriptRoot -Parent
        $syncScript   = Join-Path $scriptRoot 'operations/devops/Sync-StagingEnv.ps1'
        $fixtureDir   = Join-Path $PSScriptRoot 'fixtures/staging-env-sync'
        $bicepFixture = Join-Path $PSScriptRoot 'fixtures/bicep-env-drift/good-main.bicep'

        $matchingEnv = Join-Path $fixtureDir 'matching-env.json'
        $driftedEnv  = Join-Path $fixtureDir 'drifted-env.json'
    }

    It 'Pass arm: exits 0 (no-op) when staging env already matches Bicep baseEnv' {
        # matching-env.json has the same literal values as good-main.bicep.
        # The script must detect no drift and exit 0 without calling az.
        $proc = Start-Process pwsh `
            -ArgumentList '-NonInteractive', '-File', $syncScript,
                          '-BicepPath',           $bicepFixture,
                          '-MockCurrentEnvPath',  $matchingEnv,
                          '-DryRun' `
            -PassThru -Wait -NoNewWindow
        $proc.ExitCode | Should -Be 0
    }

    It 'Fire arm: exits 2 (-DryRun, drift) when staging env differs from Bicep' {
        # drifted-env.json has NODE_ENV=staging and stale data paths.
        # The script must detect drift and exit 2 (-DryRun sentinel for "would update").
        $proc = Start-Process pwsh `
            -ArgumentList '-NonInteractive', '-File', $syncScript,
                          '-BicepPath',           $bicepFixture,
                          '-MockCurrentEnvPath',  $driftedEnv,
                          '-DryRun' `
            -PassThru -Wait -NoNewWindow
        $proc.ExitCode | Should -Be 2
    }
}
