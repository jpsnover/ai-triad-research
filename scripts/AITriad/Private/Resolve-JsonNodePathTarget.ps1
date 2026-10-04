# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Resolve-JsonNodePathTarget {
    <#
    .SYNOPSIS
        Update-JsonNodePath's shared replace/-Upsert descend loop, extracted as
        part of its t/3878 decomposition -- no behavior change. Descends the
        full Path, or (under -Upsert, on a missing key) delegates to
        New-JsonNodePathContainer and returns that result as a terminal
        action.
    .DESCRIPTION
        Two outcomes, distinguished by the Handled field:
          - Handled = $true: the -Upsert insert path fired and already
            produced (or threw on) the final patched text -- the caller must
            return Patched immediately, with no further work.
          - Handled = $false: every segment resolved to an existing value --
            the caller continues with the returned Start/End (the FINAL
            segment's value span) into its own scalar-replace + verify step.
    .PARAMETER RawText
        The original raw JSON text.
    .PARAMETER NodeId
        The node id being edited.
    .PARAMETER Path
        The full segment-array path.
    .PARAMETER PathDisplay
        Pre-rendered display form of Path, for error messages.
    .PARAMETER Value
        The scalar value (passed through to Insert-JsonNodePathContainer if
        the insert path fires).
    .PARAMETER Upsert
        Whether -Upsert was passed (enables the insert-on-missing-key path).
    .PARAMETER Fail
        The caller's fail scriptblock.
    .PARAMETER CurStart
        Start index of the node object's span (the starting container).
    .PARAMETER CurEnd
        End index of the node object's span.
    .PARAMETER DeferVerify
        Passed through to Insert-JsonNodePathContainer.
    .OUTPUTS
        [PSCustomObject] { Handled; Patched } or { Handled; Start; End }.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)][string]$RawText,
        [Parameter(Mandatory)][string]$NodeId,
        [Parameter(Mandatory)][object[]]$Path,
        [Parameter(Mandatory)][string]$PathDisplay,
        [AllowNull()]$Value,
        [switch]$Upsert,
        [Parameter(Mandatory)][scriptblock]$Fail,
        [Parameter(Mandatory)][int]$CurStart,
        [Parameter(Mandatory)][int]$CurEnd,
        [switch]$DeferVerify
    )

    Set-StrictMode -Version Latest
    $fail = $Fail

    for ($k = 0; $k -lt $Path.Count; $k++) {
        $seg = $Path[$k]
        $curChar = $RawText[$CurStart]
        if ($seg -is [int]) {
            if ($curChar -ne '[') { & $fail "segment [$seg] expects an array but the container at that level is not an array" @('Check the path matches the document shape') }
            $vStart = Find-JsonArrayElementStart -Text $RawText -ArrStart $CurStart -ArrEnd $CurEnd -Index $seg
            if ($vStart -lt 0) { & $fail "array index [$seg] is out of range (path-not-found)" @('Verify the index exists; no insert-at-depth in this phase (t/2921 Q2)') }
        }
        else {
            if ($curChar -ne '{') { & $fail "segment '$seg' expects an object but the container at that level is not an object" @('Check the path matches the document shape') }
            $vStart = Find-JsonMemberValueStart -Text $RawText -ObjStart $CurStart -ObjEnd $CurEnd -Key ([string]$seg)
            if ($vStart -lt 0) {
                if (-not $Upsert) { & $fail "key '$seg' not found at this level (path-not-found)" @('Verify the key exists, or pass -Upsert to create it') }
                $patched = New-JsonNodePathContainer -RawText $RawText -NodeId $NodeId -Path $Path -PathDisplay $PathDisplay `
                    -K $k -Seg $seg -Value $Value -Fail $fail -CurStart $CurStart -CurEnd $CurEnd -DeferVerify:$DeferVerify
                return [PSCustomObject]@{ Handled = $true; Patched = $patched }
            }
        }
        $vSpan = Get-JsonValueSpan -Text $RawText -Start $vStart
        if ($null -eq $vSpan) { & $fail "could not span-scan the value at segment '$seg'" @('Report with the input file + path') }
        $CurStart = $vSpan.Start; $CurEnd = $vSpan.End
    }

    return [PSCustomObject]@{ Handled = $false; Start = $CurStart; End = $CurEnd }
}
