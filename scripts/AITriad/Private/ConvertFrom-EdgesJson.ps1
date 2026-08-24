# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function ConvertFrom-EdgesJson {
    <#
    .SYNOPSIS
        Parse edges.json text WITHOUT coercing ISO-8601 timestamps to [datetime] (t/2974).
    .DESCRIPTION
        PowerShell 7.4's `ConvertFrom-Json` silently coerces a full ISO-8601 datetime string
        (e.g. `discovered_at: "2026-08-20T18:55:33.440Z"`) into a [datetime]. On the next
        whole-file write, `ConvertTo-Json` re-emits that [datetime] dropping trailing-zero
        fractional digits (`.440Z` -> `.44Z`), silently mutating `discovered_at` on rows the
        write never targeted — breaking the "only the field I targeted moved" byte contract every
        t/2945 byte-safety proof relies on, and perturbing half the twin discriminator
        (discovered_at + model, t/2956). The write-side cannot fix this: `T10:00:21Z` and
        `T10:00:21.000Z` collapse to the SAME [datetime], so the original fractional-digit count
        is unrecoverable once coerced (the golden byte-contract fixture proves a `.fff` normalizer
        would corrupt no-fractional timestamps). `-DateKind String` (which stops coercion at parse)
        is PS 7.5+ only, unavailable here. So we fix it at READ time: keep timestamps as strings.

        Performance matters — edges.json is ~14 MB / ~33k edges and some callers are interactive.
        A full hand-rolled JSON->PSCustomObject walk is ~24x slower than ConvertFrom-Json, so we
        use a HYBRID: ConvertFrom-Json for the fast structure, then restore the exact original
        timestamp STRINGS from a System.Text.Json.JsonDocument pass. JsonDocument and
        ConvertFrom-Json parse the same JSON array in the SAME order, so the edge at index i in one
        is the edge at index i in the other — the restore is index-aligned, no key matching needed.

        Restores: (a) any TOP-LEVEL property coerced to a datetime (e.g. a `last_modified` that
        carries a time component — a date-only `last_modified` is never coerced), and (b) the edge
        field `discovered_at`, which is the ONLY ISO-datetime field on an edge today (AC#4). Other
        edge fields (source/type/target/rationale/model/... ) are strings/numbers/bools that
        ConvertFrom-Json never coerces. If a future edge ISO field is added, extend $edgeDateFields.
    .PARAMETER Json
        The raw edges.json text.
    .OUTPUTS
        The parsed document (PSCustomObject), with ISO-datetime string fields preserved verbatim.
    #>
    [OutputType([object])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Json
    )

    # Fast structural parse (ISO datetimes get coerced to [datetime] here — restored below).
    $obj = $Json | ConvertFrom-Json
    if ($null -eq $obj) { return $obj }

    # Edge fields that ConvertFrom-Json coerces to [datetime] and must be restored to their exact
    # original string. Only discovered_at exists today; the list is the extension point (AC#4).
    $edgeDateFields = @('discovered_at')

    $doc = $null
    try { $doc = [System.Text.Json.JsonDocument]::Parse($Json) }
    catch { return $obj }   # ConvertFrom-Json already parsed it; if STJ can't, return as-is (fail-open)

    try {
        $root = $doc.RootElement
        if ($root.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) { return $obj }
        if (-not ($obj -is [System.Management.Automation.PSCustomObject])) { return $obj }

        # (a) Top-level coerced datetimes (general — few fields), by name.
        foreach ($p in $obj.PSObject.Properties) {
            if ($p.Name -eq 'edges') { continue }
            if ($p.Value -is [datetime] -or $p.Value -is [datetimeoffset]) {
                $el = [System.Text.Json.JsonElement]::new()
                if ($root.TryGetProperty($p.Name, [ref]$el) -and $el.ValueKind -eq [System.Text.Json.JsonValueKind]::String) {
                    $p.Value = $el.GetString()
                }
            }
        }

        # (b) Per-edge discovered_at, restored by ARRAY INDEX (order is identical across both parsers).
        if ($obj.PSObject.Properties['edges']) {
            $edgesEl = [System.Text.Json.JsonElement]::new()
            if ($root.TryGetProperty('edges', [ref]$edgesEl) -and $edgesEl.ValueKind -eq [System.Text.Json.JsonValueKind]::Array) {
                $edgeArr = @($obj.edges)
                $i = 0
                foreach ($edgeEl in $edgesEl.EnumerateArray()) {
                    if ($i -ge $edgeArr.Count) { break }
                    $edge = $edgeArr[$i]; $i++
                    if ($null -eq $edge -or -not $edge.PSObject) { continue }
                    if ($edgeEl.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) { continue }
                    foreach ($field in $edgeDateFields) {
                        $prop = $edge.PSObject.Properties[$field]
                        if ($null -eq $prop) { continue }
                        if (-not ($prop.Value -is [datetime] -or $prop.Value -is [datetimeoffset])) { continue }
                        $el = [System.Text.Json.JsonElement]::new()
                        if ($edgeEl.TryGetProperty($field, [ref]$el) -and $el.ValueKind -eq [System.Text.Json.JsonValueKind]::String) {
                            $prop.Value = $el.GetString()
                        }
                    }
                }
            }
        }
    } finally {
        $doc.Dispose()
    }
    return $obj
}

function Read-EdgesFile {
    <#
    .SYNOPSIS
        Read + parse an edges.json file WITHOUT coercing ISO timestamps to [datetime] (t/2974).
        The read-side counterpart to Write-EdgesFile — use it wherever a cmdlet reads edges.json
        and later rewrites the whole file, so discovered_at round-trips byte-identically.
    .PARAMETER Path
        Path to the edges.json file (must exist — callers keep their own Test-Path handling).
    #>
    [OutputType([object])]
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )
    return (ConvertFrom-EdgesJson -Json (Get-Content -Raw -LiteralPath $Path))
}
