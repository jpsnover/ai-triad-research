# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-FieldEditShape {
    <#
    .SYNOPSIS
        PURE shape validator for one Save-JsonNodeFieldEdits edit hashtable (t/3877 --
        extracted verbatim from Save-JsonNodeFieldEdits's per-edit validation loop to bring
        that function's complexity back under its complexity-ratchet baseline; no behavior
        change, same checks, same order, same messages).
    .DESCRIPTION
        Checks shape only (required keys, exactly-one-of Field/Path, Remove's mutual
        exclusions) -- never touches disk, never looks up whether the node exists (that
        stays in the caller, which has the existing-ids set).
    .PARAMETER Edit
        One edit hashtable, as documented on Save-JsonNodeFieldEdits.
    .OUTPUTS
        $null when the edit's shape is valid. Otherwise @{ Problem; Steps } naming the
        FIRST violated rule, in the same -NextSteps shape Save-JsonNodeFieldEdits' $fail
        scriptblock expects.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$Edit
    )

    Set-StrictMode -Version Latest

    if (-not $Edit.ContainsKey('NodeId')) {
        return @{
            Problem = "An edit hashtable is missing required key 'NodeId'"
            Steps   = @('Each edit needs NodeId, plus exactly one of Field (depth-1) or Path (nested)')
        }
    }
    # Dispatch-only: exactly one of Field (depth-1) / Path (nested) selects the primitive. One
    # path-walker per mode; this writer never walks paths itself (t/3438, TL steer).
    $hasField = $Edit.ContainsKey('Field')
    $hasPath  = $Edit.ContainsKey('Path')
    $isRemove = [bool]$Edit['Remove']   # absent key → $null → $false
    $isArrayValue = [bool]$Edit['ArrayValue']   # t/3969: Path-only, see below
    if ($hasField -eq $hasPath) {
        return @{
            Problem = 'Each edit must specify EXACTLY ONE of Field (depth-1) or Path (nested-path segment array)'
            Steps   = @('Use @{NodeId;Field;Value} OR @{NodeId;Path=@(...);Value[;Upsert]} OR @{NodeId;Path=@(...);Remove=$true}')
        }
    }
    if ($isArrayValue -and $hasField) {
        return @{
            Problem = 'ArrayValue is Path-only (depth-1 Field edits are always scalar)'
            Steps   = @('Use @{NodeId;Path=@(...);Value=<array>;ArrayValue=$true[;Upsert]}')
        }
    }
    if ($isArrayValue -and $isRemove) {
        return @{
            Problem = 'ArrayValue and Remove are mutually exclusive'
            Steps   = @('-Remove deletes the member; ArrayValue only shapes a written Value')
        }
    }
    if ($isRemove) {
        # t/3460: -Remove deletes the member — Path-only, no Value (ambiguous intent → refuse, cond 2),
        # no Field, not with Upsert.
        if ($hasField) {
            return @{
                Problem = 'A Remove edit must use Path, not Field'
                Steps   = @('Key removal is nested-path only: @{NodeId;Path=@(...);Remove=$true}')
            }
        }
        if ($Edit.ContainsKey('Value')) {
            return @{
                Problem = 'A Remove edit must not carry a Value (ambiguous intent)'
                Steps   = @('Use @{NodeId;Path=@(...);Remove=$true} with no Value')
            }
        }
        if ([bool]$Edit['Upsert']) {
            return @{
                Problem = 'Remove and Upsert are mutually exclusive'
                Steps   = @('Pick exactly one: Upsert-insert or Remove')
            }
        }
    }
    elseif (-not $Edit.ContainsKey('Value')) {
        return @{
            Problem = "An edit hashtable is missing required key 'Value'"
            Steps   = @('Each non-Remove edit needs NodeId + Value, plus exactly one of Field (depth-1) or Path (nested)')
        }
    }
    return $null
}
