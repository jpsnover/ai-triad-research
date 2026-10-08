# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
Moves PI-tier credentials out of the agent-readable stores into the 1Password vault
AI-Triad-PI, verifies each copy, and only then removes the source (t/4096#16, #19).

.DESCRIPTION
The PI runs this, not an agent: every `op` call needs the PI's Windows Hello or password
approval through 1Password desktop-app integration. A prompt the PI didn't trigger is a
detection signal; deny it and report it (t/4096#19).

Sources handled:
  - SecretStore secrets the PowerShell profile loads (vault LocalStore by default).
  - User-scope (registry-persisted) environment variables.

For each name, in order:
  1. Read the value from its source.
  2. Create a 1Password "API Credential" item titled with the name, in vault AI-Triad-PI.
     The value NEVER appears on a command line: it goes into a JSON template file in a
     user-only temp folder, which is deleted in a finally block straight after the call.
  3. Read it back with `op read op://AI-Triad-PI/<name>/credential` and compare inside the
     script. Only "match" or "MISMATCH" is printed, never a value.
  4. Only on a match, and only with -Apply, remove the source: Remove-Secret for a
     SecretStore entry, SetEnvironmentVariable(name, $null, 'User') for an env var.

Without -Apply this is a dry run that reports the plan and touches nothing.

AFTER -Apply, the PI must still:
  - remove the moved names from the PowerShell profile (this script lists the lines);
  - restart Orca and every agent session, because running processes keep the old
    User-scope values until they restart (SO e/285#17);
  - decide rotation per credential (rotate, or record the waiver on t/4096).

No 1Password service account and no OP_SERVICE_ACCOUNT_TOKEN may be used for these items
(t/4096#19): a service account reads unattended, which defeats the point. The script
refuses to run if OP_SERVICE_ACCOUNT_TOKEN is set.

.EXAMPLE
./operations/devops/Move-PiCredentialTo1Password.ps1 -SecretStoreName GITHUB_OAUTH -UserEnvName GITHUB-PAT
Dry run: shows what would move.

.EXAMPLE
./operations/devops/Move-PiCredentialTo1Password.ps1 -SecretStoreName GITHUB_OAUTH -UserEnvName GITHUB-PAT -Apply
#>
[CmdletBinding()]
param(
    [string[]] $SecretStoreName = @(),
    [string[]] $UserEnvName = @(),
    [string] $SourceVault = 'LocalStore',
    [string] $OpVault = 'AI-Triad-PI',
    [string] $ProfilePath = $PROFILE.CurrentUserCurrentHost,
    [switch] $Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-OpItemTemplateJson {
    # PURE: the JSON body for `op item create --template`. The value only ever lives in memory
    # and in the short-lived template file, never in argv.
    param([Parameter(Mandatory)][string] $Title, [Parameter(Mandatory)][string] $Value, [string] $Note)
    @{
        title    = $Title
        category = 'API_CREDENTIAL'
        fields   = @(
            @{ id = 'credential'; type = 'CONCEALED'; label = 'credential'; value = $Value }
            @{ id = 'notesPlain'; type = 'STRING'; purpose = 'NOTES'; label = 'notesPlain'; value = $Note }
        )
    } | ConvertTo-Json -Depth 5 -Compress
}

function Invoke-WithPrivateTempFile {
    # Writes $Content to a file in a fresh temp folder readable only by the current user,
    # runs $ScriptBlock with its path, and always deletes the folder.
    param([Parameter(Mandatory)][string] $Content, [Parameter(Mandatory)][scriptblock] $ScriptBlock)
    $dir = Join-Path ([IO.Path]::GetTempPath()) ("op-tpl-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir | Out-Null
    try {
        if ($IsWindows) {
            $acl = New-Object Security.AccessControl.DirectorySecurity
            $acl.SetAccessRuleProtection($true, $false)
            $me = [Security.Principal.WindowsIdentity]::GetCurrent().User
            $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($me, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
            Set-Acl -Path $dir -AclObject $acl
        } else {
            & chmod 700 $dir
        }
        $file = Join-Path $dir 'item.json'
        [IO.File]::WriteAllText($file, $Content)
        & $ScriptBlock $file
    } finally {
        Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Get-SourceValue {
    param([string] $Kind, [string] $Name)
    if ($Kind -eq 'SecretStore') { return (Get-Secret -Vault $SourceVault -Name $Name -AsPlainText -ErrorAction Stop) }
    return [Environment]::GetEnvironmentVariable($Name, 'User')
}

function Remove-SourceValue {
    param([string] $Kind, [string] $Name)
    if ($Kind -eq 'SecretStore') { Remove-Secret -Vault $SourceVault -Name $Name -ErrorAction Stop }
    else { [Environment]::SetEnvironmentVariable($Name, $null, 'User') }
}

# --- Preconditions -------------------------------------------------------------------------
if ($env:OP_SERVICE_ACCOUNT_TOKEN) {
    throw 'OP_SERVICE_ACCOUNT_TOKEN is set. PI-tier items must not be handled by a 1Password service account (t/4096#19). Unset it and run interactively.'
}
if (-not (Get-Command op -ErrorAction SilentlyContinue)) {
    throw 'The 1Password CLI (op) is not on PATH. Install it, enable "Integrate with 1Password CLI" in the desktop app, then re-run.'
}
$plan = @(
    @($SecretStoreName | Where-Object { $_ } | ForEach-Object { [pscustomobject]@{ Kind = 'SecretStore'; Name = $_ } })
    @($UserEnvName | Where-Object { $_ } | ForEach-Object { [pscustomobject]@{ Kind = 'UserEnv'; Name = $_ } })
)
if (@($plan).Count -eq 0) { throw 'Name at least one credential with -SecretStoreName or -UserEnvName.' }

Write-Host "Mode: $(if ($Apply) { 'APPLY' } else { 'DRY RUN (no changes)' }). Target vault: $OpVault"

# Fails here, before anything moves, if the vault is missing or access isn't approved.
$null = & op vault get $OpVault --format json
if ($LASTEXITCODE -ne 0) { throw "op could not open vault '$OpVault'. Create it in 1Password and approve CLI access, then re-run." }

$results = foreach ($p in $plan) {
    $status = 'pending'
    try {
        $value = Get-SourceValue -Kind $p.Kind -Name $p.Name
        if ([string]::IsNullOrEmpty($value)) { $status = 'source empty or missing (skipped)'; continue }

        $null = & op item get $p.Name --vault $OpVault --format json 2>$null
        $exists = ($LASTEXITCODE -eq 0)

        if (-not $Apply) {
            $status = if ($exists) { 'would verify existing 1Password item, then remove source' } else { 'would copy, verify, then remove source' }
            continue
        }

        if (-not $exists) {
            $json = New-OpItemTemplateJson -Title $p.Name -Value $value -Note "Moved from $($p.Kind) by Move-PiCredentialTo1Password.ps1 (t/4096) on $(Get-Date -Format o)."
            Invoke-WithPrivateTempFile -Content $json -ScriptBlock {
                param($file)
                $null = & op item create --vault $OpVault --template $file --format json
                if ($LASTEXITCODE -ne 0) { throw "op item create failed for $($p.Name)." }
            }
        }

        $readBack = (@(& op read --no-newline "op://$OpVault/$($p.Name)/credential") -join "`n")
        if ($LASTEXITCODE -ne 0 -or $readBack -cne $value) { $status = 'MISMATCH (source NOT removed)'; continue }

        Remove-SourceValue -Kind $p.Kind -Name $p.Name
        $status = 'match; source removed'
    } catch {
        $status = "ERROR: $($_.Exception.Message) (source NOT removed)"
    } finally {
        $value = $null; $readBack = $null
        [pscustomobject]@{ Name = $p.Name; Source = $p.Kind; Result = $status }
    }
}

$results | Format-Table -AutoSize | Out-String | Write-Host

# Profile lines that still reference a moved name: the PI removes these by hand.
if (Test-Path -LiteralPath $ProfilePath) {
    $names = @($plan.Name)
    $lines = @(Select-String -LiteralPath $ProfilePath -Pattern ($names | ForEach-Object { [regex]::Escape($_) }))
    if ($lines.Count -gt 0) {
        # Line numbers only: a profile line could hold a literal value, so its text is never echoed.
        Write-Host "Profile lines still referencing these names (remove them by hand): $(($lines.LineNumber | Sort-Object -Unique) -join ', ') in $ProfilePath"
    }
}

if ($Apply) {
    Write-Host ''
    Write-Host 'NEXT (required): restart Orca and every agent session so running processes drop the old User-scope values (SO e/285#17).'
    Write-Host 'THEN: decide rotation per credential on t/4096 (GITHUB-PAT first).'
}
