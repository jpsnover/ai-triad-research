# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# SSOT reader for lib/oped/outlets.json (t/3863, t/3819 child C). Dot-sourced by
# AITriad.psm1 — do NOT export.
#
# t/3819#3 Condition 4: fail CLOSED. The precedent this epic is modeled on
# (Test-AIModelId / ai-models.json, Private/AIModelValidation.ps1) is fail-OPEN —
# "Config not loaded — accept anything rather than blocking." That is the exact
# dangerous arm Condition 4 describes; this file deliberately does the opposite.
# On any failure (missing file, parse failure, schema violation) every function
# here THROWS rather than returning an empty/degraded value, and the thrown
# message is New-ActionableError-shaped so it survives into the
# ParameterBindingValidationException New-OpEd's dynamic ValidateSet produces —
# empirically confirmed (t/3863#1) that a thrown message propagates intact
# through a class's GetValidValues() into the binding exception's .Message.
#
# t/3819#3 Condition 5: caching. Measured, not assumed (t/3863#1) — PowerShell
# does NOT cache an IValidateSetValuesGenerator's result; GetValidValues() is
# re-invoked on every parameter-binding attempt, so a mid-session edit to
# outlets.json takes effect on the very next call. No caching is implemented
# here either, for the same reason: the file is tiny and consistency with the
# measured generator behavior matters more than saving a reread.
#
# IMPLEMENTATION NOTE: the generator is Add-Type C#, not a PowerShell `class`.
# Measured directly (t/3863#1): a PS class defined in this Private file is NOT
# a resolvable [TypeName] from New-OpEd.ps1 (a separate dot-sourced Public
# file) when referenced in a [ValidateSet(...)] attribute argument — the
# attribute's type-literal resolves at PARSE time, and PowerShell's parser
# does not share script-class type visibility across independently-dot-sourced
# files the way module-scoped functions/variables are shared. Get-Command
# silently returned a CommandInfo with a null Parameters collection rather than
# erroring loudly, which would have made this a much harder defect to notice
# downstream. Add-Type registers a REAL .NET type in the AppDomain, globally
# resolvable regardless of dot-sourcing order.

function Get-OpEdOutletsData {
    <#
    .SYNOPSIS
        Reads and schema-validates lib/oped/outlets.json (t/3863). Throws on any failure.
    .DESCRIPTION
        Single reader for the outlet-definitions SSOT, used by both the dynamic
        -Outlet ValidateSet generator and New-OpEd's own body — one failure mode,
        proven once. Validates the raw JSON against outlets.schema.json via
        Test-Json before parsing, so a structurally malformed file (missing
        required keys, wrong types) is caught here rather than surfacing as a
        confusing property-access error later.
    .OUTPUTS
        The parsed outlets.json as a PSCustomObject ({ defaultOutlet, styleDefaults, outlets }).
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param()

    Set-StrictMode -Version Latest

    $OutletsPath = Join-Path $script:RepoRoot 'lib/oped/outlets.json'
    $SchemaPath  = Join-Path $script:RepoRoot 'lib/oped/outlets.schema.json'

    if (-not (Test-Path $OutletsPath)) {
        throw (New-ActionableError -PassThru `
                -Goal 'Load the outlet definitions SSOT' `
                -Problem "outlets.json not found at $OutletsPath" `
                -Location 'Get-OpEdOutletsData' `
                -NextSteps @(
                    'Confirm lib/oped/outlets.json exists in the repo (t/3861)',
                    'Run from a full checkout; the SSOT ships with the code repo'
                ))
    }

    $Raw = Get-Content -Raw -Path $OutletsPath -Encoding UTF8

    try {
        $null = Test-Json -Json $Raw -SchemaFile $SchemaPath -ErrorAction Stop
    } catch {
        throw (New-ActionableError -PassThru `
                -Goal 'Load the outlet definitions SSOT' `
                -Problem "outlets.json at $OutletsPath failed schema validation: $($_.Exception.Message)" `
                -Location 'Get-OpEdOutletsData' `
                -NextSteps @(
                    "Validate $OutletsPath against $SchemaPath and fix the reported violation",
                    'Check for a recent hand-edit — the schema requires every outlet to carry words + guidance, and styleDefaults to carry all 6 prose fields + readability'
                ))
    }

    try {
        return ($Raw | ConvertFrom-Json)
    } catch {
        throw (New-ActionableError -PassThru `
                -Goal 'Load the outlet definitions SSOT' `
                -Problem "outlets.json at $OutletsPath is not valid JSON: $($_.Exception.Message)" `
                -Location 'Get-OpEdOutletsData' `
                -NextSteps "Validate $OutletsPath as JSON and fix the reported parse failure.")
    }
}

function Get-OpEdOutletKeys {
    <#
    .SYNOPSIS
        Returns the SSOT's outlet keys, for the dynamic -Outlet ValidateSet (t/3863).
    .DESCRIPTION
        Thin wrapper over Get-OpEdOutletsData — deliberately no try/catch here.
        A load/validation failure propagates as-is, so GetValidValues() throws the
        same ActionableError-shaped message rather than returning an empty set
        (which would reject every -Outlet value but with no explanation).
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param()

    Set-StrictMode -Version Latest

    return @((Get-OpEdOutletsData).outlets.PSObject.Properties.Name)
}

# The type [ValidateSet()] binds to (see IMPLEMENTATION NOTE above for why this
# is Add-Type C# rather than a PowerShell `class`). GetValidValues() calls back
# into the CURRENT runspace via PowerShell.Create(RunspaceMode.CurrentRunspace)
# so it sees this module's own (non-exported) Get-OpEdOutletKeys function and
# $script:RepoRoot — confirmed empirically (t/3863#1), including that a thrown
# ActionableError-shaped message survives through .Streams.Error[0].Exception
# into the ParameterBindingValidationException PowerShell wraps it in. Guarded
# against re-registration: AITriad.psm1 may be Import-Module -Force'd multiple
# times in one session (every test file does this), and Add-Type throws if the
# same type name is defined twice in one AppDomain.
if (-not ([System.Management.Automation.PSTypeName]'OutletsSsotValuesGenerator').Type) {
    Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Management.Automation;

public class OutletsSsotValuesGenerator : IValidateSetValuesGenerator
{
    public string[] GetValidValues()
    {
        using (var ps = PowerShell.Create(RunspaceMode.CurrentRunspace))
        {
            ps.AddCommand("Get-OpEdOutletKeys");
            var results = ps.Invoke<string>();
            if (ps.HadErrors)
            {
                var err = ps.Streams.Error[0];
                throw new Exception(err.Exception.Message, err.Exception);
            }
            var keys = new List<string>();
            foreach (var r in results) { keys.Add(r); }
            return keys.ToArray();
        }
    }
}
'@
}
