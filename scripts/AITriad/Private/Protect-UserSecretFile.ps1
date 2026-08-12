# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Protect-UserSecretFile {
    <#
    .SYNOPSIS
        Restricts a file so only the current user can read it (secret at rest).
    .DESCRIPTION
        Files that persist API keys or other credentials must not be world- or
        group-readable. On Unix this applies `chmod 600` (owner read/write only).
        On Windows it replaces the DACL with a single explicit rule granting the
        current user FullControl and disables inheritance, so other local
        accounts cannot read the persisted secret.

        Best-effort: if the platform ACL/chmod call fails, a warning is emitted
        and the caller continues — hardening failure must not block the write
        that already happened (prefer recovery over failure).
    .PARAMETER Path
        Path to an existing file to lock down.
    .EXAMPLE
        Write-Utf8NoBom -Path $envFile -Value $content -Force
        Protect-UserSecretFile -Path $envFile
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [string]$Path
    )

    Set-StrictMode -Version Latest

    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Warning "Protect-UserSecretFile: path does not exist — $Path"
        return
    }

    try {
        if ($IsWindows) {
            $acl = Get-Acl -LiteralPath $Path
            # Disable inheritance and drop any inherited rules.
            $acl.SetAccessRuleProtection($true, $false)
            # Remove every existing explicit rule so only our rule remains.
            @($acl.Access) | ForEach-Object { [void]$acl.RemoveAccessRule($_) }
            $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
            $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
                $me,
                [System.Security.AccessControl.FileSystemRights]::FullControl,
                [System.Security.AccessControl.AccessControlType]::Allow)
            $acl.AddAccessRule($rule)
            Set-Acl -LiteralPath $Path -AclObject $acl
        }
        else {
            # macOS / Linux — owner rw, no group/other.
            & chmod 600 $Path
            if ($LASTEXITCODE -ne 0) {
                throw "chmod exited $LASTEXITCODE"
            }
        }
    }
    catch {
        Write-Warning "Protect-UserSecretFile: could not restrict permissions on $Path — $($_.Exception.Message). The file may be readable by other local users."
    }
}
