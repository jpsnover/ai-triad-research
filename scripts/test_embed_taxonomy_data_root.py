#!/usr/bin/env python3

# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""Regression tests for t/3898: embed_taxonomy.py's data-root resolution must
honour AI_TRIAD_DATA_ROOT first, matching Get-DataRoot (PS)'s documented
priority (root AGENTS.md, Two-Repo Split): env var > .aitriad.json > fallback.

Pure — no model encode — so both arms run fast under pytest or standalone:
`python test_embed_taxonomy_data_root.py`.
"""

import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "embed_taxonomy", Path(__file__).resolve().parent / "embed_taxonomy.py"
)
embed_taxonomy = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(embed_taxonomy)

_SAVED_ENV_KEY = "AI_TRIAD_DATA_ROOT"


def _save_state():
    return (
        embed_taxonomy.TAXONOMY_DIR,
        embed_taxonomy.EMBEDDINGS_FILE,
        embed_taxonomy.CONFLICTS_DIR,
        embed_taxonomy.DATA_ROOT,
        os.environ.get(_SAVED_ENV_KEY),
    )


def _restore_state(saved):
    (
        embed_taxonomy.TAXONOMY_DIR,
        embed_taxonomy.EMBEDDINGS_FILE,
        embed_taxonomy.CONFLICTS_DIR,
        embed_taxonomy.DATA_ROOT,
    ) = saved[:4]
    if saved[4] is None:
        os.environ.pop(_SAVED_ENV_KEY, None)
    else:
        os.environ[_SAVED_ENV_KEY] = saved[4]


def test_env_var_wins_over_aitriad_json():
    """ARM 1: AI_TRIAD_DATA_ROOT set + .aitriad.json pointing elsewhere -> resolves to the env dir."""
    saved = _save_state()
    try:
        with tempfile.TemporaryDirectory() as env_dir, tempfile.TemporaryDirectory() as cfg_data_dir:
            # .aitriad.json lives next to the script and points at a DIFFERENT dir than env_dir.
            # Read/write in BINARY mode for the backup/restore round-trip -- text mode
            # normalizes line endings (CRLF -> LF), which would leave the real repo file
            # byte-different after this test runs even though its JSON content is identical.
            cfg_path = Path(embed_taxonomy._SCRIPT_DIR.parent) / ".aitriad.json"
            cfg_existed = cfg_path.exists()
            cfg_backup = cfg_path.read_bytes() if cfg_existed else None
            try:
                cfg_path.write_text(json.dumps({"data_root": str(cfg_data_dir)}), encoding="utf-8")
                os.environ[_SAVED_ENV_KEY] = env_dir
                resolved, cfg = embed_taxonomy._resolve_data_root()
                assert resolved == Path(env_dir).resolve(), f"expected env dir, got {resolved}"
                assert cfg is not None, "config should still be read (for taxonomy_dir/conflicts_dir), just not for the root"
            finally:
                if cfg_existed:
                    cfg_path.write_bytes(cfg_backup)
                else:
                    cfg_path.unlink(missing_ok=True)
    finally:
        _restore_state(saved)


def test_env_unset_falls_back_to_aitriad_json_then_default():
    """ARM 2 (regression): env unset -> .aitriad.json -> default, unchanged from pre-t/3898 behavior."""
    saved = _save_state()
    try:
        os.environ.pop(_SAVED_ENV_KEY, None)
        resolved, cfg = embed_taxonomy._resolve_data_root()
        # Whatever wins (real .aitriad.json or the script-parent fallback), it must NOT be
        # influenced by a stale env var, and must be an existing, resolved absolute path.
        assert resolved.is_absolute()
    finally:
        _restore_state(saved)


def test_resolve_taxonomy_dir_sets_data_root_from_env():
    """The public entry point (_resolve_taxonomy_dir) exposes DATA_ROOT from the env var."""
    saved = _save_state()
    try:
        with tempfile.TemporaryDirectory() as env_dir:
            os.environ[_SAVED_ENV_KEY] = env_dir
            embed_taxonomy._resolve_taxonomy_dir()
            assert embed_taxonomy.DATA_ROOT == Path(env_dir).resolve()
            assert embed_taxonomy.TAXONOMY_DIR == (Path(env_dir).resolve() / "taxonomy" / "Origin")
    finally:
        _restore_state(saved)


def test_taxonomy_dir_override_still_wins_over_env_var():
    """--taxonomy-dir remains the highest-priority override, even with the env var set (per ticket)."""
    saved = _save_state()
    try:
        with tempfile.TemporaryDirectory() as env_dir, tempfile.TemporaryDirectory() as override_dir:
            os.environ[_SAVED_ENV_KEY] = env_dir
            embed_taxonomy._resolve_taxonomy_dir(override=override_dir)
            assert embed_taxonomy.TAXONOMY_DIR == Path(override_dir).resolve()
            # DATA_ROOT still reflects the env var (used for conflicts_dir resolution).
            assert embed_taxonomy.DATA_ROOT == Path(env_dir).resolve()
    finally:
        _restore_state(saved)


def test_parity_with_get_dataroot():
    """PARITY: under the same env, Python's DATA_ROOT must match Get-DataRoot (PS) exactly.

    Skipped (not failed) if pwsh isn't on PATH, so the suite stays runnable without
    PowerShell installed.
    """
    pwsh = shutil.which("pwsh")
    if not pwsh:
        print("SKIP: pwsh not found on PATH -- parity check not run")
        return

    saved = _save_state()
    try:
        with tempfile.TemporaryDirectory() as env_dir:
            os.environ[_SAVED_ENV_KEY] = env_dir
            py_root, _ = embed_taxonomy._resolve_data_root()

            repo_root = embed_taxonomy._SCRIPT_DIR.parent
            module_path = repo_root / "scripts" / "AITriad" / "AITriad.psd1"
            # Get-DataRoot is a Private (non-exported) function -- invoke it inside the
            # module's own scope via the module object's call operator. -WarningAction
            # SilentlyContinue on the import, PLUS taking only the LAST non-empty stdout
            # line: module import can emit incidental warning/host noise (e.g. "no valid
            # JSON files loaded") that lands in the captured stdout alongside the real
            # return value under non-interactive pwsh -Command.
            ps_cmd = (
                f"Import-Module '{module_path}' -Force -WarningAction SilentlyContinue -ErrorAction Stop; "
                f"& (Get-Module AITriad) {{ Get-DataRoot }}"
            )
            result = subprocess.run(
                [pwsh, "-NoProfile", "-Command", ps_cmd],
                capture_output=True,
                text=True,
                env=os.environ.copy(),
                timeout=60,
            )
            assert result.returncode == 0, f"pwsh Get-DataRoot failed: {result.stderr}"
            stdout_lines = [ln.strip() for ln in result.stdout.splitlines() if ln.strip()]
            assert stdout_lines, f"pwsh produced no usable output: stdout={result.stdout!r} stderr={result.stderr!r}"
            ps_root = Path(stdout_lines[-1])
            assert py_root == ps_root, f"PARITY MISMATCH: python={py_root} vs Get-DataRoot={ps_root}"
    finally:
        _restore_state(saved)


if __name__ == "__main__":
    test_env_var_wins_over_aitriad_json()
    test_env_unset_falls_back_to_aitriad_json_then_default()
    test_resolve_taxonomy_dir_sets_data_root_from_env()
    test_taxonomy_dir_override_still_wins_over_env_var()
    test_parity_with_get_dataroot()
    print("OK: all t/3898 data-root-resolution tests passed")
