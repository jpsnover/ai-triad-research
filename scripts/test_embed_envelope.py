#!/usr/bin/env python3

# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""Unit tests for embed_taxonomy.py's provenance envelope builder (t/1994).

Verifies that the embeddings.json envelope stamps encoder-stack versions and a
composition descriptor without needing a full model encode. Runnable under
pytest or standalone: `python test_embed_envelope.py`.
"""

import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "embed_taxonomy", Path(__file__).resolve().parent / "embed_taxonomy.py"
)
embed_taxonomy = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(embed_taxonomy)


def test_envelope_stamps_encoder_versions_and_composition():
    """The envelope carries version stamps + a composition descriptor."""
    env = embed_taxonomy._build_envelope(
        model_name="all-MiniLM-L6-v2",
        dimension=384,
        weights=embed_taxonomy.DEFAULT_FIELD_WEIGHTS,
        generated_at="2026-07-30T00:00:00Z",
        nodes_dict={"acc-goal-001": {"pov": "acc", "vector": [0.0]}},
    )

    # Provenance stamps present and non-empty.
    assert env["sentence_transformers_version"]
    assert env["transformers_version"]
    assert isinstance(env["composition"], str) and env["composition"]

    # Composition descriptor records the recipe accurately.
    comp = env["composition"]
    assert "1/0/0/0/0" in comp  # the DEFAULT weights, rendered dynamically
    assert "single final L2 normalize" in comp
    assert "incl. Excludes" in comp  # description is verbatim, not Excludes-stripped

    # Existing envelope contract preserved.
    assert env["model"] == "all-MiniLM-L6-v2"
    assert env["dimension"] == 384
    assert env["node_count"] == 1
    assert env["field_weights"]["description"] == 1.0


def test_composition_descriptor_reflects_actual_weights():
    """A non-default weight vector is echoed in the descriptor, not hardcoded."""
    comp = embed_taxonomy._composition_descriptor((0.67, 0.33, 0.0, 0.0, 0.0))
    assert "0.67/0.33" in comp


def test_package_version_unknown_for_missing_package():
    """Unresolvable packages degrade to 'unknown', never raise."""
    assert embed_taxonomy._package_version("no-such-package-xyz-1994") == "unknown"


if __name__ == "__main__":
    test_envelope_stamps_encoder_versions_and_composition()
    test_composition_descriptor_reflects_actual_weights()
    test_package_version_unknown_for_missing_package()
    print("OK: all embed_taxonomy envelope tests passed")
