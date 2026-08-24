#!/usr/bin/env python3

# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""Adversarial suite for the Python nested-path surgical editor (t/2926).

LOCKSTEP with the PowerShell twin (tests/Update-JsonNodePath.Tests.ps1): same 9 vectors,
same fixture shape. Segment-list addressing (key=str, index=int), in-place scalar
replacement only, re-parse-verify backstop. The written text must be byte-preserving
everywhere except the target value, so concurrent WIP elsewhere cannot ride into the write
(the sit-477 sweep). Runs under the t/2933 CI pytest gate (scripts/test_*.py); also
standalone: ``python -m pytest scripts/test_json_surgery.py``.

Each node is on its OWN line so a nested edit changes exactly that node's line — the
byte-preservation / line-diff assertions depend on that layout.
"""

import importlib.util
import json
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "json_surgery", Path(__file__).resolve().parent / "json_surgery.py"
)
json_surgery = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(json_surgery)
update_json_node_path = json_surgery.update_json_node_path
JsonSurgeryError = json_surgery.JsonSurgeryError


FIXTURE = (
    "{\n"
    '  "nodes": [\n'
    '    { "id": "acc-001", "graph_attributes": { "assumes": ["a0", "a1"], '
    '"policy_actions": [ { "action": "act0", "framing": "frame0" }, '
    '{ "action": "act1", "framing": "frame1" } ], "type": "belief", '
    '"disagreement_type": "empirical" }, "interpretations": { "accelerationist": '
    '{ "summary": "sumA" } } },\n'
    '    { "id": "acc-002", "note": "keep", "resolved_node_id": "sit-477", "ratio": 3.0 },\n'
    '    { "id": "acc-003", "interpretations": { "skeptic": { "summary": "sumS" } } }\n'
    "  ]\n"
    "}\n"
)


def _node(text, node_id):
    return next(n for n in json.loads(text)["nodes"] if n.get("id") == node_id)


def test_1_nested_object_field_replace():
    out = update_json_node_path(FIXTURE, "acc-001",
                               ["interpretations", "accelerationist", "summary"], "NEWSUM")
    assert _node(out, "acc-001")["interpretations"]["accelerationist"]["summary"] == "NEWSUM"


def test_2_string_array_element_replace():
    out = update_json_node_path(FIXTURE, "acc-001", ["graph_attributes", "assumes", 1], "A1X")
    ga = _node(out, "acc-001")["graph_attributes"]
    assert ga["assumes"][1] == "A1X"
    assert ga["assumes"][0] == "a0"   # sibling element untouched


def test_3_array_element_object_field_replace():
    out = update_json_node_path(FIXTURE, "acc-001",
                               ["graph_attributes", "policy_actions", 1, "framing"], "FRAME1X")
    pa = _node(out, "acc-001")["graph_attributes"]["policy_actions"]
    assert pa[1]["framing"] == "FRAME1X"
    assert pa[1]["action"] == "act1"    # sibling field untouched
    assert pa[0]["framing"] == "frame0"  # sibling element untouched


def test_4_nested_field_name_collision():
    # replacing ga.type must not touch ga.disagreement_type (substring collision)
    out = update_json_node_path(FIXTURE, "acc-001", ["graph_attributes", "type"], "desire")
    ga = _node(out, "acc-001")["graph_attributes"]
    assert ga["type"] == "desire"
    assert ga["disagreement_type"] == "empirical"


def test_5_escaping_roundtrip():
    tricky = 'He said "hi"\nC:\\path\\to'
    out = update_json_node_path(FIXTURE, "acc-001",
                               ["interpretations", "accelerationist", "summary"], tricky)
    assert _node(out, "acc-001")["interpretations"]["accelerationist"]["summary"] == tricky


def test_6_anti_sweep_foreign_wip_byte_identical():
    out = update_json_node_path(FIXTURE, "acc-001",
                               ["interpretations", "accelerationist", "summary"], "NEWSUM")
    assert '"resolved_node_id": "sit-477"' in out
    assert '"ratio": 3.0' in out   # NOT churned to 3
    orig_lines = FIXTURE.split("\n")
    new_lines = out.split("\n")
    assert len(new_lines) == len(orig_lines)
    diff = [i for i in range(len(orig_lines)) if orig_lines[i] != new_lines[i]]
    assert len(diff) == 1   # only the acc-001 line changed


def test_7_multi_node_sequential_composition():
    out1 = update_json_node_path(FIXTURE, "acc-001",
                                ["interpretations", "accelerationist", "summary"], "S1")
    out2 = update_json_node_path(out1, "acc-003",
                                ["interpretations", "skeptic", "summary"], "S3")
    assert _node(out2, "acc-001")["interpretations"]["accelerationist"]["summary"] == "S1"
    assert _node(out2, "acc-003")["interpretations"]["skeptic"]["summary"] == "S3"
    assert '"resolved_node_id": "sit-477"' in out2
    assert '"ratio": 3.0' in out2
    orig_lines = FIXTURE.split("\n")
    new_lines = out2.split("\n")
    diff = [i for i in range(len(orig_lines)) if orig_lines[i] != new_lines[i]]
    assert len(diff) == 2   # exactly the two edited node lines


def test_8_path_not_found_raises_and_writes_nothing():
    with pytest.raises(JsonSurgeryError):
        update_json_node_path(FIXTURE, "acc-001", ["graph_attributes", "nonexistent"], "x")
    with pytest.raises(JsonSurgeryError):
        update_json_node_path(FIXTURE, "acc-001", ["graph_attributes", "assumes", 9], "x")
    with pytest.raises(JsonSurgeryError):
        update_json_node_path(FIXTURE, "acc-999", ["graph_attributes", "type"], "x")


def test_9_wrong_type_at_path_safe_throw():
    # target is an object (graph_attributes) — scalar-only replacement refuses
    with pytest.raises(JsonSurgeryError):
        update_json_node_path(FIXTURE, "acc-001", ["graph_attributes"], "scalar")
    # mid-path descends into a scalar with a further key segment
    with pytest.raises(JsonSurgeryError):
        update_json_node_path(FIXTURE, "acc-001", ["graph_attributes", "type", "x"], "y")
    # index segment against an object container
    with pytest.raises(JsonSurgeryError):
        update_json_node_path(FIXTURE, "acc-001", ["graph_attributes", 0], "y")
