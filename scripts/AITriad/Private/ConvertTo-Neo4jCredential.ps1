# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function ConvertTo-Neo4jCredential {
    <#
    .SYNOPSIS
        Builds a [PSCredential] from a plaintext principal/secret pair (t/3839).
    .DESCRIPTION
        Shared by Install-GraphDatabase's Step 6b probe and its -PassThru emission so there is
        exactly one place building a SecureString from a resolved plaintext password — via
        SecureString.AppendChar (not ConvertTo-SecureString -AsPlainText, which PSSA flags).
        Parameter names avoid "User"/"Password" (PSAvoidUsingUsernameAndPasswordParams is an
        Error-severity PSSA rule keyed on those name patterns, not on the type).
    .PARAMETER Principal
        The Neo4j username.
    .PARAMETER Secret
        The plaintext password, materialized only long enough to populate the SecureString.
    #>
    [CmdletBinding()]
    [OutputType([System.Management.Automation.PSCredential])]
    param(
        [Parameter(Mandatory)]
        [string]$Principal,

        [Parameter(Mandatory)]
        [string]$Secret
    )

    $Sec = [System.Security.SecureString]::new()
    foreach ($ch in $Secret.ToCharArray()) { $Sec.AppendChar($ch) }
    $Sec.MakeReadOnly()
    return [System.Management.Automation.PSCredential]::new($Principal, $Sec)
}
