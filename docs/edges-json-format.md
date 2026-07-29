# edges.json Serialization Format

**Last updated:** 2026-07-29
**Author:** Tech Lead 2 (Technical Lead)
**Status:** Approved — implementation contract for t/673
**Applies to:** every writer of `taxonomy/Origin/edges.json` in the data repo

## Why this document exists

`edges.json` is written by four roles in three languages. If any two writers disagree
on serialization by even one byte, the next write churns the entire 14 MB file and the
data repo's diff history becomes useless. This document is the byte-level contract.
It is not a style preference — it is an interface.

## The format

Top-level structure is pretty-printed at 2 spaces. The `edges` array is compacted:
one edge per line, no internal whitespace, indented 4 spaces.

```json
{
  "_schema_version": "1.0.0",
  "_doc": "...",
  "last_modified": "2026-07-29T00:00:00Z",
  "edge_types": [
    "SUPPORTS",
    "TENSION_WITH"
  ],
  "edges": [
    {"source":"acc-beliefs-001","target":"saf-beliefs-042","type":"SUPPORTS","confidence":0.85},
    {"source":"acc-beliefs-002","target":"skp-desires-011","type":"TENSION_WITH","confidence":0.72}
  ]
}
```

### Rules

1. **Top-level keys** keep the order they appear in the file as read. Do not sort, do not
   reorder, do not add or drop keys during a rewrite.
2. **Every top-level value except `edges`** is pretty-printed at 2-space indent, re-indented
   one level (2 additional spaces) to sit inside the root object.
3. **`edges`** is emitted as `"edges": [`, then each element on its own line at 4-space
   indent, serialized compactly, joined by `,\n`, then `  ]`.
4. **An empty edges array** is emitted inline as `"edges": []`.
5. **Compact separators** are `,` and `:` with no surrounding whitespace.
6. **Key order inside each edge** is preserved exactly as read.
7. **Non-ASCII characters are literal UTF-8**, never `\uXXXX`-escaped. `—`, `café`, `naïve`
   appear as themselves.
8. **Line endings are LF only.** No CR anywhere in the file. This survives Windows checkouts:
   the repo sets `core.autocrlf=true`, but the root `.gitattributes` pins `*.json text eol=lf`,
   which wins. Do not add a `.gitattributes` override for the fixture directory — it is already
   correct, and a redundant rule is one more thing to drift.
9. **The file ends with exactly one trailing newline.**
10. **Encoding is UTF-8 without BOM.**

## Reference implementations

All three below were verified to produce byte-identical output from the golden fixture.
Use them; do not hand-roll a variant.

### TypeScript

```ts
JSON.stringify(edge)  // per edge — already correct, no options needed
```

`JSON.stringify` is the reference implementation. Its defaults match the contract exactly.

### PowerShell

```powershell
$e | ConvertTo-Json -Depth 20 -Compress   # per edge — byte-identical to JSON.stringify
```

Verified on PS 7.4.18: `-Compress` output matches `JSON.stringify` byte-for-byte, including
the handling of `'`, `&`, `<`, `>`, and `/` (all left literal, matching JS) and of embedded
double quotes and backslashes (escaped identically). No `-EscapeHandling` argument is needed —
the PS 7 default already agrees with JS.

**Trap:** `ConvertTo-Json` without `-Compress` emits **CRLF** on Windows. When pretty-printing
the non-`edges` top-level values you must normalize before re-indenting, or every line carries
a stray `\r` and byte parity is lost:

```powershell
$pretty = ($value | ConvertTo-Json -Depth 20) -replace "`r`n", "`n"
```

This cost 4 bytes on a 1359-byte fixture and is invisible in a terminal diff.

### Python

```python
json.dumps(edge, ensure_ascii=False, separators=(',', ':'))   # per edge
json.dumps(value, ensure_ascii=False, indent=2)               # pretty values
```

**Trap:** Python's defaults **do not match** the other two languages, in two independent ways.
`json.dumps(edge)` with no options produces 368 bytes where TS/PS produce 327 for the same edge:

- `ensure_ascii` defaults to `True`, escaping the em-dash to the literal text `—`
- default separators are `(', ', ': ')` — note the spaces

Both options are mandatory. Omitting either silently breaks the contract.

Load with `object_pairs_hook=collections.OrderedDict` to guarantee rule 1 and rule 6 on
Python versions where dict ordering is not guaranteed.

## The golden fixture

`tests/fixtures/edges-format/input.json` → `tests/fixtures/edges-format/expected.json`

Every writer must reproduce `expected.json` from `input.json`, byte for byte. The input
deliberately exercises the hazards: apostrophes, embedded double quotes, `&`, `<`, `>`,
backslashes, forward slashes, em-dash, accented Latin, integer-valued floats, `null`,
an empty array, and a nested object.

**Do not edit either fixture to make a test pass.** If a writer disagrees with
`expected.json`, the writer is wrong. If the contract itself needs to change, change it
here first and regenerate the fixture for all writers in one commit.

## Scope

This contract governs `edges.json` only. It does **not** apply to other taxonomy files
(`nodes`, `situations`, `policy_actions`, `embeddings`), which stay fully pretty-printed.
`writeJsonFileAtomic` in the Electron main process is generic across all JSON files —
route edges through a dedicated path rather than changing the shared writer's default.

## What this buys

Measured against the live 33,454-edge file:

| format | size | lines | saving |
|---|---|---|---|
| current (`indent=2`) | 17.34 MB | 420,191 | — |
| **this contract** | **14.48 MB** | **33,520** | **16.5%** |
| fully compact | 14.32 MB | 1 | 17.4% |

Fully compact was evaluated and rejected: it buys a further 160 KB (about 1% of the file)
in exchange for all diff granularity, since every edge change would rewrite one 14 MB line.
