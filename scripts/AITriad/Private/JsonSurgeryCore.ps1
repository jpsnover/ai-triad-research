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

function Set-JsonExpectedEdit {
    # Apply ONE Save-JsonNodeFieldEdits edit hashtable to a parsed (ConvertFrom-Json) document,
    # mirroring what the surgical primitives do to the raw text — builds the EXPECTED side of
    # the batch re-parse-verify. Throws if the model can't be descended; the caller treats any
    # throw here as a verify failure (fail-closed), never as success.
    param([Parameter(Mandatory)]$Root, [Parameter(Mandatory)][hashtable]$Edit)

    $nodeId = [string]$Edit['NodeId']
    $node = @($Root.nodes | Where-Object { $_.PSObject.Properties['id'] -and $_.id -eq $nodeId })[0]
    if ($null -eq $node) { throw "expected-model: node '$nodeId' not found" }

    $setMember = {
        param($obj, [string]$name, $value)
        if ($obj.PSObject.Properties[$name]) { $obj.$name = $value }
        else { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force }
    }

    if ($Edit.ContainsKey('Field')) {
        & $setMember $node ([string]$Edit['Field']) $Edit['Value']
        return
    }

    $path = @($Edit['Path'])
    $cur = $node
    for ($k = 0; $k -lt $path.Count - 1; $k++) {
        $seg = $path[$k]
        if ($seg -is [int]) { $next = $cur[$seg] }
        elseif ($cur.PSObject.Properties[[string]$seg]) { $next = $cur.([string]$seg) }
        elseif ([bool]$Edit['Upsert']) {
            # Upsert creates missing OBJECT containers along the path (t/3438).
            $next = [pscustomobject]@{}
            $cur | Add-Member -NotePropertyName ([string]$seg) -NotePropertyValue $next -Force
        }
        else { throw "expected-model: segment '$seg' not found on '$nodeId'" }
        if ($null -eq $next) { throw "expected-model: segment '$seg' resolved to null on '$nodeId'" }
        $cur = $next
    }

    $last = $path[$path.Count - 1]
    if ([bool]$Edit['Remove']) {
        if (-not $cur.PSObject.Properties[[string]$last]) { throw "expected-model: key '$last' not found on '$nodeId'" }
        $cur.PSObject.Properties.Remove([string]$last)
    }
    elseif ($last -is [int]) { $cur[$last] = $Edit['Value'] }
    else { & $setMember $cur ([string]$last) $Edit['Value'] }
}

function Find-JsonIdTokenIndex {
    # Index of the first match of  "id"\s*:\s*"<NodeId>"  in Text (the start of the "id" key),
    # or -1 — the same result as that regex, found via an ordinal search for the quoted id plus
    # a backward check for the "id": prefix.
    #
    # PERF: the large text is only ever the INSTANCE of a method call here, never an argument.
    # Passing a multi-MB string as an argument to a .NET method from PowerShell (e.g. the
    # [regex]::Match this replaces) costs ~0.5s per call on a 7 MB taxonomy file — paid once
    # per edit, it was most of a multi-hour Invoke-VernacularBatch write phase.
    param([Parameter(Mandatory)][string]$Text, [Parameter(Mandatory)][string]$NodeId)

    $needle = '"' + $NodeId + '"'
    $from = 0
    while ($from -lt $Text.Length) {
        $v = $Text.IndexOf($needle, $from, [System.StringComparison]::Ordinal)
        if ($v -lt 0) { return -1 }
        # Walk back over  \s* : \s*  and require the literal "id" key before it.
        $p = $v - 1
        while ($p -ge 0 -and [char]::IsWhiteSpace($Text[$p])) { $p-- }
        if ($p -ge 0 -and $Text[$p] -eq [char]':') {
            $p--
            while ($p -ge 0 -and [char]::IsWhiteSpace($Text[$p])) { $p-- }
            if ($p -ge 3 -and $Text.Substring($p - 3, 4) -ceq '"id"') { return $p - 3 }
        }
        $from = $v + 1
    }
    return -1
}

function Find-JsonObjectSpan {
    # String/escape-aware scan: given a char index KNOWN to be inside a { } object, return
    # @{ Start; End } for the INNERMOST enclosing object (indices of its '{' and matching '}').
    #
    # The scan starts at the beginning of InnerIndex's LINE rather than at offset 0: a raw
    # newline can't occur inside a JSON string, so a line start is always outside a string and
    # the brace scan is valid from there. If the enclosing '{' lies above that line, the start
    # moves back (doubling the line count) and rescans. Cost is proportional to the node, not
    # the file — scanning from offset 0 cost ~0.8s per edit on a 7 MB taxonomy file. Minified
    # (single-line) JSON degrades to the old full-file scan. A wrong span can't reach disk:
    # every caller re-parse-verifies before writing.
    param([Parameter(Mandatory)][string]$Text, [Parameter(Mandatory)][int]$InnerIndex)

    if ($InnerIndex -lt 0 -or $InnerIndex -ge $Text.Length) { return $null }

    $lines = 1
    while ($true) {
        # Start of the line $lines lines above (and including) InnerIndex's line; 0 at the top.
        $scanFrom = $InnerIndex
        for ($k = 0; $k -lt $lines -and $scanFrom -gt 0; $k++) {
            $nl = $Text.LastIndexOf([char]10, $scanFrom - 1)
            $scanFrom = if ($nl -lt 0) { 0 } else { $nl }
        }
        if ($scanFrom -gt 0) { $scanFrom++ }   # step past the newline itself

        # Innermost '{' still open at InnerIndex, among those opened at/after $scanFrom. A '}'
        # with an empty local stack closes an object opened above $scanFrom — not ours.
        $stack = New-Object System.Collections.Generic.Stack[int]
        $inStr = $false; $esc = $false
        for ($i = $scanFrom; $i -le $InnerIndex; $i++) {
            $c = $Text[$i]
            if ($inStr) {
                if ($esc) { $esc = $false }
                elseif ($c -eq '\') { $esc = $true }
                elseif ($c -eq '"') { $inStr = $false }
            }
            else {
                if ($c -eq '"') { $inStr = $true }
                elseif ($c -eq '{') { $stack.Push($i) }
                elseif ($c -eq '}' -and $stack.Count -gt 0) { [void]$stack.Pop() }
            }
        }
        if ($stack.Count -gt 0) { $open = $stack.Peek(); break }
        if ($scanFrom -eq 0) { return $null }
        $lines *= 2
    }

    # Matching '}' for the '{' at $open.
    $depth = 0; $inStr = $false; $esc = $false
    for ($i = $open; $i -lt $Text.Length; $i++) {
        $c = $Text[$i]
        if ($inStr) {
            if ($esc) { $esc = $false }
            elseif ($c -eq '\') { $esc = $true }
            elseif ($c -eq '"') { $inStr = $false }
        }
        else {
            if ($c -eq '"') { $inStr = $true }
            elseif ($c -eq '{') { $depth++ }
            elseif ($c -eq '}') { $depth--; if ($depth -eq 0) { return @{ Start = $open; End = $i } } }
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

function Find-JsonMemberSpan {
    # Within the object at [ObjStart='{' .. ObjEnd='}'], find the depth-1 member whose key
    # equals $Key and return @{ KeyStart; ValueEnd } — KeyStart = index of the key's opening
    # '"', ValueEnd = index of the value's LAST char (inclusive). Returns $null if absent. Same
    # key-decode + Get-JsonValueSpan skipping as Find-JsonMemberValueStart, so it stays at depth 1
    # and can't substring-collide. Used by Update-JsonNodePath -Remove to splice out the whole
    # member (key..value) + one adjacent comma. Returns the FIRST match; duplicate sibling keys
    # are outside the surgical contract (documented on Update-JsonNodePath).
    param([Parameter(Mandatory)][string]$Text, [Parameter(Mandatory)][int]$ObjStart,
          [Parameter(Mandatory)][int]$ObjEnd, [Parameter(Mandatory)][string]$Key)
    $i = $ObjStart + 1
    while ($i -lt $ObjEnd) {
        while ($i -lt $ObjEnd -and ([char]::IsWhiteSpace($Text[$i]) -or $Text[$i] -eq ',')) { $i++ }
        if ($i -ge $ObjEnd) { break }
        if ($Text[$i] -ne '"') { return $null }   # expected a key string
        $keyStart = $i
        $keySpan = Get-JsonValueSpan -Text $Text -Start $i
        if ($null -eq $keySpan) { return $null }
        $keyToken = $Text.Substring($keySpan.Start, $keySpan.End - $keySpan.Start + 1)
        try { $decodedKey = $keyToken | ConvertFrom-Json } catch { return $null }
        $i = $keySpan.End + 1
        while ($i -lt $ObjEnd -and [char]::IsWhiteSpace($Text[$i])) { $i++ }
        if ($i -ge $ObjEnd -or $Text[$i] -ne ':') { return $null }
        $i++
        while ($i -lt $ObjEnd -and [char]::IsWhiteSpace($Text[$i])) { $i++ }
        $valSpan = Get-JsonValueSpan -Text $Text -Start $i
        if ($null -eq $valSpan) { return $null }
        if ([string]$decodedKey -eq $Key) { return @{ KeyStart = $keyStart; ValueEnd = $valSpan.End } }
        $i = $valSpan.End + 1
    }
    return $null
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
