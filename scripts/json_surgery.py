#!/usr/bin/env python3

# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""Field-surgical JSON editing for Python data writers (t/2926, TL ruling t/2921#2).

Python twin of the PowerShell nested-path surgical editor (``Update-JsonNodePath``,
merged in t/2921 / PR #1391). Lets a Python writer (e.g. ``reprocess_taxonomy_vocabulary``)
change ONE scalar value at a NESTED path on ONE ``nodes[]`` entry by splicing only that
value's bytes in the raw text — every other byte is preserved, so concurrent uncommitted
WIP elsewhere in the file cannot ride into the write (the sit-477 sweep, t/2896). This is
the durable replacement for the whole-file ``json.load -> json.dump`` round-trip on the
perpetually-dirty WARN-tier files the guard can't Block.

Safety = parse-LOCATE + minimal-SPLICE + re-parse-VERIFY: after splicing we re-parse the
result and assert it equals the original with EXACTLY the intended change — anything else
raises ``JsonSurgeryError`` and writes nothing. That invariant is what makes byte-surgery
safe regardless of splice edge cases.

Addressing is a SEGMENT LIST (t/2921#2 Q1), never a dotted string: object keys (``str``)
and array indices (``int``), anchored on the stable node id — e.g.
``["graph_attributes", "policy_actions", 2, "framing"]``. A dotted/bracket form is rendered
for error messages ONLY (display, never parsing).

Scope (t/2921#2 Q2): IN-PLACE SCALAR replacement at an EXISTING path only. Path-not-found,
an object/array-valued target, and a mid-path type mismatch all raise (no insert-at-depth,
no structural add/remove). Lockstep with the PowerShell behaviour + adversarial vectors
(tests/Update-JsonNodePath.Tests.ps1 <-> scripts/test_json_surgery.py).
"""

import json
import re


class JsonSurgeryError(RuntimeError):
    """Raised (writing nothing) on any locate/splice/verify failure — the safe-abort
    that turns fragile string surgery into a correctness-gated write."""


def _actionable(goal: str, problem: str, next_steps: str) -> str:
    return (
        f"Goal: {goal}\nProblem: {problem}\n"
        f"Location: json_surgery.update_json_node_path\nNext steps: {next_steps}"
    )


def _json_value_span(text: str, start: int):
    """Given an index at (or before, skipping whitespace) the first char of a JSON value,
    return ``(start, end)`` inclusive spanning the COMPLETE value — string / number / bool /
    null / object / array — string-aware so nested quotes/braces don't confuse the scan.
    Returns ``None`` on malformed input (the re-parse-verify still backstops any error)."""
    n = len(text)
    i = start
    while i < n and text[i].isspace():
        i += 1
    if i >= n:
        return None
    c = text[i]
    if c == '"':
        j = i + 1
        esc = False
        while j < n:
            cj = text[j]
            if esc:
                esc = False
            elif cj == "\\":
                esc = True
            elif cj == '"':
                return (i, j)
            j += 1
        return None
    if c in "{[":
        depth = 0
        in_str = False
        esc = False
        j = i
        while j < n:
            cj = text[j]
            if in_str:
                if esc:
                    esc = False
                elif cj == "\\":
                    esc = True
                elif cj == '"':
                    in_str = False
            else:
                if cj == '"':
                    in_str = True
                elif cj in "{[":
                    depth += 1
                elif cj in "}]":
                    depth -= 1
                    if depth == 0:
                        return (i, j)
            j += 1
        return None
    # scalar: number / true / false / null — read to a structural delimiter or whitespace
    j = i
    while j < n:
        cj = text[j]
        if cj in ",}]" or cj.isspace():
            break
        j += 1
    if j == i:
        return None
    return (i, j - 1)


def _find_object_span(text: str, inner_index: int):
    """Given a char index KNOWN to be inside a ``{ }`` object, return ``(start, end)`` for
    the INNERMOST enclosing object (indices of its ``{`` and matching ``}``). String/escape
    aware brace stack; at the inner index capture the innermost open ``{``, return when its
    matching ``}`` pops. Mirrors PS Find-JsonObjectSpan."""
    stack = []
    in_str = False
    esc = False
    target_open = -1
    for i, c in enumerate(text):
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == "{":
                stack.append(i)
            elif c == "}":
                if not stack:
                    return None
                popped = stack.pop()
                if target_open >= 0 and popped == target_open:
                    return (target_open, i)
        if i == inner_index and target_open < 0:
            if not stack:
                return None
            target_open = stack[-1]
    return None


def _find_member_value_start(text: str, obj_start: int, obj_end: int, key: str) -> int:
    """Within the object at ``[obj_start='{' .. obj_end='}']``, find the depth-1 member whose
    key equals ``key`` and return the start index of ITS VALUE (or -1 if absent). Keys are
    JSON-decoded so a substring collision can't false-match; nested values are skipped via
    ``_json_value_span`` so iteration stays at depth 1."""
    i = obj_start + 1
    while i < obj_end:
        while i < obj_end and (text[i].isspace() or text[i] == ","):
            i += 1
        if i >= obj_end:
            break
        if text[i] != '"':
            return -1  # expected a key string
        key_span = _json_value_span(text, i)
        if key_span is None:
            return -1
        key_token = text[key_span[0] : key_span[1] + 1]
        try:
            decoded_key = json.loads(key_token)
        except ValueError:
            return -1
        i = key_span[1] + 1
        while i < obj_end and text[i].isspace():
            i += 1
        if i >= obj_end or text[i] != ":":
            return -1
        i += 1
        while i < obj_end and text[i].isspace():
            i += 1
        val_span = _json_value_span(text, i)
        if val_span is None:
            return -1
        if decoded_key == key:
            return val_span[0]
        i = val_span[1] + 1
    return -1


def _find_array_element_start(text: str, arr_start: int, arr_end: int, index: int) -> int:
    """Within the array at ``[arr_start='[' .. arr_end=']']``, return the start index of the
    element at ``index`` (depth-1), or -1 if out of range. Elements skipped via
    ``_json_value_span`` so nested commas/structures don't miscount."""
    i = arr_start + 1
    idx = 0
    while i < arr_end:
        while i < arr_end and (text[i].isspace() or text[i] == ","):
            i += 1
        if i >= arr_end:
            break
        el_span = _json_value_span(text, i)
        if el_span is None:
            return -1
        if idx == index:
            return el_span[0]
        idx += 1
        i = el_span[1] + 1
    return -1


def _path_display(path) -> str:
    """Human-readable rendering of a segment path for error messages ONLY."""
    out = ""
    for seg in path:
        if isinstance(seg, bool):  # bool is an int subclass — treat as a (bad) key
            out += f".{seg}"
        elif isinstance(seg, int):
            out += f"[{seg}]"
        else:
            out += (("." if out else "") + str(seg))
    return out


def _set_at_path(root, path, value, fail):
    """Navigate a json.loads clone by the segment path and set the final scalar — used ONLY
    to build the re-parse-verify EXPECTED baseline (never touches the file)."""
    cur = root
    for seg in path[:-1]:
        try:
            cur = cur[seg]
        except (KeyError, IndexError, TypeError):
            fail("verify baseline could not descend", "internal: path/parse mismatch")
    last = path[-1]
    try:
        cur[last] = value
    except (KeyError, IndexError, TypeError):
        fail("verify baseline could not set final segment", "internal: path/parse mismatch")


def update_json_node_path(raw_text: str, node_id: str, path, value) -> str:
    """In-place surgical replacement of ONE scalar value at a NESTED path on ONE ``nodes[]``
    entry. Returns the patched raw JSON string. Byte-preserving everywhere except the target
    value; re-parse-verified before returning.

    ``path`` is a list of segments: object keys (``str``) and array indices (``int``).

    Raises ``JsonSurgeryError`` (writing nothing) on invalid JSON, node/path not found, an
    object/array-valued target (scalar-only), or a re-parse-verify mismatch.
    """
    path = list(path)
    disp = _path_display(path)

    def fail(problem: str, next_steps: str):
        raise JsonSurgeryError(
            _actionable(f"Nested surgical update of '{disp}' on node '{node_id}'", problem, next_steps)
        )

    if not path:
        fail("Path is empty", "Provide at least one path segment")

    # --- Parse (locate + verification baseline) ---
    try:
        original = json.loads(raw_text)
    except ValueError as exc:
        fail(f"Input is not valid JSON: {exc}", "Pass well-formed JSON text")
    if not isinstance(original, dict) or "nodes" not in original:
        fail("No nodes[] array in the JSON", "Expected a top-level nodes[] array")
    matches = [n for n in original["nodes"] if isinstance(n, dict) and n.get("id") == node_id]
    if not matches:
        fail(f"Node id '{node_id}' not found in nodes[]", "Verify the node id exists in the file")

    # --- Locate the node object span, then descend the path to the target value span ---
    id_token = re.search(r'"id"\s*:\s*"' + re.escape(node_id) + r'"', raw_text)
    if id_token is None:
        fail(f"id token for '{node_id}' not found in raw text", "File text may not match the parsed structure")
    node_span = _find_object_span(raw_text, id_token.start())
    if node_span is None:
        fail(f"could not locate the enclosing object span for '{node_id}'", "Check the JSON is well-formed")

    cur_start, cur_end = node_span
    for seg in path:
        cur_char = raw_text[cur_start]
        # bool is an int subclass — reject it explicitly as neither a valid key nor index
        if isinstance(seg, bool):
            fail(f"segment '{seg}' is a bool — segments must be str keys or int indices",
                 "Use a string key or integer index")
        if isinstance(seg, int):
            if cur_char != "[":
                fail(f"segment [{seg}] expects an array but the container at that level is not an array",
                     "Check the path matches the document shape")
            v_start = _find_array_element_start(raw_text, cur_start, cur_end, seg)
            if v_start < 0:
                fail(f"array index [{seg}] is out of range (path-not-found)",
                     "Verify the index exists; no insert-at-depth in this phase (t/2921 Q2)")
        else:
            if cur_char != "{":
                fail(f"segment '{seg}' expects an object but the container at that level is not an object",
                     "Check the path matches the document shape")
            v_start = _find_member_value_start(raw_text, cur_start, cur_end, str(seg))
            if v_start < 0:
                fail(f"key '{seg}' not found at this level (path-not-found)",
                     "Verify the key exists; no insert-at-depth in this phase (t/2921 Q2)")
        v_span = _json_value_span(raw_text, v_start)
        if v_span is None:
            fail(f"could not span-scan the value at segment '{seg}'", "Report with the input file + path")
        cur_start, cur_end = v_span

    # --- Target must be a SCALAR (in-place scalar replacement only, t/2921 Q2) ---
    if raw_text[cur_start] in "{[":
        fail(f"target at '{disp}' is an object/array; only in-place scalar replacement is supported",
             "Object/array-valued replacement is out of scope (t/2921 Q2)")

    # --- Splice the target value span (ensure_ascii=False matches how the file stores unicode) ---
    encoded = json.dumps(value, ensure_ascii=False)
    patched = raw_text[:cur_start] + encoded + raw_text[cur_end + 1 :]

    # --- Re-parse-VERIFY invariant (the safety net) ---
    try:
        actual = json.loads(patched)
    except ValueError as exc:
        fail(f"patched text is not valid JSON — writing nothing: {exc}",
             "Splice produced invalid JSON; this is a bug in json_surgery")
    expected = json.loads(raw_text)
    exp_node = next(n for n in expected["nodes"] if isinstance(n, dict) and n.get("id") == node_id)
    _set_at_path(exp_node, path, value, fail)
    if expected != actual:
        fail(f"re-parse-verify FAILED: the splice changed more than the intended value at "
             f"'{disp}' on '{node_id}' — writing nothing",
             "This is a splice bug; the guard refused a corrupting write")
    return patched
