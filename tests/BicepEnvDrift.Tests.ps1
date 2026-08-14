#Requires -Modules Pester
<#
.SYNOPSIS
    Standing both-arms gate test for the Bicep baseEnv drift-detector (t/2631).

    Why two arms matter (TL Gate Verification requirement):
      Pass arm alone cannot detect a rotted detector that silently always-passes.
      The fire arm (exit 1 on drift) must be a permanent CI assertion, not a
      one-time local claim.
#>

Describe 'Test-BicepEnvDrift' {
    BeforeAll {
        $scriptRoot = Split-Path $PSScriptRoot -Parent
        $driftScript = Join-Path $scriptRoot 'operations/devops/Test-BicepEnvDrift.ps1'
        $fixtureDir  = Join-Path $PSScriptRoot 'fixtures/bicep-env-drift'

        $goodBicep   = Join-Path $fixtureDir 'good-main.bicep'
        $goodYml     = Join-Path $fixtureDir 'good-deploy-azure.yml'
        $driftedBicep = Join-Path $fixtureDir 'drifted-main.bicep'
    }

    It 'Pass arm: exits 0 when Bicep literals match ExpectedEnvVars' {
        # good-main.bicep and good-deploy-azure.yml are in sync.
        # Detector must exit 0 and emit no ::error:: annotations.
        $proc = Start-Process pwsh `
            -ArgumentList '-NonInteractive', '-File', $driftScript,
                          '-BicepPath', $goodBicep,
                          '-DeployYmlPath', $goodYml `
            -PassThru -Wait -NoNewWindow
        $proc.ExitCode | Should -Be 0
    }

    It 'Fire arm: exits 1 when Bicep literal differs from ExpectedEnvVars' {
        # drifted-main.bicep has NODE_ENV=staging vs good-deploy-azure.yml's
        # NODE_ENV=production — detector must catch the mismatch and exit 1.
        $proc = Start-Process pwsh `
            -ArgumentList '-NonInteractive', '-File', $driftScript,
                          '-BicepPath', $driftedBicep,
                          '-DeployYmlPath', $goodYml `
            -PassThru -Wait -NoNewWindow
        $proc.ExitCode | Should -Be 1
    }

    It 'Fire arm: exits 1 when a Bicep literal key is absent from ExpectedEnvVars' {
        # Inline fixture: Bicep has a key that the YML table is missing entirely.
        $tmpBicep = Join-Path $TestDrive 'missing-key.bicep'
        Set-Content $tmpBicep @'
var baseEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'HOME', value: '/home/aitriad' }
  { name: 'BRAND_NEW_KEY', value: '/new/path' }
]
'@
        $proc = Start-Process pwsh `
            -ArgumentList '-NonInteractive', '-File', $driftScript,
                          '-BicepPath', $tmpBicep,
                          '-DeployYmlPath', $goodYml `
            -PassThru -Wait -NoNewWindow
        $proc.ExitCode | Should -Be 1
    }
}
