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

ORDER (SO e/287#2, C1). The profile runs Get-Secret at every shell start, so removing a
SecretStore entry while the profile still loads it breaks every agent shell. The sequence is:
  1. Dry run. It lists the profile line numbers that reference the planned names.
  2. The PI removes those lines from the profile.
  3. -Apply. It REFUSES to run while the profile still references any SecretStore name in
     the plan.
  4. Restart Orca and every agent session; running processes keep the old User-scope values
     until they restart (SO e/285#17).
  5. Decide rotation per credential (rotate, or record the waiver on t/4096), GITHUB-PAT
     first. This script removes credentials from where agents can read them; it does not
     invalidate copies already taken. Rotation is what closes the exposure.

CANARY FIRST (SO e/287#2, C2). Before any real credential, run -Apply once on a throwaway
SecretStore secret and a throwaway User-scope variable (e.g. AITRIAD_CANARY_SS and
AITRIAD_CANARY_ENV with dummy values). Both must report "match; source removed", the items
must exist in 1Password and the variable must be gone from HKCU. Post the result line on
t/4096 (names and status only), then delete the canary items. The offline tests stub op, so
the canary is the first proof that the real CLI accepts this template and read-back path.

RESIDUAL (SO e/287#2, C3; accepted). The template file holds the value in plaintext for about
the length of one `op item create` call. Its folder is user-only, and Remove-Item is not a
secure delete, so the bytes may survive in freed disk blocks. Accepted because every value
moved here is already in every agent process's environment today, so a seconds-long file adds
close to no exposure. If the PI's op version accepts the template on stdin, prefer that and
drop the file.

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

# Profile lines that still reference a planned name. Line numbers only: a profile line could
# hold a literal value, so its text is never echoed.
function Get-ProfileReferenceLine {
    param([string[]] $Names)
    if (@($Names).Count -eq 0 -or -not (Test-Path -LiteralPath $ProfilePath)) { return @() }
    @(Select-String -LiteralPath $ProfilePath -Pattern ($Names | ForEach-Object { [regex]::Escape($_) }) |
        ForEach-Object LineNumber | Sort-Object -Unique)
}

$allRefs = @(Get-ProfileReferenceLine -Names @($plan.Name))
if ($allRefs.Count -gt 0) {
    Write-Host "Profile lines referencing these names (remove them BEFORE -Apply): $($allRefs -join ', ') in $ProfilePath"
}

# C1: removing a SecretStore entry the profile still loads breaks every agent shell start.
$ssRefs = @(Get-ProfileReferenceLine -Names @($plan | Where-Object Kind -eq 'SecretStore' | ForEach-Object Name))
if ($Apply -and $ssRefs.Count -gt 0) {
    throw "Refusing -Apply: the profile still loads planned SecretStore names at line(s) $($ssRefs -join ', ') of $ProfilePath. Removing those secrets first would break every agent shell's startup. Remove the lines, then re-run (SO e/287#2, C1)."
}

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

Write-Host ''
if ($Apply) {
    Write-Host 'NEXT (required): restart Orca and every agent session so running processes drop the old User-scope values (SO e/285#17).'
    Write-Host 'THEN: decide rotation per credential on t/4096 (GITHUB-PAT first). Moving a credential does not invalidate copies already taken.'
} else {
    Write-Host 'NEXT: remove any profile lines listed above, then re-run with -Apply. Run the canary first if you have not (see the script header).'
}
