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

    It 'cond-1 REAL az shape: secret-backed key {secretRef, value:""} is excluded from orphans (t/3345)' {
        # secret-realshape-env.json matches bicep literals + ROGUE_SECRET as
        # {secretRef:'rogue-secret', value:''} — the REAL az output shape (empty-STRING value, not a
        # missing value field). The original bug: the value-presence filter let this into CurrentMap →
        # flagged it a (non-bicep) orphan. The secretRef-non-empty exclusion must skip it → no orphan,
        # no drift → exit 0. Regression guard for the t/3345#5 over-match (this shape, not the mock's).
        $envRealSecret = Join-Path $fixtureDir 'secret-realshape-env.json'
        $proc = Start-Process pwsh `
            -ArgumentList '-NonInteractive', '-File', $syncScript,
                          '-BicepPath',           $bicepFixture,
                          '-MockCurrentEnvPath',  $envRealSecret,
                          '-DryRun' `
            -PassThru -Wait -NoNewWindow
        $proc.ExitCode | Should -Be 0
    }

    It 'cond-2 allowlist: workflow-managed DEPLOY_TAG/DEPLOY_SHA are not flagged as orphans (t/3345)' {
        # deploy-metadata-env.json matches bicep literals + DEPLOY_TAG/DEPLOY_SHA (plain values set at
        # deploy time, never in bicep). The $WorkflowManagedKeys allowlist must exclude them from the
        # orphan set → no orphan, no drift → exit 0. Guards against a regression that drops the allowlist
        # and would delete live deploy metadata under Phase-2. (t/3345#5 / #6)
        $envDeployMeta = Join-Path $fixtureDir 'deploy-metadata-env.json'
        $proc = Start-Process pwsh `
            -ArgumentList '-NonInteractive', '-File', $syncScript,
                          '-BicepPath',           $bicepFixture,
                          '-MockCurrentEnvPath',  $envDeployMeta,
                          '-DryRun' `
            -PassThru -Wait -NoNewWindow
        $proc.ExitCode | Should -Be 0
    }

    It 'SO cond-1 circuit breaker: >3 orphans → abort (exit 1), even in DryRun (t/3345 Phase-2, e/144#2)' {
        # many-orphans-env.json has 4 non-bicep plain keys (ORPH_A..D). Real drift is 1-2 keys; a set
        # this large signals a parse failure → the mass-removal breaker must abort WITHOUT removal
        # (exit 1), not proceed to a would-remove. Aborts in DryRun too (guards the PLAN, not just apply).
        $envMany = Join-Path $fixtureDir 'many-orphans-env.json'
        $proc = Start-Process pwsh `
            -ArgumentList '-NonInteractive', '-File', $syncScript,
                          '-BicepPath',           $bicepFixture,
                          '-MockCurrentEnvPath',  $envMany,
                          '-DryRun' `
            -PassThru -Wait -NoNewWindow
        $proc.ExitCode | Should -Be 1
    }

    It 'SO cond-3 staging-only guard: orphan removal refused on a non-staging app name → exit 1 (t/3345 Phase-2, e/144#2)' {
        # orphaned-env.json has one true orphan (passes the breaker). With -AppName set to the PROD app,
        # the staging-only guard must refuse the removal (exit 1) rather than reconcile prod with this
        # incremental model. Enforced in code, not workflow convention.
        $orphanedEnv = Join-Path $fixtureDir 'orphaned-env.json'
        $proc = Start-Process pwsh `
            -ArgumentList '-NonInteractive', '-File', $syncScript,
                          '-BicepPath',           $bicepFixture,
                          '-MockCurrentEnvPath',  $orphanedEnv,
                          '-AppName',             'taxonomy-editor',
                          '-DryRun' `
            -PassThru -Wait -NoNewWindow
        $proc.ExitCode | Should -Be 1
    }
}
