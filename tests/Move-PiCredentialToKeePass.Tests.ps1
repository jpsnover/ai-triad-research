# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# t/4096 (SO consult e/287): offline tests for the PI-tier KeePass migration. No real vault,
# registry or profile: global stand-ins for the SecretManagement cmdlets and Read-Host record
# every call, and profiles live in a per-test temp folder.

BeforeAll {
    $script:Script = Join-Path $PSScriptRoot '..' 'operations' 'devops' 'Move-PiCredentialToKeePass.ps1'
    # K2: quote, backslash and newline, so an escaping bug would show as a MISMATCH.
    $script:Value = "TESTVALUE-not-real `"q`" back\slash`nline2"

    function Reset-Fake {
        param([hashtable] $VaultParameters = @{ Path = 'X:\unsynced\AI-Triad-PI.kdbx'; UseMasterPassword = $true },
            [string] $ModuleName = 'SecretManagement.KeePass', [hashtable] $Target = @{}, [object] $ReadBackOverride = $null, [bool] $SetThrows = $false,
            [bool] $UnlockThrows = $false, [object[]] $TestVaultResult = @($true))
        $global:Fake = [ordered]@{
            Vault = [pscustomobject]@{ Name = 'AI-Triad-PI'; ModuleName = $ModuleName; VaultParameters = $VaultParameters }
            Source = @{ GITHUB_OAUTH = $script:Value }; Target = $Target
            ReadBackOverride = $ReadBackOverride; SetThrows = $SetThrows
            UnlockThrows = $UnlockThrows; TestVaultResult = $TestVaultResult
            TargetInfoCalls = 0
            Sets = [Collections.Generic.List[object]]::new(); Removed = [Collections.Generic.List[string]]::new()
            Unlocks = [Collections.Generic.List[object]]::new()
        }
    }

    function global:Get-SecretVault { param($Name, $ErrorAction) if ($Name -eq $global:Fake.Vault.Name) { $global:Fake.Vault } }
    function global:Unlock-SecretVault {
        param($Name, $Password, $ErrorAction)
        $global:Fake.Unlocks.Add($Password)
        if ($global:Fake.UnlockThrows) { throw 'The master key is invalid! (test)' }
    }
    function global:Test-SecretVault { param($Name, $ErrorAction) foreach ($r in $global:Fake.TestVaultResult) { $r } }
    function global:Read-Host { param($Prompt, [switch] $AsSecureString) [securestring]::new() }
    function global:Get-SecretInfo {
        param($Vault, $Name, $ErrorAction)
        $n = [WildcardPattern]::Unescape($Name)
        if ($Vault -ne 'LocalStore') { $global:Fake.TargetInfoCalls++ }
        $store = if ($Vault -eq 'LocalStore') { $global:Fake.Source } else { $global:Fake.Target }
        if ($store.ContainsKey($n)) {
            # SecretStore reports a plain-text source as SecureString; other types by their own name.
            $v = $store[$n]
            $type = if ($v -is [string]) { 'SecureString' } elseif ($v -is [pscredential]) { 'PSCredential' } elseif ($v -is [hashtable]) { 'Hashtable' } else { 'ByteArray' }
            [pscustomobject]@{ Name = $n; VaultName = $Vault; Type = $type }
        }
    }
    function global:Get-Secret {
        param($Vault, $Name, [switch] $AsPlainText, $ErrorAction)
        if ($Vault -eq 'LocalStore') { return $global:Fake.Source[$Name] }
        if ($null -ne $global:Fake.ReadBackOverride) { return $global:Fake.ReadBackOverride }
        $global:Fake.Target[$Name]
    }
    function global:Set-Secret {
        param($Vault, $Name, $Secret, [switch] $NoClobber, $ErrorAction)
        if ($global:Fake.SetThrows) { throw 'vault write failed (test)' }
        $global:Fake.Sets.Add([pscustomobject]@{ Vault = $Vault; Name = $Name; Secret = $Secret; NoClobber = [bool] $NoClobber })
        $global:Fake.Target[$Name] = $Secret
    }
    function global:Remove-Secret { param($Vault, $Name, $ErrorAction) $global:Fake.Removed.Add("$Vault/$Name") }

    # A fake user: four $PROFILE paths and a Documents folder, all under one temp root.
    function New-FakeUser {
        $root = Join-Path ([IO.Path]::GetTempPath()) "kp-mig-$([guid]::NewGuid().ToString('N'))"
        $docs = Join-Path $root 'Documents'
        $ps7 = Join-Path $docs 'PowerShell'
        New-Item -ItemType Directory -Path $ps7, (Join-Path $root 'AllUsers') -Force | Out-Null
        [pscustomobject]@{
            Root = $root; Docs = $docs
            Profile = [pscustomobject]@{
                AllUsersAllHosts       = Join-Path $root 'AllUsers' 'profile.ps1'
                AllUsersCurrentHost    = Join-Path $root 'AllUsers' 'Microsoft.PowerShell_profile.ps1'
                CurrentUserAllHosts    = Join-Path $ps7 'profile.ps1'
                CurrentUserCurrentHost = Join-Path $ps7 'Microsoft.PowerShell_profile.ps1'
            }
        }
    }

    $script:RefLine = '$env:GITHUB_OAUTH = Get-Secret -Name GITHUB_OAUTH -AsPlainText'

    function Invoke-Migration {
        # RefIn: a profile property name, 'WinPS51', or empty for clean. ProfileText: custom content
        # for the CurrentUserCurrentHost profile.
        param([switch] $Apply, [string] $RefIn, [string] $ProfileText = "`$env:OTHER = 'x'")
        $u = New-FakeUser
        try {
            Set-Content -LiteralPath $u.Profile.CurrentUserCurrentHost -Value $ProfileText
            if ($RefIn -eq 'WinPS51') {
                $d = Join-Path $u.Docs 'WindowsPowerShell'
                New-Item -ItemType Directory -Path $d -Force | Out-Null
                Set-Content -LiteralPath (Join-Path $d 'Microsoft.PowerShell_profile.ps1') -Value "# x`n$($script:RefLine)"
            } elseif ($RefIn) {
                Set-Content -LiteralPath $u.Profile.$RefIn -Value "# x`n$($script:RefLine)"
            }
            & $script:Script -SecretStoreName GITHUB_OAUTH -ProfileSet $u.Profile -DocumentsPath $u.Docs -Apply:$Apply 3>&1 6>&1 | Out-String
        } finally { Remove-Item -LiteralPath $u.Root -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

AfterAll {
    Remove-Item Function:\global:Get-SecretVault, Function:\global:Unlock-SecretVault, Function:\global:Read-Host,
        Function:\global:Get-SecretInfo, Function:\global:Get-Secret, Function:\global:Set-Secret,
        Function:\global:Remove-Secret, Function:\global:Test-SecretVault -ErrorAction SilentlyContinue
    Remove-Variable -Name Fake -Scope Global -ErrorAction SilentlyContinue
}

Describe 'Move-PiCredentialToKeePass: copy, verify, remove' {
    BeforeEach { Reset-Fake }

    It 'dry run writes nothing and removes nothing' {
        $out = Invoke-Migration
        $out | Should -Match 'DRY RUN'
        $global:Fake.Sets.Count | Should -Be 0
        $global:Fake.Removed.Count | Should -Be 0
    }

    It 'unlocks the target once, with a SecureString (K4)' {
        $null = Invoke-Migration -Apply
        $global:Fake.Unlocks.Count | Should -Be 1
        $global:Fake.Unlocks[0] | Should -BeOfType [securestring]
    }

    It 'K2: writes the exact value as a [string], with -NoClobber, to AI-Triad-PI' {
        $null = Invoke-Migration -Apply
        $global:Fake.Sets.Count | Should -Be 1
        $s = $global:Fake.Sets[0]
        $s.Vault | Should -Be 'AI-Triad-PI'
        $s.Secret | Should -BeOfType [string]
        $s.Secret | Should -BeExactly $script:Value
        $s.NoClobber | Should -BeTrue
    }

    It 'removes the source only after a match' {
        $out = Invoke-Migration -Apply
        $out | Should -Match 'match; source removed'
        $global:Fake.Removed | Should -Contain 'LocalStore/GITHUB_OAUTH'
    }

    It 'K2: a case-only difference is a MISMATCH and keeps the source (negative arm)' {
        Reset-Fake -ReadBackOverride $script:Value.ToUpperInvariant()
        $out = Invoke-Migration -Apply
        $out | Should -Match 'MISMATCH'
        $global:Fake.Removed.Count | Should -Be 0
    }

    It 'a failed write keeps the source' {
        Reset-Fake -SetThrows $true
        $out = Invoke-Migration -Apply
        $out | Should -Match 'source NOT removed'
        $global:Fake.Removed.Count | Should -Be 0
    }

    It 'K1: an existing entry is verified, never written' {
        Reset-Fake -Target @{ GITHUB_OAUTH = $script:Value }
        $null = Invoke-Migration -Apply
        $global:Fake.Sets.Count | Should -Be 0
        $global:Fake.Removed | Should -Contain 'LocalStore/GITHUB_OAUTH'
    }

    It 'K1: an existing entry with a different value is a MISMATCH, not an overwrite' {
        Reset-Fake -Target @{ GITHUB_OAUTH = 'older-value' }
        $out = Invoke-Migration -Apply
        $global:Fake.Sets.Count | Should -Be 0
        $global:Fake.Removed.Count | Should -Be 0
        $out | Should -Match 'MISMATCH'
    }

    It 'never prints the value, in either mode' {
        (Invoke-Migration) | Should -Not -BeLike '*TESTVALUE*'
        Reset-Fake
        (Invoke-Migration -Apply) | Should -Not -BeLike '*TESTVALUE*'
    }
}

Describe 'Move-PiCredentialToKeePass: source types (S1-S3) and read-back unwrap' {
    BeforeAll {
        function New-TestCredential([string] $Pw) { [pscredential]::new('user', (ConvertTo-SecureString $Pw -AsPlainText -Force)) }
    }
    BeforeEach { Reset-Fake }

    It 'S3: a String source proceeds' {
        $out = Invoke-Migration -Apply
        $out | Should -Match 'match; source removed'
        $global:Fake.Sets.Count | Should -Be 1
    }

    It 'S1/S3: a <Kind> source is skipped: nothing written, nothing removed' -ForEach @(
        @{ Kind = 'PSCredential' }
        @{ Kind = 'Hashtable' }
        @{ Kind = 'byte[]' }
    ) {
        $global:Fake.Source.GITHUB_OAUTH = switch ($Kind) {
            'PSCredential' { New-TestCredential 'TESTVALUE-cred' }
            'Hashtable'    { @{ a = 'TESTVALUE-ht' } }
            'byte[]'       { , [byte[]] (1, 2, 3) }
        }
        $out = Invoke-Migration -Apply
        $out | Should -Match 'unsupported source type'
        $out | Should -Match 'source NOT removed'
        $global:Fake.Sets.Count | Should -Be 0
        $global:Fake.Removed.Count | Should -Be 0
    }

    It 'S2: the dry run reports each SecretStore entry''s type' {
        $global:Fake.Source.GITHUB_OAUTH = New-TestCredential 'TESTVALUE-cred'
        $out = Invoke-Migration
        $out | Should -Match 'PSCredential'
        $out | Should -Match 'unsupported source type'
        Reset-Fake
        (Invoke-Migration) | Should -Match 'SecureString'
    }

    It 'read-back: a PSCredential whose password matches is a match' {
        Reset-Fake -ReadBackOverride (New-TestCredential $script:Value)
        $out = Invoke-Migration -Apply
        $out | Should -Match 'match; source removed'
        $global:Fake.Removed | Should -Contain 'LocalStore/GITHUB_OAUTH'
    }

    It 'read-back: a PSCredential whose password differs is a MISMATCH (negative arm)' {
        Reset-Fake -ReadBackOverride (New-TestCredential 'something-else')
        $out = Invoke-Migration -Apply
        $out | Should -Match 'MISMATCH'
        $global:Fake.Removed.Count | Should -Be 0
    }

    It 'read-back: any other type is a MISMATCH' {
        Reset-Fake -ReadBackOverride @{ v = $script:Value }
        $out = Invoke-Migration -Apply
        $out | Should -Match 'MISMATCH \(read-back type Hashtable'
        $global:Fake.Removed.Count | Should -Be 0
    }
}

Describe 'Move-PiCredentialToKeePass: C1 profile order' {
    BeforeEach { Reset-Fake }

    It 'dry run reports file and line numbers, not profile text' {
        $out = Invoke-Migration -RefIn CurrentUserCurrentHost
        $out | Should -Match 'Microsoft\.PowerShell_profile\.ps1 line\(s\) 2'
        $out | Should -Not -Match 'Get-Secret -Name GITHUB_OAUTH'
    }

    It 'C1: -Apply is refused when <RefIn> references a planned name, before the vault is touched' -ForEach @(
        @{ RefIn = 'CurrentUserCurrentHost' }
        @{ RefIn = 'CurrentUserAllHosts' }      # the gap e/287#5 named
        @{ RefIn = 'AllUsersAllHosts' }
        @{ RefIn = 'AllUsersCurrentHost' }
        @{ RefIn = 'WinPS51' }                  # Windows PowerShell 5.1 folder, e/287#6
    ) {
        { Invoke-Migration -Apply -RefIn $RefIn } | Should -Throw '*Refusing -Apply*line(s) 2*'
        $global:Fake.Unlocks.Count | Should -Be 0
        $global:Fake.Sets.Count | Should -Be 0
        $global:Fake.Removed.Count | Should -Be 0
    }

    It 'C1: -Apply proceeds once no profile references the name' {
        $out = Invoke-Migration -Apply
        $out | Should -Match 'match; source removed'
    }
}

Describe 'Move-PiCredentialToKeePass: whole-token profile match (e/287#15, #16)' {
    BeforeEach { Reset-Fake }

    It 'does not flag a longer name that merely starts with a planned name' {
        $text = "`$env:GITHUB_OAUTH_CLIENT_ID = 'x'"
        (Invoke-Migration -ProfileText $text) | Should -Not -Match 'Profile references'
        (Invoke-Migration -Apply -ProfileText $text) | Should -Match 'match; source removed'
    }

    It 'flags a names-array line even when Get-Secret is on a different line' {
        $text = "`$names = 'GITHUB_OAUTH', 'OTHER'`nforeach (`$n in `$names) { Set-Item env:`$n (Get-Secret -Name `$n -AsPlainText) }"
        { Invoke-Migration -Apply -ProfileText $text } | Should -Throw '*Refusing -Apply*line(s) 1*'
        $global:Fake.Removed.Count | Should -Be 0
    }

    It 'flags a direct Get-Secret line, case-insensitively' {
        { Invoke-Migration -Apply -ProfileText "`$env:x = Get-Secret -Name github_oauth -AsPlainText" } | Should -Throw '*Refusing -Apply*'
    }
}

Describe 'Move-PiCredentialToKeePass: vault must open before any per-name work (e/287#15)' {
    It 'stops when <Case>: zero rows, zero writes, zero removes (<Mode>)' -ForEach @(
        @{ Case = 'the unlock throws';            Mode = 'dry run'; Apply = $false; Throws = $true;  Tv = @($true) }
        @{ Case = 'the unlock throws';            Mode = 'apply';   Apply = $true;  Throws = $true;  Tv = @($true) }
        @{ Case = 'Test-SecretVault is false';    Mode = 'dry run'; Apply = $false; Throws = $false; Tv = @($false) }
        @{ Case = 'Test-SecretVault is false';    Mode = 'apply';   Apply = $true;  Throws = $false; Tv = @($false) }
        @{ Case = 'Test-SecretVault is mixed';    Mode = 'apply';   Apply = $true;  Throws = $false; Tv = @($true, $false) }
        @{ Case = 'Test-SecretVault says nothing'; Mode = 'apply';  Apply = $true;  Throws = $false; Tv = @() }
    ) {
        Reset-Fake -UnlockThrows $Throws -TestVaultResult $Tv
        { Invoke-Migration -Apply:$Apply } | Should -Throw '*Could not open vault*Nothing was read, written or removed*'
        $global:Fake.TargetInfoCalls | Should -Be 0
        $global:Fake.Sets.Count | Should -Be 0
        $global:Fake.Removed.Count | Should -Be 0
    }
}

Describe 'Move-PiCredentialToKeePass: K3 vault guard' {
    It 'refuses <Case>, before unlocking' -ForEach @(
        @{ Case = 'a non-KeePass vault';       Mod = 'Microsoft.PowerShell.SecretStore'; Vp = @{ UseMasterPassword = $true };                              Msg = '*not SecretManagement.KeePass*' }
        @{ Case = 'no UseMasterPassword';      Mod = 'SecretManagement.KeePass';         Vp = @{ Path = 'X:\a.kdbx' };                                    Msg = '*UseMasterPassword*' }
        @{ Case = 'a key file';                Mod = 'SecretManagement.KeePass';         Vp = @{ UseMasterPassword = $true; KeyPath = 'X:\a.key' };       Msg = '*key file*' }
        @{ Case = 'a Windows-account key';     Mod = 'SecretManagement.KeePass';         Vp = @{ UseMasterPassword = $true; UseWindowsAccount = $true };  Msg = '*UseWindowsAccount*' }
        @{ Case = 'a stored password';         Mod = 'SecretManagement.KeePass';         Vp = @{ UseMasterPassword = $true; MasterPassword = 'x' };       Msg = '*no stored password*' }
    ) {
        Reset-Fake -ModuleName $Mod -VaultParameters $Vp
        { Invoke-Migration -Apply } | Should -Throw $Msg
        $global:Fake.Unlocks.Count | Should -Be 0
        $global:Fake.Sets.Count | Should -Be 0
    }

    It 'refuses an unregistered vault' {
        Reset-Fake
        $global:Fake.Vault.Name = 'something-else'
        { Invoke-Migration -Apply } | Should -Throw '*not registered*'
    }
}

Describe 'Move-PiCredentialToKeePass: K5 sync warning' {
    It 'warns, but proceeds, when the database is under Documents' {
        Reset-Fake
        $u = New-FakeUser
        try {
            $global:Fake.Vault.VaultParameters = @{ Path = (Join-Path $u.Docs 'AI-Triad-PI.kdbx'); UseMasterPassword = $true }
            $out = & $script:Script -SecretStoreName GITHUB_OAUTH -ProfileSet $u.Profile -DocumentsPath $u.Docs -Apply 3>&1 6>&1 | Out-String
        } finally { Remove-Item -LiteralPath $u.Root -Recurse -Force -ErrorAction SilentlyContinue }
        $out | Should -Match 'may sync to OneDrive'
        $out | Should -Match 'match; source removed'
    }

    It 'does not warn for an unsynced path' {
        Reset-Fake
        (Invoke-Migration -Apply) | Should -Not -Match 'may sync to OneDrive'
    }
}
