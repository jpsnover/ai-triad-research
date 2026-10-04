# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Find-JsonRemoveParentContainer {
    <#
    .SYNOPSIS
        Remove-JsonNodePathMember sub-helper (t/3878 decomposition, extracted
        verbatim): descend Path[0..last-1] to the PARENT container.
    .DESCRIPTION
        Navigation only -- no create; a missing intermediate fails closed, same
        as replace/-Upsert. Distinct copy of the descend logic from
        Update-JsonNodePath's main loop (kept separate per t/3878's
        characterisation, not merged -- see that function's own notes).
    .PARAMETER RawText
        The raw JSON text.
    .PARAMETER Path
        The full segment-array path; only Path[0..Count-2] (all but the final
        segment) is walked here.
    .PARAMETER Fail
        The caller's fail scriptblock.
    .PARAMETER CurStart
        Start index of the node object's span (the starting container).
    .PARAMETER CurEnd
        End index of the node object's span.
    .OUTPUTS
        [PSCustomObject] { Start; End } -- the parent container's span after
        descending every intermediate segment.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)][string]$RawText,
        [Parameter(Mandatory)][object[]]$Path,
        [Parameter(Mandatory)][scriptblock]$Fail,
        [Parameter(Mandatory)][int]$CurStart,
        [Parameter(Mandatory)][int]$CurEnd
    )

    Set-StrictMode -Version Latest
    $fail = $Fail

    for ($k = 0; $k -lt $Path.Count - 1; $k++) {
        $seg = $Path[$k]
        $curChar = $RawText[$CurStart]
        if ($seg -is [int]) {
            if ($curChar -ne '[') { & $fail "segment [$seg] expects an array but the container at that level is not an array" @('Check the path matches the document shape') }
            $vStart = Find-JsonArrayElementStart -Text $RawText -ArrStart $CurStart -ArrEnd $CurEnd -Index $seg
            if ($vStart -lt 0) { & $fail "array index [$seg] is out of range (path-not-found)" @('Verify the intermediate index exists') }
        }
        else {
            if ($curChar -ne '{') { & $fail "segment '$seg' expects an object but the container at that level is not an object" @('Check the path matches the document shape') }
            $vStart = Find-JsonMemberValueStart -Text $RawText -ObjStart $CurStart -ObjEnd $CurEnd -Key ([string]$seg)
            if ($vStart -lt 0) { & $fail "key '$seg' not found at this level (path-not-found)" @('Verify the intermediate path exists; -Remove does not create structure') }
        }
        $vSpan = Get-JsonValueSpan -Text $RawText -Start $vStart
        if ($null -eq $vSpan) { & $fail "could not span-scan the value at segment '$seg'" @('Report with the input file + path') }
        $CurStart = $vSpan.Start; $CurEnd = $vSpan.End
    }

    return [PSCustomObject]@{ Start = $CurStart; End = $CurEnd }
}
