#Requires -Modules Pester
<#
.SYNOPSIS
    Tests for Get-BicepBaseEnv.ps1 -NamesOnly switch (t/3345).

    Verifies TL condition (3): -NamesOnly must be a superset of the hashtable keys
    AND must cover every name: entry in the fixture bicep (including non-literal keys).
#>

Describe 'Get-BicepBaseEnv -NamesOnly' {
    BeforeAll {
        $scriptRoot  = Split-Path $PSScriptRoot -Parent
        $getEnvScript = Join-Path $scriptRoot 'operations/devops/Get-BicepBaseEnv.ps1'
        $bicepFixture = Join-Path $PSScriptRoot 'fixtures/bicep-env-drift/good-main.bicep'
    }

    It 'Returns all names including non-literal keys (interpolated, resource-ref, param-ref)' {
        $names = & $getEnvScript -BicepPath $bicepFixture -NamesOnly
        # Literal keys
        $names | Should -Contain 'NODE_ENV'
        $names | Should -Contain 'HOME'
        $names | Should -Contain 'WEBSITE_AUTH_ENABLED'
        # Non-literal keys that the standard (hashtable) pass skips
        $names | Should -Contain 'ALLOWED_ORIGINS'       # interpolated value
        $names | Should -Contain 'AZURE_KEYVAULT_URL'    # resource property reference
        $names | Should -Contain 'ADMIN_USERS'           # parameter reference
    }

    It 'Is a superset of the hashtable keys returned by the standard pass' {
        $hashtable = & $getEnvScript -BicepPath $bicepFixture
        $names     = & $getEnvScript -BicepPath $bicepFixture -NamesOnly
        foreach ($key in $hashtable.Keys) {
            $names | Should -Contain $key -Because "-NamesOnly must include every literal key"
        }
    }

    It 'Returns more names than the hashtable (has at least one non-literal key)' {
        $hashtable = & $getEnvScript -BicepPath $bicepFixture
        $names     = & $getEnvScript -BicepPath $bicepFixture -NamesOnly
        $names.Count | Should -BeGreaterThan $hashtable.Count
    }

    It 'Returns a string array (not a hashtable)' {
        $names = & $getEnvScript -BicepPath $bicepFixture -NamesOnly
        $names | Should -BeOfType [string]
    }

    It 'Contains no duplicates' {
        $names  = & $getEnvScript -BicepPath $bicepFixture -NamesOnly
        $unique = $names | Sort-Object -Unique
        $unique.Count | Should -Be $names.Count
    }
}
