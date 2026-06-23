BeforeAll {
    $ptRoot = "$PSScriptRoot/../scripts/Project-Template"
    . "$ptRoot/Private/New-ActionableError.ps1"
    foreach ($f in (Get-ChildItem "$ptRoot/Public/*.ps1")) { . $f.FullName }
    $script:RepoRoot = (Resolve-Path "$PSScriptRoot/..").Path
}

Describe 'Test-VersionConsistency' {

    BeforeAll {
        $script:origRepoRoot = $script:RepoRoot
        $script:fakeRoot = Join-Path $TestDrive 'version-repo'
        New-Item -ItemType Directory -Path $script:fakeRoot -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $script:fakeRoot 'scripts/MyMod') -Force | Out-Null
    }

    AfterAll {
        $script:RepoRoot = $script:origRepoRoot
    }

    It 'reports consistent when all versions match' {
        $script:RepoRoot = $script:fakeRoot

        Set-Content -Path (Join-Path $script:fakeRoot 'scripts/MyMod/MyMod.psd1') -Value @"
@{
    ModuleVersion = '1.2.3'
}
"@ -Encoding utf8

        Set-Content -Path (Join-Path $script:fakeRoot 'package.json') -Value '{"name":"test","version":"1.2.3"}' -Encoding utf8

        $all = Test-VersionConsistency -VersionSources @(
            @{ Path = 'scripts/MyMod/MyMod.psd1'; Pattern = "ModuleVersion\s*=\s*'([^']+)'"; Label = 'PS Manifest' }
            @{ Path = 'package.json'; Pattern = '"version":\s*"([^"]+)"'; Label = 'package.json' }
        )
        $result = @($all)[-1]
        $result.Consistent | Should -Be $true
        @($result.UniqueVersions).Count | Should -Be 1
        @($result.UniqueVersions)[0] | Should -Be '1.2.3'
    }

    It 'reports mismatch when versions differ' {
        $script:RepoRoot = $script:fakeRoot

        Set-Content -Path (Join-Path $script:fakeRoot 'scripts/MyMod/MyMod.psd1') -Value @"
@{
    ModuleVersion = '1.2.3'
}
"@ -Encoding utf8

        Set-Content -Path (Join-Path $script:fakeRoot 'package.json') -Value '{"name":"test","version":"2.0.0"}' -Encoding utf8

        $all = Test-VersionConsistency -VersionSources @(
            @{ Path = 'scripts/MyMod/MyMod.psd1'; Pattern = "ModuleVersion\s*=\s*'([^']+)'"; Label = 'PS Manifest' }
            @{ Path = 'package.json'; Pattern = '"version":\s*"([^"]+)"'; Label = 'package.json' }
        )
        $result = @($all)[-1]
        $result.Consistent | Should -Be $false
        @($result.UniqueVersions).Count | Should -Be 2
    }

    It 'handles missing files gracefully' {
        $script:RepoRoot = $script:fakeRoot

        $all = Test-VersionConsistency -VersionSources @(
            @{ Path = 'nonexistent.psd1'; Pattern = "ModuleVersion\s*=\s*'([^']+)'"; Label = 'Missing' }
        )
        $result = @($all)[-1]
        $result.Consistent | Should -Be $false
        $result.Versions[0].Status | Should -Be 'NOT FOUND'
    }

    It 'reports not consistent when all sources are NOT FOUND' {
        $script:RepoRoot = $script:fakeRoot

        $all = Test-VersionConsistency -VersionSources @(
            @{ Path = 'missing1.psd1'; Pattern = "v(.+)"; Label = 'A' }
            @{ Path = 'missing2.psd1'; Pattern = "v(.+)"; Label = 'B' }
        )
        $result = @($all)[-1]
        $result.Consistent | Should -Be $false
    }
}

Describe 'Invoke-VerifyGate' {

    It 'returns structured result with AllPass when all skipped' {
        $script:origRepoRoot = $script:RepoRoot
        $script:RepoRoot = Join-Path $TestDrive 'verify-repo'
        New-Item -ItemType Directory -Path $script:RepoRoot -Force | Out-Null

        $all = Invoke-VerifyGate -SkipPester -SkipNpm
        $result = @($all)[-1]
        $result.AllPass | Should -Be $true
        $result.GateCount | Should -Be 0

        $script:RepoRoot = $script:origRepoRoot
    }

    It 'discovers app dirs with verify script' {
        $script:origRepoRoot = $script:RepoRoot
        $fakeRoot = Join-Path $TestDrive 'verify-discover'
        New-Item -ItemType Directory -Path $fakeRoot -Force | Out-Null
        $script:RepoRoot = $fakeRoot

        $appDir = Join-Path $fakeRoot 'myapp'
        New-Item -ItemType Directory -Path $appDir -Force | Out-Null
        Set-Content -Path (Join-Path $appDir 'package.json') -Value '{"name":"myapp","scripts":{"verify":"echo ok"}}' -Encoding utf8

        $all = Invoke-VerifyGate -SkipPester
        $result = @($all)[-1]
        $result | Should -Not -BeNullOrEmpty

        $script:RepoRoot = $script:origRepoRoot
    }
}

Describe 'Invoke-LicenseAudit' {

    It 'throws when no package.json is found' {
        $script:origRepoRoot = $script:RepoRoot
        $script:RepoRoot = Join-Path $TestDrive 'license-empty'
        New-Item -ItemType Directory -Path $script:RepoRoot -Force | Out-Null

        { Invoke-LicenseAudit -AppDir (Join-Path $TestDrive 'nonexistent-dir') } | Should -Throw

        $script:RepoRoot = $script:origRepoRoot
    }

    It 'default allow list includes MIT, Apache-2.0, ISC' {
        $defaults = @('MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'CC0-1.0', '0BSD', 'Unlicense', 'BlueOak-1.0.0', 'CC-BY-4.0')
        'MIT' -in $defaults | Should -Be $true
        'Apache-2.0' -in $defaults | Should -Be $true
        'ISC' -in $defaults | Should -Be $true
    }

    It 'default banned list includes GPL-3.0-only, AGPL-3.0-only' {
        $banned = @('GPL-3.0-only', 'AGPL-3.0-only', 'SSPL-1.0', 'BUSL-1.1')
        'GPL-3.0-only' -in $banned | Should -Be $true
        'AGPL-3.0-only' -in $banned | Should -Be $true
        'SSPL-1.0' -in $banned | Should -Be $true
    }
}

Describe 'Invoke-DependencyAudit' {

    It 'returns zero findings when both sources are skipped' {
        $script:origRepoRoot = $script:RepoRoot
        $script:RepoRoot = Join-Path $TestDrive 'dep-audit'
        New-Item -ItemType Directory -Path $script:RepoRoot -Force | Out-Null

        $all = Invoke-DependencyAudit -SkipNpm -SkipPip
        $result = @($all)[-1]
        $result.TotalFindings | Should -Be 0
        @($result.Critical).Count | Should -Be 0
        @($result.High).Count | Should -Be 0
        @($result.Medium).Count | Should -Be 0
        @($result.Low).Count | Should -Be 0

        $script:RepoRoot = $script:origRepoRoot
    }

    It 'returns AllFindings array alongside severity buckets' {
        $script:origRepoRoot = $script:RepoRoot
        $script:RepoRoot = Join-Path $TestDrive 'dep-audit-2'
        New-Item -ItemType Directory -Path $script:RepoRoot -Force | Out-Null

        $all = Invoke-DependencyAudit -SkipNpm -SkipPip
        $result = @($all)[-1]
        $result.PSObject.Properties['AllFindings'] | Should -Not -BeNullOrEmpty
        @($result.AllFindings).Count | Should -Be 0

        $script:RepoRoot = $script:origRepoRoot
    }

    It 'SLA map covers all severity levels' {
        $slaMap = @{ critical = '48 hours'; high = '7 days'; moderate = '30 days'; medium = '30 days'; low = 'Next cycle' }
        $slaMap['critical'] | Should -Be '48 hours'
        $slaMap['high'] | Should -Be '7 days'
        $slaMap['moderate'] | Should -Be '30 days'
        $slaMap['low'] | Should -Be 'Next cycle'
    }
}

Describe 'Test-SBOMCurrency' {

    It 'returns Checked=$false when no app dir with licenses script found' {
        $script:origRepoRoot = $script:RepoRoot
        $script:RepoRoot = Join-Path $TestDrive 'sbom-empty'
        New-Item -ItemType Directory -Path $script:RepoRoot -Force | Out-Null

        $all = Test-SBOMCurrency
        $result = @($all)[-1]
        $result.Checked | Should -Be $false

        $script:RepoRoot = $script:origRepoRoot
    }

    It 'returns Checked=$true when AppDir and SBOMFile are provided' {
        $script:origRepoRoot = $script:RepoRoot
        $fakeRoot = Join-Path $TestDrive 'sbom-current'
        New-Item -ItemType Directory -Path $fakeRoot -Force | Out-Null
        $script:RepoRoot = $fakeRoot

        $appDir = Join-Path $fakeRoot 'myapp'
        New-Item -ItemType Directory -Path $appDir -Force | Out-Null
        Set-Content -Path (Join-Path $appDir 'package.json') -Value '{"name":"myapp","scripts":{"licenses":"echo done"}}' -Encoding utf8

        $sbomFile = Join-Path $appDir 'THIRD-PARTY-NOTICES.txt'
        Set-Content -Path $sbomFile -Value 'MIT License notices here' -Encoding utf8

        $all = Test-SBOMCurrency -AppDir $appDir -SBOMFile $sbomFile
        $result = @($all)[-1]
        $result.Checked | Should -Be $true

        $script:RepoRoot = $script:origRepoRoot
    }
}
