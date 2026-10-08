# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
Moves PI-tier credentials out of the agent-readable stores into the KeePass-backed
SecretManagement vault AI-Triad-PI, verifies each copy, and only then removes the source
(t/4096; SO consult e/287).

.DESCRIPTION
The PI runs this, not an agent. Sources handled:
  - SecretStore secrets the PowerShell profile loads (vault LocalStore by default);
  - User-scope (registry-persisted) environment variables.

For each name, in order:
  1. Read the value from its source, as a string.
  2. If the name already exists in AI-Triad-PI, verify only and never write (K1:
     Set-Secret silently overwrites). Otherwise Set-Secret it, from memory, as a [string].
  3. Read it back with Get-Secret -AsPlainText and compare as strings, case-sensitive (K2).
     Only "match" or "MISMATCH" is printed, never a value.
  4. Only on a match, and only with -Apply, remove the source: Remove-Secret for a
     SecretStore entry, SetEnvironmentVariable(name, $null, 'User') for an env var.

Without -Apply this is a dry run that touches nothing.

WHERE TO RUN IT (K4). The vault unlocks per PowerShell process. Open a fresh window yourself
with `pwsh -NoProfile`, never one an agent session shares or drives, run the script there,
and close the window afterwards. The script asks once for the master passphrase
(Read-Host -AsSecureString) and unlocks the vault for this process only.

THE PASSPHRASE IS THE WHOLE BOUNDARY (K3). Every agent can read and copy the .kdbx and attack
it offline. So the vault must be registered with UseMasterPassword, with no key file and no
Windows-account key; the script refuses any other registration. Use a long passphrase,
used nowhere else, and never type it into an agent-visible terminal or file.

DON'T LET THE DATABASE SYNC (K5). Documents is OneDrive-redirected on this machine. A .kdbx
under Documents or OneDrive extends the offline-attack surface to anyone with access to that
OneDrive account. Keep it in an unsynced folder (e.g. under %LOCALAPPDATA%) and back it up
deliberately. The script WARNS (does not refuse) when the vault path is under either; syncing
it is then the PI's knowing choice, with the passphrase as the only guard in both places.

ORDER (C1). The profile runs Get-Secret at every shell start, so removing a SecretStore
entry while any profile still loads it breaks every agent shell. The sequence is:
  1. Dry run. It lists every profile file and line that references a planned name.
  2. The PI removes those lines.
  3. -Apply. It REFUSES to run while ANY profile still references a planned SecretStore
     name. Profiles scanned: all four $PROFILE paths, plus every *profile.ps1 in the
     PowerShell 7 and Windows PowerShell 5.1 profile folders under
     [Environment]::GetFolderPath('MyDocuments').
  4. Restart Orca and every agent session; running processes keep the old User-scope values
     until they restart (SO e/285#17).
  5. Decide rotation per credential (rotate, or record the waiver on t/4096), GITHUB-PAT
     first. This script removes credentials from where agents can read them. It does not
     invalidate copies already taken; rotation is what closes the exposure.

CANARY FIRST (C2). Before any real credential, run -Apply once on a throwaway SecretStore
secret and a throwaway User-scope variable (e.g. AITRIAD_CANARY_SS and AITRIAD_CANARY_ENV).
Give the canary a dummy value containing a double quote, a backslash and a newline, so the
KeePass round trip is proven exact (K2). Both must report "match; source removed", the entries
must exist in AI-Triad-PI and the variable must be gone from HKCU. Post the result line on
t/4096 (names and status only), then remove the canary entries. The offline tests stub
SecretManagement, so the canary is the first proof against the real vault.

.EXAMPLE
./operations/devops/Move-PiCredentialToKeePass.ps1 -SecretStoreName GITHUB_OAUTH -UserEnvName GITHUB-PAT
Dry run: shows what would move.

.EXAMPLE
./operations/devops/Move-PiCredentialToKeePass.ps1 -SecretStoreName GITHUB_OAUTH -UserEnvName GITHUB-PAT -Apply
#>
[CmdletBinding()]
param(
    [string[]] $SecretStoreName = @(),
    [string[]] $UserEnvName = @(),
    [string] $SourceVault = 'LocalStore',
    [string] $TargetVault = 'AI-Triad-PI',
    # Profile discovery inputs. Overridable so the tests can point them at temp files.
    [object] $ProfileSet = $PROFILE,
    [string] $DocumentsPath = [Environment]::GetFolderPath('MyDocuments'),
    [switch] $Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ProfileCandidate {
    # Every profile file that exists: the four $PROFILE paths, plus any *profile.ps1 in the
    # PowerShell 7 and Windows PowerShell 5.1 user profile folders (C1, e/287#5 and #6).
    $paths = [Collections.Generic.List[string]]::new()
    $dirs = [Collections.Generic.List[string]]::new()
    if ($null -ne $ProfileSet) {
        foreach ($prop in 'AllUsersAllHosts', 'AllUsersCurrentHost', 'CurrentUserAllHosts', 'CurrentUserCurrentHost') {
            $p = $ProfileSet.PSObject.Properties[$prop]
            if ($p -and $p.Value) { $paths.Add([string] $p.Value) }
        }
        $cuah = $ProfileSet.PSObject.Properties['CurrentUserAllHosts']
        if ($cuah -and $cuah.Value) { $dirs.Add((Split-Path -Parent ([string] $cuah.Value))) }
    }
    if ($DocumentsPath) {
        $dirs.Add((Join-Path $DocumentsPath 'PowerShell'))
        $dirs.Add((Join-Path $DocumentsPath 'WindowsPowerShell'))
    }
    foreach ($d in ($dirs | Select-Object -Unique)) {
        if (Test-Path -LiteralPath $d) {
            Get-ChildItem -LiteralPath $d -Filter '*profile.ps1' -File | ForEach-Object { $paths.Add($_.FullName) }
        }
    }
    @($paths | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { (Resolve-Path -LiteralPath $_).ProviderPath } | Select-Object -Unique)
}

function Get-ProfileReference {
    # File and line numbers only: a profile line could hold a literal value, so text is never echoed.
    param([string[]] $Names)
    if (@($Names).Count -eq 0) { return }
    $pattern = @($Names | ForEach-Object { [regex]::Escape($_) })
    foreach ($f in Get-ProfileCandidate) {
        $lines = @(Select-String -LiteralPath $f -Pattern $pattern | ForEach-Object LineNumber | Sort-Object -Unique)
        if ($lines.Count -gt 0) { [pscustomobject]@{ File = $f; Lines = $lines -join ', ' } }
    }
}

function Assert-KeePassTarget {
    # K3: the passphrase is the only boundary, so only a master-password-only KeePass vault is accepted.
    if ($TargetVault -eq $SourceVault) { throw "Target vault '$TargetVault' is the source vault. Next: pass the KeePass vault as -TargetVault." }
    $v = Get-SecretVault -Name $TargetVault -ErrorAction SilentlyContinue
    if (-not $v) {
        throw "Vault '$TargetVault' is not registered. Next: Register-SecretVault -Name $TargetVault -ModuleName SecretManagement.KeePass -VaultParameters @{ Path = '<unsynced folder>\AI-Triad-PI.kdbx'; UseMasterPassword = `$true }"
    }
    if ($v.ModuleName -ne 'SecretManagement.KeePass') {
        throw "Vault '$TargetVault' is backed by '$($v.ModuleName)', not SecretManagement.KeePass. Refusing."
    }
    $vp = $v.VaultParameters
    if ($null -eq $vp) { $vp = @{} }
    $get = { param($k) if ($vp.ContainsKey($k)) { $vp[$k] } else { $null } }
    if (-not (& $get 'UseMasterPassword')) { throw "Vault '$TargetVault' is not registered with UseMasterPassword. Refusing (K3)." }
    if (& $get 'KeyPath') { throw "Vault '$TargetVault' is registered with a key file (KeyPath). Refusing: the passphrase must be the only key (K3)." }
    if (& $get 'UseWindowsAccount') { throw "Vault '$TargetVault' is registered with UseWindowsAccount. Refusing: the passphrase must be the only key (K3)." }
    $stored = @($vp.Keys | Where-Object { $_ -match 'Password' -and $_ -ne 'UseMasterPassword' })
    if ($stored.Count -gt 0) { throw "Vault '$TargetVault' registration carries '$($stored -join ', ')'. Refusing: no stored password (K3)." }

    # K5: warn, don't refuse, when the database would sync.
    $dbPath = [string] (& $get 'Path')
    if ($dbPath) {
        $full = [IO.Path]::GetFullPath($dbPath)
        foreach ($root in @($DocumentsPath, $env:OneDrive, $env:OneDriveConsumer, $env:OneDriveCommercial)) {
            if (-not $root) { continue }
            $prefix = [IO.Path]::GetFullPath($root).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
            if ($full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
                Write-Warning "The KeePass database is under '$root', which may sync to OneDrive. Anyone with that OneDrive account could attack it offline. Prefer an unsynced folder such as %LOCALAPPDATA% (K5)."
                break
            }
        }
    }
}

function Test-TargetHasName {
    param([string] $Name)
    @(Get-SecretInfo -Vault $TargetVault -Name ([WildcardPattern]::Escape($Name)) -ErrorAction Stop | Where-Object { $_.Name -ceq $Name }).Count -gt 0
}

function Get-SourceValue {
    # Returns the RAW object, never a cast (S1). -AsPlainText unwraps a SecureString to a String but
    # leaves a PSCredential, Hashtable or byte[] as-is; a [string] cast would turn those into their
    # type name, which would then round-trip "equal" and delete the real credential. The caller
    # accepts only [string]. The comma stops a byte[] being unrolled.
    param([string] $Kind, [string] $Name)
    if ($Kind -eq 'SecretStore') { return , (Get-Secret -Vault $SourceVault -Name $Name -AsPlainText -ErrorAction Stop) }
    return [Environment]::GetEnvironmentVariable($Name, 'User')
}

function Get-SourceTypeName {
    # S2: what the dry run shows the PI, from the source vault's own metadata.
    param([string] $Kind, [string] $Name)
    if ($Kind -ne 'SecretStore') { return 'String' }
    $info = @(Get-SecretInfo -Vault $SourceVault -Name ([WildcardPattern]::Escape($Name)) -ErrorAction SilentlyContinue | Where-Object { $_.Name -ceq $Name })
    if ($info.Count -eq 0) { return 'missing' }
    [string] $info[0].Type
}

function ConvertFrom-ReadBack {
    # Read-back unwrap (TL e/287#10, SO #11): some SecretManagement.KeePass versions return a
    # PSCredential for a stored entry, and -AsPlainText does not unwrap it. Any other type is $null,
    # which the caller treats as a MISMATCH.
    param([object] $ReadBack)
    if ($ReadBack -is [string]) { return $ReadBack }
    if ($ReadBack -is [pscredential]) { return $ReadBack.GetNetworkCredential().Password }
    return $null
}

function Remove-SourceValue {
    param([string] $Kind, [string] $Name)
    if ($Kind -eq 'SecretStore') { Remove-Secret -Vault $SourceVault -Name $Name -ErrorAction Stop }
    else { [Environment]::SetEnvironmentVariable($Name, $null, 'User') }
}

# --- Preconditions -------------------------------------------------------------------------
$plan = @(
    @($SecretStoreName | Where-Object { $_ } | ForEach-Object { [pscustomobject]@{ Kind = 'SecretStore'; Name = $_ } })
    @($UserEnvName | Where-Object { $_ } | ForEach-Object { [pscustomobject]@{ Kind = 'UserEnv'; Name = $_ } })
)
if (@($plan).Count -eq 0) { throw 'Name at least one credential with -SecretStoreName or -UserEnvName.' }

Write-Host "Mode: $(if ($Apply) { 'APPLY' } else { 'DRY RUN (no changes)' }). Target vault: $TargetVault"

$allRefs = @(Get-ProfileReference -Names @($plan.Name))
foreach ($r in $allRefs) { Write-Host "Profile references to planned names (remove BEFORE -Apply): $($r.File) line(s) $($r.Lines)" }

# C1: removing a SecretStore entry a profile still loads breaks every agent shell start.
$ssRefs = @(Get-ProfileReference -Names @($plan | Where-Object Kind -eq 'SecretStore' | ForEach-Object Name))
if ($Apply -and $ssRefs.Count -gt 0) {
    $where = ($ssRefs | ForEach-Object { "$($_.File) line(s) $($_.Lines)" }) -join '; '
    throw "Refusing -Apply: a profile still loads planned SecretStore names ($where). Removing those secrets first would break every agent shell's startup. Remove the lines, then re-run (C1)."
}

Assert-KeePassTarget

# K4: unlock once, for this process only. The passphrase never leaves this SecureString.
$pass = Read-Host -AsSecureString "Master passphrase for vault '$TargetVault'"
Unlock-SecretVault -Name $TargetVault -Password $pass -ErrorAction Stop
$pass = $null

$results = foreach ($p in $plan) {
    $status = 'pending'
    $value = $null; $raw = $null; $readBack = $null
    $sourceType = 'unknown'
    try {
        $sourceType = Get-SourceTypeName -Kind $p.Kind -Name $p.Name
        $raw = Get-SourceValue -Kind $p.Kind -Name $p.Name
        if ($null -eq $raw) { $status = 'source empty or missing (skipped)'; continue }
        # S1: only a String moves. Anything else is reported and left exactly where it is.
        if ($raw -isnot [string]) { $status = "unsupported source type $($raw.GetType().Name) (source NOT removed)"; continue }
        $value = $raw
        if ($value.Length -eq 0) { $status = 'source empty or missing (skipped)'; continue }

        $exists = Test-TargetHasName -Name $p.Name

        if (-not $Apply) {
            $status = if ($exists) { 'would verify existing entry (no write), then remove source' } else { 'would copy, verify, then remove source' }
            continue
        }

        # K1: never overwrite an existing entry; verify it instead.
        if (-not $exists) {
            Set-Secret -Vault $TargetVault -Name $p.Name -Secret $value -NoClobber -ErrorAction Stop
        }

        $rbRaw = Get-Secret -Vault $TargetVault -Name $p.Name -AsPlainText -ErrorAction Stop
        $readBack = ConvertFrom-ReadBack -ReadBack $rbRaw
        if ($null -eq $readBack) {
            $rbType = if ($null -eq $rbRaw) { 'null' } else { $rbRaw.GetType().Name }
            $status = "MISMATCH (read-back type $rbType; source NOT removed)"; continue
        }
        if ($readBack -cne $value) { $status = 'MISMATCH (source NOT removed)'; continue }

        Remove-SourceValue -Kind $p.Kind -Name $p.Name
        $status = 'match; source removed'
    } catch {
        $status = "ERROR: $($_.Exception.Message) (source NOT removed)"
    } finally {
        $value = $null; $raw = $null; $rbRaw = $null; $readBack = $null
        [pscustomobject]@{ Name = $p.Name; Source = $p.Kind; SourceType = $sourceType; Result = $status }
    }
}

$results | Format-Table -AutoSize | Out-String | Write-Host

Write-Host ''
if ($Apply) {
    Write-Host 'NEXT (required): close this window. Then restart Orca and every agent session so running processes drop the old User-scope values (SO e/285#17).'
    Write-Host 'THEN: decide rotation per credential on t/4096 (GITHUB-PAT first). Moving a credential does not invalidate copies already taken.'
} else {
    Write-Host 'NEXT: remove any profile lines listed above, then re-run with -Apply. Run the canary first if you have not (see the script header).'
}
