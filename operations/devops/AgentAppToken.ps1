# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# t/4096 Decision A: per-role GitHub App identities for agents.
#
# Mints a short-lived (1 hour) GitHub App installation token for one agent role, so agent
# actions are attributable to an App instead of the PI's own jpsnover account.
#
# SECURITY CONTRACT (t/3918 context):
#   - The App private key is read from the SecretManagement vault at call time and never
#     written to disk, logged, or put in an environment variable.
#   - The minted token is RETURNED to the caller only. Callers pass it to a single command
#     (bash: GH_TOKEN="$(...)" gh ...; pwsh: Invoke-AsAgentApp) and let it go out of scope.
#     Never persist it in a file, a profile, or a lasting environment variable.
#   - Installation tokens expire after 1 hour; mint a fresh one per session or task.
#
# Usage:
#   . ./operations/devops/AgentAppToken.ps1
#   $t = Get-AgentAppToken -Role reviewer
#   Invoke-AsAgentApp -Role reviewer -ScriptBlock { gh pr review 123 --approve --body '...' }

# App and installation IDs are not secret (t/4096#10). Gate Co-Location: they live here,
# at the point of use.
$script:AgentApps = @{
    author     = @{ AppId = 5236085; InstallationId = 169210396; Slug = 'ai-triad-author-jpsnover' }
    reviewer   = @{ AppId = 5236159; InstallationId = 169212097; Slug = 'ai-triad-reviewer-jpsnover' }
    maintainer = @{ AppId = 5236199; InstallationId = 169213604; Slug = 'ai-triad-maintainer-jpsnover' }
}
$script:AgentAppVault = 'AiTriadAgentApps'

function ConvertTo-Base64Url {
    [CmdletBinding()]
    param([Parameter(Mandatory)][byte[]] $Bytes)
    [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function New-GitHubAppJwt {
    <#
    .SYNOPSIS
    PURE (no I/O). Builds the RS256-signed JWT a GitHub App uses to authenticate as itself.
    .DESCRIPTION
    iat is backdated 60s for clock skew; exp is 9 minutes out (GitHub's maximum is 10).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][long] $AppId,
        [Parameter(Mandatory)][string] $PrivateKeyPem,
        [datetimeoffset] $Now = [datetimeoffset]::UtcNow
    )
    $header  = @{ alg = 'RS256'; typ = 'JWT' } | ConvertTo-Json -Compress
    $payload = [ordered]@{
        iat = $Now.AddSeconds(-60).ToUnixTimeSeconds()
        exp = $Now.AddSeconds(540).ToUnixTimeSeconds()
        iss = "$AppId"
    } | ConvertTo-Json -Compress
    $enc = [Text.Encoding]::UTF8
    $signingInput = '{0}.{1}' -f (ConvertTo-Base64Url $enc.GetBytes($header)), (ConvertTo-Base64Url $enc.GetBytes($payload))
    $rsa = [Security.Cryptography.RSA]::Create()
    try {
        $rsa.ImportFromPem($PrivateKeyPem)
        $sig = $rsa.SignData($enc.GetBytes($signingInput), [Security.Cryptography.HashAlgorithmName]::SHA256,
            [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    } finally {
        $rsa.Dispose()
    }
    '{0}.{1}' -f $signingInput, (ConvertTo-Base64Url $sig)
}

function Get-AgentAppToken {
    <#
    .SYNOPSIS
    Returns a 1-hour installation token for the given agent role. Never persists it.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateSet('author', 'reviewer', 'maintainer')][string] $Role,
        [string] $Vault = $script:AgentAppVault
    )
    $ErrorActionPreference = 'Stop'
    $app = $script:AgentApps[$Role]
    $secretName = "ai-triad-$Role-key"
    try {
        $pem = Get-Secret -Vault $Vault -Name $secretName -AsPlainText
    } catch {
        throw (New-AgentAppTokenError -Problem "Could not read secret '$secretName' from vault '$Vault': $($_.Exception.Message)" `
            -NextSteps "Confirm the vault is registered (Get-SecretVault) and holds $secretName (Get-SecretInfo -Vault $Vault). The PI stores the keys (t/4096#10).")
    }
    $jwt = New-GitHubAppJwt -AppId $app.AppId -PrivateKeyPem $pem
    $pem = $null
    $uri = "https://api.github.com/app/installations/$($app.InstallationId)/access_tokens"
    $headers = @{ Authorization = "Bearer $jwt"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
    try {
        $resp = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers
    } catch {
        throw (New-AgentAppTokenError -Problem "GitHub refused to mint an installation token for $($app.Slug): $($_.Exception.Message)" `
            -NextSteps 'Check the App ID and Installation ID match the installed App, and that the private key is the current one for that App.')
    }
    $resp.token
}

function Invoke-AsAgentApp {
    <#
    .SYNOPSIS
    Runs a script block with GH_TOKEN set to a fresh token for the role, then restores the
    previous value, so the token never outlives the block.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateSet('author', 'reviewer', 'maintainer')][string] $Role,
        [Parameter(Mandatory)][scriptblock] $ScriptBlock
    )
    $previous = $env:GH_TOKEN
    try {
        $env:GH_TOKEN = Get-AgentAppToken -Role $Role
        & $ScriptBlock
    } finally {
        $env:GH_TOKEN = $previous
    }
}

function New-AgentAppTokenError {
    param([string] $Problem, [string] $NextSteps)
    $cmd = Get-Command New-ActionableError -ErrorAction SilentlyContinue
    if ($cmd) {
        return (New-ActionableError -Goal 'Mint a GitHub App installation token for an agent role (t/4096)' `
            -Problem $Problem -Location 'operations/devops/AgentAppToken.ps1' -NextSteps $NextSteps)
    }
    "Goal: Mint a GitHub App installation token for an agent role (t/4096)`nError: $Problem`nLocation: operations/devops/AgentAppToken.ps1`nResolve: $NextSteps"
}
