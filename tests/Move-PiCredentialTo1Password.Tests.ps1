# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# t/4096#19: offline tests for the PI-tier 1Password migration. No real op, vault or registry:
# global stand-ins for op / Get-Secret / Remove-Secret record every call so the tests can prove
# the value never reaches a command line and the source is removed only after a verified match.

BeforeAll {
    $script:Script = Join-Path $PSScriptRoot '..' 'operations' 'devops' 'Move-PiCredentialTo1Password.ps1'
    $script:Value = 'TESTVALUE-not-a-real-credential-7f3a'

    function Reset-Fake {
        param([string] $ReadBack = $script:Value, [bool] $ItemExists = $false, [int] $CreateExit = 0)
        $global:FakeOp = [ordered]@{
            Calls = [Collections.Generic.List[string[]]]::new(); TemplateText = $null
            ReadBack = $ReadBack; ItemExists = $ItemExists; CreateExit = $CreateExit
            Store = @{ GITHUB_OAUTH = $script:Value }; Removed = [Collections.Generic.List[string]]::new()
        }
    }

    function global:op {
        $a = [string[]] $args
        $global:FakeOp.Calls.Add($a)
        $global:LASTEXITCODE = 0
        switch ($a[0]) {
            'vault' { return '{}' }
            'item' {
                if ($a[1] -eq 'get') { if (-not $global:FakeOp.ItemExists) { $global:LASTEXITCODE = 1 }; return }
                if ($a[1] -eq 'create') {
                    $tpl = $a[[array]::IndexOf($a, '--template') + 1]
                    $global:FakeOp.TemplateText = Get-Content -LiteralPath $tpl -Raw
                    $global:FakeOp.TemplatePath = $tpl
                    $global:LASTEXITCODE = $global:FakeOp.CreateExit
                    return '{}'
                }
            }
            'read' { return $global:FakeOp.ReadBack }
        }
    }
    function global:Get-Secret { param($Vault, $Name, [switch] $AsPlainText, $ErrorAction) $global:FakeOp.Store[$Name] }
    function global:Remove-Secret { param($Vault, $Name, $ErrorAction) $global:FakeOp.Removed.Add($Name) }

    $script:ProfileWithRef = "`$env:OTHER = 'x'`n`$env:GITHUB_OAUTH = Get-Secret -Name GITHUB_OAUTH -AsPlainText"
    $script:ProfileClean = "`$env:OTHER = 'x'"

    # Apply runs default to a profile with the reference already removed: that is the order C1 enforces.
    function Invoke-Migration([switch] $Apply, [string] $ProfileText) {
        if (-not $PSBoundParameters.ContainsKey('ProfileText')) { $ProfileText = if ($Apply) { $script:ProfileClean } else { $script:ProfileWithRef } }
        $prof = Join-Path ([IO.Path]::GetTempPath()) "fake-profile-$([guid]::NewGuid().ToString('N')).ps1"
        Set-Content -LiteralPath $prof -Value $ProfileText
        try {
            & $script:Script -SecretStoreName GITHUB_OAUTH -ProfilePath $prof -Apply:$Apply 6>&1 | Out-String
        } finally { Remove-Item -LiteralPath $prof -ErrorAction SilentlyContinue }
    }
}

AfterAll {
    Remove-Item Function:\global:op, Function:\global:Get-Secret, Function:\global:Remove-Secret -ErrorAction SilentlyContinue
    Remove-Variable -Name FakeOp -Scope Global -ErrorAction SilentlyContinue
}

Describe 'Move-PiCredentialTo1Password (t/4096#19)' {
    BeforeEach { Reset-Fake; $env:OP_SERVICE_ACCOUNT_TOKEN = $null }

    It 'dry run changes nothing: no create, no read-back, no source removal' {
        $out = Invoke-Migration
        $out | Should -Match 'DRY RUN'
        @($global:FakeOp.Calls | Where-Object { $_[0] -eq 'item' -and $_[1] -eq 'create' }).Count | Should -Be 0
        @($global:FakeOp.Calls | Where-Object { $_[0] -eq 'read' }).Count | Should -Be 0
        $global:FakeOp.Removed.Count | Should -Be 0
    }

    It 'apply: never passes the value as a command-line argument to op' {
        $null = Invoke-Migration -Apply
        foreach ($c in $global:FakeOp.Calls) { ($c -join ' ') | Should -Not -BeLike "*$($script:Value)*" }
    }

    It 'apply: the value travels in the template, and the template file is deleted afterwards' {
        $null = Invoke-Migration -Apply
        $global:FakeOp.TemplateText | Should -BeLike "*$($script:Value)*"
        ($global:FakeOp.TemplateText | ConvertFrom-Json).category | Should -Be 'API_CREDENTIAL'
        Test-Path -LiteralPath $global:FakeOp.TemplatePath | Should -BeFalse
    }

    It 'apply: reads back from op://AI-Triad-PI/<name>/credential and removes the source on a match' {
        $out = Invoke-Migration -Apply
        @($global:FakeOp.Calls | Where-Object { $_[0] -eq 'read' -and $_ -contains 'op://AI-Triad-PI/GITHUB_OAUTH/credential' }).Count | Should -Be 1
        $global:FakeOp.Removed | Should -Contain 'GITHUB_OAUTH'
        $out | Should -Match 'match; source removed'
    }

    It 'apply: a MISMATCH keeps the source (negative arm)' {
        Reset-Fake -ReadBack 'something-else'
        $out = Invoke-Migration -Apply
        $global:FakeOp.Removed.Count | Should -Be 0
        $out | Should -Match 'MISMATCH'
    }

    It 'apply: a failed create keeps the source and does not read back' {
        Reset-Fake -CreateExit 1
        $out = Invoke-Migration -Apply
        $global:FakeOp.Removed.Count | Should -Be 0
        @($global:FakeOp.Calls | Where-Object { $_[0] -eq 'read' }).Count | Should -Be 0
        $out | Should -Match 'source NOT removed'
    }

    It 'apply: an existing item is verified, not overwritten' {
        Reset-Fake -ItemExists $true
        $null = Invoke-Migration -Apply
        @($global:FakeOp.Calls | Where-Object { $_[0] -eq 'item' -and $_[1] -eq 'create' }).Count | Should -Be 0
        $global:FakeOp.Removed | Should -Contain 'GITHUB_OAUTH'
    }

    It 'never prints the value, in either mode' {
        (Invoke-Migration) | Should -Not -BeLike "*$($script:Value)*"
        Reset-Fake
        (Invoke-Migration -Apply) | Should -Not -BeLike "*$($script:Value)*"
    }

    It 'dry run reports profile line numbers, not profile text' {
        $out = Invoke-Migration
        $out | Should -Match 'remove them BEFORE -Apply\): 2 in '
        $out | Should -Not -Match 'Get-Secret -Name GITHUB_OAUTH'
    }

    It 'C1: -Apply is refused while the profile still loads a planned SecretStore name, and touches nothing' {
        { Invoke-Migration -Apply -ProfileText $script:ProfileWithRef } | Should -Throw '*Refusing -Apply*line(s) 2*'
        $global:FakeOp.Calls.Count | Should -Be 0
        $global:FakeOp.Removed.Count | Should -Be 0
    }

    It 'C1: -Apply proceeds once the referencing line is gone' {
        $out = Invoke-Migration -Apply -ProfileText $script:ProfileClean
        $out | Should -Match 'match; source removed'
        $global:FakeOp.Removed | Should -Contain 'GITHUB_OAUTH'
    }

    It 'refuses to run under a 1Password service account token' {
        $env:OP_SERVICE_ACCOUNT_TOKEN = 'placeholder'
        try { { Invoke-Migration -Apply } | Should -Throw '*service account*' }
        finally { $env:OP_SERVICE_ACCOUNT_TOKEN = $null }
        $global:FakeOp.Calls.Count | Should -Be 0
    }
}
