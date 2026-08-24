# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# ── Shared internals for the field-surgical JSON writers (t/2916 / t/2921) ────
# Both surgical entry points share these (TL ruling t/2921#2 Q3 — factor shared
# internals; keep the two callers separate):
#   * Update-JsonNodeField  (t/2916)  — depth-1 scalar field, incl. absent-key INSERT.
#   * Update-JsonNodePath   (t/2921)  — in-place scalar replacement at a NESTED path.
# The load-bearing safety net is the re-parse-VERIFY invariant (Test-JsonSemanticEqual
# over ConvertTo-CanonicalForm): after any splice we re-parse and assert the result equals
# the original with EXACTLY the intended change, else the caller throws and writes nothing.
# That is what makes byte-surgery safe regardless of splice edge cases.

function ConvertTo-CanonicalForm {
    # Recursively normalize a ConvertFrom-Json value into order-insensitive canonical
    # form (sorted hashtable keys) so the verify compares DATA, not key order/formatting.
    param([Parameter(Mandatory)][AllowNull()]$Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [System.Management.Automation.PSCustomObject]) {
        $out = [ordered]@{}
        foreach ($p in ($Value.PSObject.Properties | Sort-Object Name)) {
            $out[$p.Name] = ConvertTo-CanonicalForm -Value $p.Value
        }
        return $out
    }
    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
        return @($Value | ForEach-Object { ConvertTo-CanonicalForm -Value $_ })
    }
    return $Value
}

function Test-JsonSemanticEqual {
    param([Parameter(Mandatory)][AllowNull()]$A, [Parameter(Mandatory)][AllowNull()]$B)
    $ca = ConvertTo-CanonicalForm -Value $A | ConvertTo-Json -Depth 100 -Compress
    $cb = ConvertTo-CanonicalForm -Value $B | ConvertTo-Json -Depth 100 -Compress
    return $ca -eq $cb
}

function Find-JsonObjectSpan {
    # Single-pass, string/escape-aware forward scan: given a char index KNOWN to be
    # inside a { } object, return @{ Start; End } for the INNERMOST enclosing object
    # (indices of its '{' and matching '}'). A brace stack tracks nesting; at the inner
    # index we capture the innermost open '{', then return when its matching '}' pops.
    param([Parameter(Mandatory)][string]$Text, [Parameter(Mandatory)][int]$InnerIndex)

    $stack = New-Object System.Collections.Generic.Stack[int]
    $inStr = $false; $esc = $false; $targetOpen = -1
    for ($i = 0; $i -lt $Text.Length; $i++) {
        $c = $Text[$i]
        if ($inStr) {
            if ($esc) { $esc = $false }
            elseif ($c -eq '\') { $esc = $true }
            elseif ($c -eq '"') { $inStr = $false }
        }
        else {
            if ($c -eq '"') { $inStr = $true }
            elseif ($c -eq '{') { $stack.Push($i) }
            elseif ($c -eq '}') {
                if ($stack.Count -eq 0) { return $null }
                $popped = $stack.Pop()
                if ($targetOpen -ge 0 -and $popped -eq $targetOpen) { return @{ Start = $targetOpen; End = $i } }
            }
        }
        # Once we reach the inner index, the innermost currently-open '{' is our object.
        if ($i -eq $InnerIndex -and $targetOpen -lt 0) {
            if ($stack.Count -eq 0) { return $null }
            $targetOpen = $stack.Peek()
        }
    }
    return $null
}

function Get-JsonValueSpan {
    # Given an index at the first char of a JSON value (string / number / bool / null /
    # object / array), return @{ Start; End } spanning the COMPLETE value (string-aware for
    # objects/arrays so nested quotes/braces don't confuse the scan). Leading whitespace is
    # skipped defensively. Returns $null on malformed input (the re-parse-verify still
    # backstops any locate error). This is the value-skipper that keeps member/element
    # iteration at exactly depth-1.
    param([Parameter(Mandatory)][string]$Text, [Parameter(Mandatory)][int]$Start)
    $n = $Text.Length
    $i = $Start
    while ($i -lt $n -and [char]::IsWhiteSpace($Text[$i])) { $i++ }
    if ($i -ge $n) { return $null }
    $c = $Text[$i]
    if ($c -eq '"') {
        $j = $i + 1; $esc = $false
        while ($j -lt $n) {
            $cj = $Text[$j]
            if ($esc) { $esc = $false }
            elseif ($cj -eq '\') { $esc = $true }
            elseif ($cj -eq '"') { return @{ Start = $i; End = $j } }
            $j++
        }
        return $null
    }
    if ($c -eq '{' -or $c -eq '[') {
        $depth = 0; $inStr = $false; $esc = $false; $j = $i
        while ($j -lt $n) {
            $cj = $Text[$j]
            if ($inStr) {
                if ($esc) { $esc = $false }
                elseif ($cj -eq '\') { $esc = $true }
                elseif ($cj -eq '"') { $inStr = $false }
            }
            else {
                if ($cj -eq '"') { $inStr = $true }
                elseif ($cj -eq '{' -or $cj -eq '[') { $depth++ }
                elseif ($cj -eq '}' -or $cj -eq ']') { $depth--; if ($depth -eq 0) { return @{ Start = $i; End = $j } } }
            }
            $j++
        }
        return $null
    }
    # scalar: number / true / false / null — read until a structural delimiter or whitespace
    $j = $i
    while ($j -lt $n) {
        $cj = $Text[$j]
        if ($cj -eq ',' -or $cj -eq '}' -or $cj -eq ']' -or [char]::IsWhiteSpace($cj)) { break }
        $j++
    }
    if ($j -eq $i) { return $null }
    return @{ Start = $i; End = $j - 1 }
}

function Find-JsonMemberValueStart {
    # Within the object at [ObjStart='{' .. ObjEnd='}'], find the depth-1 member whose key
    # equals $Key and return the start index of ITS VALUE (or -1 if absent). Keys are
    # JSON-decoded (handles escapes) so a substring collision can't false-match. Nested
    # values are skipped via Get-JsonValueSpan so iteration stays at depth 1.
    param([Parameter(Mandatory)][string]$Text, [Parameter(Mandatory)][int]$ObjStart,
          [Parameter(Mandatory)][int]$ObjEnd, [Parameter(Mandatory)][string]$Key)
    $i = $ObjStart + 1
    while ($i -lt $ObjEnd) {
        while ($i -lt $ObjEnd -and ([char]::IsWhiteSpace($Text[$i]) -or $Text[$i] -eq ',')) { $i++ }
        if ($i -ge $ObjEnd) { break }
        if ($Text[$i] -ne '"') { return -1 }   # expected a key string
        $keySpan = Get-JsonValueSpan -Text $Text -Start $i
        if ($null -eq $keySpan) { return -1 }
        $keyToken = $Text.Substring($keySpan.Start, $keySpan.End - $keySpan.Start + 1)
        try { $decodedKey = $keyToken | ConvertFrom-Json } catch { return -1 }
        $i = $keySpan.End + 1
        while ($i -lt $ObjEnd -and [char]::IsWhiteSpace($Text[$i])) { $i++ }
        if ($i -ge $ObjEnd -or $Text[$i] -ne ':') { return -1 }
        $i++
        while ($i -lt $ObjEnd -and [char]::IsWhiteSpace($Text[$i])) { $i++ }
        $valSpan = Get-JsonValueSpan -Text $Text -Start $i
        if ($null -eq $valSpan) { return -1 }
        if ([string]$decodedKey -eq $Key) { return $valSpan.Start }
        $i = $valSpan.End + 1
    }
    return -1
}

function Find-JsonArrayElementStart {
    # Within the array at [ArrStart='[' .. ArrEnd=']'], return the start index of the
    # element at $Index (depth-1), or -1 if out of range. Elements are skipped via
    # Get-JsonValueSpan so nested commas/structures don't miscount.
    param([Parameter(Mandatory)][string]$Text, [Parameter(Mandatory)][int]$ArrStart,
          [Parameter(Mandatory)][int]$ArrEnd, [Parameter(Mandatory)][int]$Index)
    $i = $ArrStart + 1
    $idx = 0
    while ($i -lt $ArrEnd) {
        while ($i -lt $ArrEnd -and ([char]::IsWhiteSpace($Text[$i]) -or $Text[$i] -eq ',')) { $i++ }
        if ($i -ge $ArrEnd) { break }
        $elSpan = Get-JsonValueSpan -Text $Text -Start $i
        if ($null -eq $elSpan) { return -1 }
        if ($idx -eq $Index) { return $elSpan.Start }
        $idx++
        $i = $elSpan.End + 1
    }
    return -1
}
