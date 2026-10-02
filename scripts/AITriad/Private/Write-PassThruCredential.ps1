# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Write-PassThruCredential {
    <#
    .SYNOPSIS
        Emits a credential on the pipeline IFF it authenticates this invocation (t/3839).
    .DESCRIPTION
        Single invariant backing Install-GraphDatabase's -PassThru (SO e/242#2): a credential is
        emitted if and only if it has been authenticated against the running database during THIS
        invocation. The value's meaning must never depend on which caller/code path produced it,
        so every call site uses this one function rather than branch-specific emit logic.

        On an unverified probe, emits nothing and warns (never throws) — a failed credential
        hand-off for -PassThru does not by itself mean the install failed; the paths that call
        this (an already-running/started container) already succeeded at their own job. Opposite
        remedies for 'unauthorized' vs 'unreachable' are named in the warning (SO cond.5, same
        discipline as t/3856).
    .PARAMETER Credential
        The candidate Neo4j credential to authenticate and, if verified, emit.
    #>
    [CmdletBinding()]
    [OutputType([System.Management.Automation.PSCredential])]
    param(
        [Parameter(Mandatory)]
        [PSCredential]$Credential
    )

    $Probe = Test-Neo4jAuthProbe -Credential $Credential
    if ($Probe.Verified) {
        Write-Output $Credential
    } else {
        Write-Warn "-PassThru: no credential emitted ($($Probe.Reason)): $($Probe.Message)"
    }
}
