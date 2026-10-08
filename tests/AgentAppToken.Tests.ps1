# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# t/4096 Decision A: offline tests for the agent App token helper. No network, no vault:
# a throwaway RSA key is generated per run, so no real App key is ever needed here.

BeforeAll {
    . (Join-Path $PSScriptRoot '..' 'operations' 'devops' 'AgentAppToken.ps1')

    function ConvertFrom-Base64Url([string] $s) {
        $p = $s.Replace('-', '+').Replace('_', '/')
        switch ($p.Length % 4) { 2 { $p += '==' } 3 { $p += '=' } }
        [Convert]::FromBase64String($p)
    }

    $script:rsa = [Security.Cryptography.RSA]::Create(2048)
    $script:pem = $script:rsa.ExportRSAPrivateKeyPem()
    $script:now = [datetimeoffset]::new(2026, 10, 8, 12, 0, 0, [timespan]::Zero)
}

AfterAll { $script:rsa.Dispose() }

Describe 'New-GitHubAppJwt (t/4096)' {
    It 'produces three base64url segments with no padding' {
        $jwt = New-GitHubAppJwt -AppId 5236159 -PrivateKeyPem $script:pem -Now $script:now
        $parts = $jwt.Split('.')
        $parts.Count | Should -Be 3
        $jwt | Should -Not -Match '[=+/]'
    }

    It 'declares RS256 in the header' {
        $jwt = New-GitHubAppJwt -AppId 5236159 -PrivateKeyPem $script:pem -Now $script:now
        $h = [Text.Encoding]::UTF8.GetString((ConvertFrom-Base64Url $jwt.Split('.')[0])) | ConvertFrom-Json
        $h.alg | Should -Be 'RS256'
        $h.typ | Should -Be 'JWT'
    }

    It 'sets iss to the App ID and backdates iat 60s with exp within GitHub''s 10-minute limit' {
        $jwt = New-GitHubAppJwt -AppId 5236159 -PrivateKeyPem $script:pem -Now $script:now
        $p = [Text.Encoding]::UTF8.GetString((ConvertFrom-Base64Url $jwt.Split('.')[1])) | ConvertFrom-Json
        $p.iss | Should -Be '5236159'
        $p.iat | Should -Be ($script:now.ToUnixTimeSeconds() - 60)
        ($p.exp - $p.iat) | Should -BeLessOrEqual 600
        $p.exp | Should -BeGreaterThan $script:now.ToUnixTimeSeconds()
    }

    It 'has a signature that verifies with the matching public key' {
        $jwt = New-GitHubAppJwt -AppId 5236159 -PrivateKeyPem $script:pem -Now $script:now
        $parts = $jwt.Split('.')
        $data = [Text.Encoding]::UTF8.GetBytes("$($parts[0]).$($parts[1])")
        $sig = ConvertFrom-Base64Url $parts[2]
        $script:rsa.VerifyData($data, $sig, [Security.Cryptography.HashAlgorithmName]::SHA256,
            [Security.Cryptography.RSASignaturePadding]::Pkcs1) | Should -BeTrue
    }

    It 'does NOT verify against a different key (negative arm)' {
        $jwt = New-GitHubAppJwt -AppId 5236159 -PrivateKeyPem $script:pem -Now $script:now
        $parts = $jwt.Split('.')
        $other = [Security.Cryptography.RSA]::Create(2048)
        try {
            $other.VerifyData([Text.Encoding]::UTF8.GetBytes("$($parts[0]).$($parts[1])"), (ConvertFrom-Base64Url $parts[2]),
                [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1) | Should -BeFalse
        } finally { $other.Dispose() }
    }

    It 'throws on a malformed key rather than producing an unsigned token' {
        { New-GitHubAppJwt -AppId 1 -PrivateKeyPem 'not a pem' -Now $script:now } | Should -Throw
    }
}

Describe 'Get-AgentAppToken vault handling (t/4096)' {
    It 'rejects an unknown role' {
        { Get-AgentAppToken -Role 'admin' } | Should -Throw
    }

    It 'fails with an actionable message when the vault or secret is missing, and never calls GitHub' {
        Mock Get-Secret { throw 'Vault not found in registry: AiTriadAgentApps' }
        Mock Invoke-RestMethod { throw 'must not be called' }
        { Get-AgentAppToken -Role reviewer } | Should -Throw '*ai-triad-reviewer-key*'
        Should -Invoke Invoke-RestMethod -Times 0
    }

    It 'with -AsPlainText, posts to the reviewer installation and returns only the token' {
        Mock Get-Secret { $script:pem }
        Mock Invoke-RestMethod { [pscustomobject]@{ token = 'ghs_TESTONLY'; expires_at = '2026-10-08T13:00:00Z' } }
        Get-AgentAppToken -Role reviewer -AsPlainText | Should -Be 'ghs_TESTONLY'
        Should -Invoke Invoke-RestMethod -Times 1 -ParameterFilter {
            $Uri -eq 'https://api.github.com/app/installations/169212097/access_tokens' -and $Method -eq 'Post'
        }
    }

    It 'C2: without -AsPlainText, writes nothing token-shaped to the output stream' {
        Mock Get-Secret { $script:pem }
        Mock Invoke-RestMethod { [pscustomobject]@{ token = 'ghs_TESTONLY'; expires_at = '2026-10-08T13:00:00Z' } }
        $out = Get-AgentAppToken -Role reviewer
        $out | Should -BeOfType [securestring]
        ($out | Out-String) | Should -Not -Match 'ghs_'
    }

    It 'C3: the request body names exactly one repository (default ai-triad-research) and the role''s permissions' {
        Mock Get-Secret { $script:pem }
        Mock Invoke-RestMethod { [pscustomobject]@{ token = 'ghs_TESTONLY' } }
        $null = Get-AgentAppToken -Role reviewer -AsPlainText
        Should -Invoke Invoke-RestMethod -Times 1 -ParameterFilter {
            $b = $Body | ConvertFrom-Json
            @($b.repositories).Count -eq 1 -and $b.repositories[0] -eq 'ai-triad-research' -and
            $b.permissions.pull_requests -eq 'write' -and $b.permissions.contents -eq 'read' -and
            -not ($b.permissions.PSObject.Properties.Name -contains 'workflows')
        }
    }

    It 'C3: ai-triad-data must be named explicitly and is the only repository in the body' {
        Mock Get-Secret { $script:pem }
        Mock Invoke-RestMethod { [pscustomobject]@{ token = 'ghs_TESTONLY' } }
        $null = Get-AgentAppToken -Role author -Repository ai-triad-data -AsPlainText
        Should -Invoke Invoke-RestMethod -Times 1 -ParameterFilter {
            $b = $Body | ConvertFrom-Json
            @($b.repositories).Count -eq 1 -and $b.repositories[0] -eq 'ai-triad-data'
        }
    }

    It 'C3: rejects a repository outside the installed pair' {
        { Get-AgentAppToken -Role author -Repository 'some-other-repo' -AsPlainText } | Should -Throw
    }
}

Describe 'Invoke-AsAgentApp (t/4096)' {
    It 'sets GH_TOKEN only inside the block and restores the previous value afterwards' {
        Mock New-AgentAppInstallationToken { 'ghs_SCOPED' }
        Mock Invoke-RestMethod { }
        $before = $env:GH_TOKEN
        $seen = Invoke-AsAgentApp -Role reviewer -ScriptBlock { $env:GH_TOKEN }
        $seen | Should -Be 'ghs_SCOPED'
        $env:GH_TOKEN | Should -Be $before
    }

    It 'restores GH_TOKEN even when the block throws' {
        Mock New-AgentAppInstallationToken { 'ghs_SCOPED' }
        Mock Invoke-RestMethod { }
        $before = $env:GH_TOKEN
        { Invoke-AsAgentApp -Role reviewer -ScriptBlock { throw 'boom' } } | Should -Throw 'boom'
        $env:GH_TOKEN | Should -Be $before
    }

    It 'C4: revokes the token when the block ends, with that token' {
        Mock New-AgentAppInstallationToken { 'ghs_SCOPED' }
        Mock Invoke-RestMethod { }
        Invoke-AsAgentApp -Role reviewer -ScriptBlock { 'work' } | Out-Null
        Should -Invoke Invoke-RestMethod -Times 1 -ParameterFilter {
            $Method -eq 'Delete' -and $Uri -eq 'https://api.github.com/installation/token' -and $Headers.Authorization -eq 'Bearer ghs_SCOPED'
        }
    }

    It 'C4: revokes even when the block throws' {
        Mock New-AgentAppInstallationToken { 'ghs_SCOPED' }
        Mock Invoke-RestMethod { }
        { Invoke-AsAgentApp -Role reviewer -ScriptBlock { throw 'boom' } } | Should -Throw 'boom'
        Should -Invoke Invoke-RestMethod -Times 1 -ParameterFilter { $Method -eq 'Delete' }
    }

    It 'C4: a failed revoke warns but does not fail the caller''s work' {
        Mock New-AgentAppInstallationToken { 'ghs_SCOPED' }
        Mock Invoke-RestMethod { throw 'network down' }
        Mock Write-Warning { }
        $r = Invoke-AsAgentApp -Role reviewer -ScriptBlock { 'done' }
        $r | Should -Be 'done'
        Should -Invoke Write-Warning -Times 1 -ParameterFilter { $Message -like '*could not revoke*' }
    }
}
