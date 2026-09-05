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

    It 'Orphan detection: exits 2 (-DryRun) when env has key not in bicep managed set' {
        # orphaned-env.json matches bicep literals but also has READYZ_FORCE_DATA_ROOT_FAILED=1,
        # which is absent from good-main.bicep entirely. Script must detect the orphan
        # and exit 2 (same sentinel as drift — "would update"). (t/3345)
        $orphanedEnv = Join-Path $fixtureDir 'orphaned-env.json'
        $proc = Start-Process pwsh `
            -ArgumentList '-NonInteractive', '-File', $syncScript,
                          '-BicepPath',           $bicepFixture,
                          '-MockCurrentEnvPath',  $orphanedEnv,
                          '-DryRun' `
            -PassThru -Wait -NoNewWindow
        $proc.ExitCode | Should -Be 2
    }

    It 'Safety boundary: non-literal bicep key (ALLOWED_ORIGINS) is not flagged as orphan' {
        # matching-env-with-nonliteral.json has ALLOWED_ORIGINS with a value.
        # ALLOWED_ORIGINS IS in good-main.bicep (as an interpolated/non-literal value),
        # so -NamesOnly must include it and the orphan check must NOT flag it. (t/3345)
        $envWithNonLiteral = Join-Path $fixtureDir 'matching-env-with-nonliteral.json'
        $proc = Start-Process pwsh `
            -ArgumentList '-NonInteractive', '-File', $syncScript,
                          '-BicepPath',           $bicepFixture,
                          '-MockCurrentEnvPath',  $envWithNonLiteral,
                          '-DryRun' `
            -PassThru -Wait -NoNewWindow
        $proc.ExitCode | Should -Be 0
    }

    It 'Secret ref keys are never flagged as orphans' {
        # matching-env.json has AZURE_KEYVAULT_URL as a secretRef (no value field).
        # The CurrentMap builder excludes secretRef entries, so they can never appear
        # in Orphans. Confirm the script exits 0 (matching env, no orphans). (t/3345)
        $proc = Start-Process pwsh `
            -ArgumentList '-NonInteractive', '-File', $syncScript,
                          '-BicepPath',           $bicepFixture,
                          '-MockCurrentEnvPath',  $matchingEnv,
                          '-DryRun' `
            -PassThru -Wait -NoNewWindow
        $proc.ExitCode | Should -Be 0
    }
}
