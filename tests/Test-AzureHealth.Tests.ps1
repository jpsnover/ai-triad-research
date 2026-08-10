# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-AzureHealth -CheckConfig' {

    Context 'Traffic check — broken arm (weight mismatch)' {
        BeforeAll {
            Mock -ModuleName AITriad Invoke-RemoteCheck {
                [PSCustomObject]@{ Success = $false; StatusCode = 0; ResponseMs = 0; Error = 'mocked'; Body = $null }
            }
            Mock -ModuleName AITriad az {
                $global:LASTEXITCODE = 0
                $cmd = $args -join ' '
                if ($cmd -like '*containerapp ingress traffic show*') {
                    '[{"revisionName":"rev-old","weight":100},{"revisionName":"rev-new","weight":0}]'
                }
                elseif ($cmd -like '*containerapp show*') {
                    '{"properties":{"provisioningState":"Succeeded","runningStatus":"Running","template":{"containers":[{"name":"app","env":[]}]}}}'
                }
                else { '{}' }
            }
        }

        It 'emits Config:Traffic FAIL when weight does not match expected' {
            $Result = Test-AzureHealth -CheckConfig `
                -ExpectedTrafficRevision 'rev-new' `
                -ExpectedTrafficWeight 100 `
                -ResourceGroup 'rg-test' -AppName 'app-test'

            $TrafficCheck = @($Result.Checks | Where-Object { $_.Check -eq 'Config:Traffic' })
            $TrafficCheck.Count | Should -Be 1
            $TrafficCheck[0].Pass | Should -Be $false
            $TrafficCheck[0].Detail | Should -BeLike '*weight=0*expected=100*'
        }
    }

    Context 'Env var check — broken arm (mismatch + missing)' {
        BeforeAll {
            Mock -ModuleName AITriad Invoke-RemoteCheck {
                [PSCustomObject]@{ Success = $false; StatusCode = 0; ResponseMs = 0; Error = 'mocked'; Body = $null }
            }
            Mock -ModuleName AITriad az {
                $global:LASTEXITCODE = 0
                $cmd = $args -join ' '
                if ($cmd -like '*containerapp show*') {
                    # ADMIN_USERS is wrong value; NODE_ENV is present+correct; GIT_SYNC_ENABLED is absent
                    '{"properties":{"provisioningState":"Succeeded","runningStatus":"Running","template":{"containers":[{"name":"app","env":[{"name":"NODE_ENV","value":"production"},{"name":"ADMIN_USERS","value":"wrong@example.com"}]}]}}}'
                }
                else { '{}' }
            }
        }

        It 'reports MISMATCH for wrong ADMIN_USERS and MISSING for absent GIT_SYNC_ENABLED' {
            $Result = Test-AzureHealth -CheckConfig `
                -ExpectedEnvVars @{
                    NODE_ENV         = 'production'
                    ADMIN_USERS      = 'correct@example.com'
                    GIT_SYNC_ENABLED = '1'
                } `
                -ConfigRetryCount 1 `
                -ResourceGroup 'rg-test' -AppName 'app-test'

            $EnvChecks = @($Result.Checks | Where-Object { $_.Check -like 'Config:EnvVar:*' })
            $EnvChecks.Count | Should -Be 3

            $NodeEnvCheck = @($EnvChecks | Where-Object { $_.Check -eq 'Config:EnvVar:NODE_ENV' })
            $NodeEnvCheck[0].Pass | Should -Be $true

            $AdminCheck = @($EnvChecks | Where-Object { $_.Check -eq 'Config:EnvVar:ADMIN_USERS' })
            $AdminCheck[0].Pass | Should -Be $false
            $AdminCheck[0].Detail | Should -BeLike 'MISMATCH*'

            $SyncCheck = @($EnvChecks | Where-Object { $_.Check -eq 'Config:EnvVar:GIT_SYNC_ENABLED' })
            $SyncCheck[0].Pass | Should -Be $false
            $SyncCheck[0].Detail | Should -BeLike 'MISSING*'
        }
    }

    Context 'Clean arm — traffic + env vars all pass' {
        BeforeAll {
            Mock -ModuleName AITriad Invoke-RemoteCheck {
                [PSCustomObject]@{ Success = $false; StatusCode = 0; ResponseMs = 0; Error = 'mocked'; Body = $null }
            }
            Mock -ModuleName AITriad az {
                $global:LASTEXITCODE = 0
                $cmd = $args -join ' '
                if ($cmd -like '*containerapp ingress traffic show*') {
                    '[{"revisionName":"rev-abc","weight":100}]'
                }
                elseif ($cmd -like '*containerapp show*') {
                    '{"properties":{"provisioningState":"Succeeded","runningStatus":"Running","template":{"containers":[{"name":"app","env":[{"name":"NODE_ENV","value":"production"},{"name":"HOME","value":"/home/aitriad"}]}]}}}'
                }
                else { '{}' }
            }
        }

        It 'all Config:* checks pass when state matches intent' {
            $Result = Test-AzureHealth -CheckConfig `
                -ExpectedTrafficRevision 'rev-abc' `
                -ExpectedTrafficWeight 100 `
                -ExpectedEnvVars @{ NODE_ENV = 'production'; HOME = '/home/aitriad' } `
                -ConfigRetryCount 1 `
                -ResourceGroup 'rg-test' -AppName 'app-test'

            $ConfigChecks = @($Result.Checks | Where-Object { $_.Check -like 'Config:*' })
            $FailedConfig = @($ConfigChecks | Where-Object { -not $_.Pass })
            $FailedConfig.Count | Should -Be 0
        }
    }

    Context 'Firewall check — fails loud when names omitted' {
        BeforeAll {
            Mock -ModuleName AITriad Invoke-RemoteCheck {
                [PSCustomObject]@{ Success = $false; StatusCode = 0; ResponseMs = 0; Error = 'mocked'; Body = $null }
            }
            Mock -ModuleName AITriad az {
                $global:LASTEXITCODE = 0
                '{}'
            }
        }

        It 'throws ActionableError when -CheckFirewall used without storage/kv names' {
            {
                Test-AzureHealth -CheckConfig -CheckFirewall `
                    -ResourceGroup 'rg-test' -AppName 'app-test'
            } | Should -Throw
        }
    }

    Context 'Firewall check — happy path (t/2431: correct az query paths)' {
        BeforeAll {
            Mock -ModuleName AITriad Invoke-RemoteCheck {
                [PSCustomObject]@{ Success = $false; StatusCode = 0; ResponseMs = 0; Error = 'mocked'; Body = $null }
            }
            Mock -ModuleName AITriad az {
                $global:LASTEXITCODE = 0
                $cmd = $args -join ' '
                if ($cmd -like '*storage account show*') {
                    # az storage account show returns networkRuleSet (not networkAcls) in CLI output
                    'Allow'
                }
                elseif ($cmd -like '*keyvault show*' -and $cmd -like '*publicNetworkAccess*') {
                    'Enabled'
                }
                else { '{}' }
            }
        }

        It 'Config:Firewall:Storage passes when networkRuleSet.defaultAction=Allow' {
            $Result = Test-AzureHealth -CheckConfig -CheckFirewall `
                -StorageAccountName 'st-test' -KeyVaultName 'kv-test' `
                -ConfigRetryCount 1 `
                -ResourceGroup 'rg-test' -AppName 'app-test'

            $StCheck = @($Result.Checks | Where-Object { $_.Check -eq 'Config:Firewall:Storage' })
            $StCheck.Count | Should -Be 1
            $StCheck[0].Pass | Should -Be $true
            $StCheck[0].Detail | Should -BeLike '*networkRuleSet.defaultAction=Allow*'
        }

        It 'Config:Firewall:KeyVault passes when publicNetworkAccess=Enabled' {
            $Result = Test-AzureHealth -CheckConfig -CheckFirewall `
                -StorageAccountName 'st-test' -KeyVaultName 'kv-test' `
                -ConfigRetryCount 1 `
                -ResourceGroup 'rg-test' -AppName 'app-test'

            $KvCheck = @($Result.Checks | Where-Object { $_.Check -eq 'Config:Firewall:KeyVault' })
            $KvCheck.Count | Should -Be 1
            $KvCheck[0].Pass | Should -Be $true
            $KvCheck[0].Detail | Should -BeLike '*publicNetworkAccess=Enabled*'
        }
    }

    Context 'Firewall check — broken arm (t/2431: checks fail on wrong values)' {
        BeforeAll {
            Mock -ModuleName AITriad Invoke-RemoteCheck {
                [PSCustomObject]@{ Success = $false; StatusCode = 0; ResponseMs = 0; Error = 'mocked'; Body = $null }
            }
            Mock -ModuleName AITriad az {
                $global:LASTEXITCODE = 0
                $cmd = $args -join ' '
                if ($cmd -like '*storage account show*') { 'Deny' }
                elseif ($cmd -like '*keyvault show*' -and $cmd -like '*publicNetworkAccess*') { 'Disabled' }
                else { '{}' }
            }
        }

        It 'Config:Firewall:Storage fails when defaultAction=Deny' {
            $Result = Test-AzureHealth -CheckConfig -CheckFirewall `
                -StorageAccountName 'st-test' -KeyVaultName 'kv-test' `
                -ConfigRetryCount 1 `
                -ResourceGroup 'rg-test' -AppName 'app-test'

            $StCheck = @($Result.Checks | Where-Object { $_.Check -eq 'Config:Firewall:Storage' })
            $StCheck[0].Pass | Should -Be $false
            $StCheck[0].Detail | Should -BeLike '*networkRuleSet.defaultAction=Deny*'
        }

        It 'Config:Firewall:KeyVault fails when publicNetworkAccess=Disabled' {
            $Result = Test-AzureHealth -CheckConfig -CheckFirewall `
                -StorageAccountName 'st-test' -KeyVaultName 'kv-test' `
                -ConfigRetryCount 1 `
                -ResourceGroup 'rg-test' -AppName 'app-test'

            $KvCheck = @($Result.Checks | Where-Object { $_.Check -eq 'Config:Firewall:KeyVault' })
            $KvCheck[0].Pass | Should -Be $false
            $KvCheck[0].Detail | Should -BeLike '*publicNetworkAccess=Disabled*'
        }
    }
}
