# PowerShell Strict Mode + JSON Data

**Last updated:** 2026-07-27
**Author:** Project Manager (Orca)

`Set-StrictMode -Version Latest` interacts unpredictably with `ConvertFrom-Json` output. This is the full reference for the three recurring failure patterns. The one-line rule also lives in the root `AGENTS.md` trap list, and the `.Count` guard (pattern 3) is enforced workspace-wide by the `ps-strict-mode-count-guard` feedback rule.

## 1. Missing properties on JSON objects

JSON objects have inconsistent schemas — not every node has every property. Strict mode throws on access.

```powershell
# BAD — throws if parent_id doesn't exist on the object
$parentId = $node.parent_id

# GOOD — guard with PSObject.Properties
if ($node.PSObject.Properties['parent_id']) {
    $parentId = $node.parent_id
}
```

## 2. Complex .NET constructors in inline conditionals

Strict mode can fail to evaluate .NET constructor overloads inside inline if/else assignments.

```powershell
# BAD — "cannot call a method on a null-valued expression"
$set = if ($x) { [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase) } else { [System.Collections.Generic.HashSet[string]]::new() }

# GOOD — block if/else with simple constructors
if ($x) {
    $set = [System.Collections.Generic.HashSet[string]]::new()
} else {
    $set = [System.Collections.Generic.HashSet[string]]::new()
}
```

## 3. `.Count` on JSON empty arrays

`ConvertFrom-Json` empty arrays may lack `.Count` unlike native `@()` arrays.

```powershell
# BAD — .Count may throw on ConvertFrom-Json empty arrays
if ($node.children.Count -eq 0) { ... }

# GOOD — wrap in @() to guarantee PowerShell array, or use foreach+break
if (@($node.children).Count -eq 0) { ... }

# ALSO GOOD — foreach is always safe
$hasChildren = $false
foreach ($_ in $node.children) { $hasChildren = $true; break }
```

## General rule

When strict mode throws on valid-looking code involving JSON data, simplify — break into multiple statements, guard property access, and wrap JSON arrays in `@()`.
