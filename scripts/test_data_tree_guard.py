#!/usr/bin/env python3

# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""Both-arms tests for the t/2902 dirty-tree-sweep guard (Python side).

`assert_clean_data_tree` refuses a whole-file rewrite whose target already
carries uncommitted changes, so a `json.dump` round-trip can't sweep concurrent
working-tree state into the commit. Tested against a REAL temporary git repo
(no git mocking — the guard's whole job is reading real `git status`). Runs under
pytest or standalone: `python test_data_tree_guard.py`.
"""

import contextlib
import importlib.util
import io
import os
import subprocess
import tempfile
from pathlib import Path


@contextlib.contextmanager
def _guard_mode(mode):
    """Set $AI_TRIAD_DATA_WRITE_GUARD for the block, restoring the prior value
    afterward (pytest runs every test in one process — do not clobber)."""
    key = "AI_TRIAD_DATA_WRITE_GUARD"
    prev = os.environ.get(key)
    if mode is None:
        os.environ.pop(key, None)
    else:
        os.environ[key] = mode
    try:
        yield
    finally:
        if prev is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = prev

_SPEC = importlib.util.spec_from_file_location(
    "data_tree_guard", Path(__file__).resolve().parent / "data_tree_guard.py"
)
data_tree_guard = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(data_tree_guard)

assert_clean_data_tree = data_tree_guard.assert_clean_data_tree
is_data_tree_clean = data_tree_guard.is_data_tree_clean
DirtyTreeError = data_tree_guard.DirtyTreeError


def _make_repo(root: Path, name: str = "data.json") -> Path:
    """Init a throwaway git repo with one committed, clean file; return its path.
    ``name`` sets the basename (drives the t/2909 tier: BLOCK for a BLOCK-tier
    basename, WARN otherwise).

    Identity + signing are set LOCAL to this fixture repo only (CI has no signing
    key) — it is a disposable fixture, not a project repo.
    """
    root.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "-C", str(root), "init", "--quiet"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.email", "fixture@example.com"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.name", "Fixture"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "commit.gpgsign", "false"], check=True)
    f = root / name
    f.write_text('{ "stance": "aligned" }\n', encoding="utf-8")
    subprocess.run(["git", "-C", str(root), "add", name], check=True)
    subprocess.run(["git", "-C", str(root), "commit", "--quiet", "-m", "seed"], check=True)
    return f


def test_clean_arm_committed_file_is_clean():
    with tempfile.TemporaryDirectory() as tmp:
        f = _make_repo(Path(tmp) / "clean")
        assert is_data_tree_clean(f) is True
        assert_clean_data_tree(f)  # must not raise


def test_block_mode_dirty_raises():
    with tempfile.TemporaryDirectory() as tmp:
        f = _make_repo(Path(tmp) / "block")
        f.write_text('{ "stance": "strongly_opposed", "sit-477": true }\n', encoding="utf-8")
        assert is_data_tree_clean(f) is False
        raised = False
        with _guard_mode("Block"):
            try:
                assert_clean_data_tree(f)
            except DirtyTreeError as exc:
                raised = True
                assert "uncommitted changes" in str(exc)
        assert raised, "Block mode must raise DirtyTreeError on a dirty target"


def test_warn_mode_default_dirty_warns_without_raising():
    # Default (no env var) is warn-first: surface a stderr warning, do NOT raise —
    # mirrors the PowerShell guard so Python doesn't hard-block from day one (t/2902 GV).
    with tempfile.TemporaryDirectory() as tmp:
        f = _make_repo(Path(tmp) / "warn")
        f.write_text("mutated\n", encoding="utf-8")
        with _guard_mode(None):  # unset -> default warn
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                assert_clean_data_tree(f)  # must NOT raise
            assert "uncommitted changes" in err.getvalue()


def test_off_mode_dirty_noop():
    with tempfile.TemporaryDirectory() as tmp:
        f = _make_repo(Path(tmp) / "off")
        f.write_text("mutated\n", encoding="utf-8")
        with _guard_mode("Off"):
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                assert_clean_data_tree(f)  # no raise
            assert err.getvalue() == ""  # and no noise


def test_force_opts_out_even_in_block_mode():
    with tempfile.TemporaryDirectory() as tmp:
        f = _make_repo(Path(tmp) / "force")
        f.write_text("mutated\n", encoding="utf-8")
        with _guard_mode("Block"):
            assert_clean_data_tree(f, force=True)  # -AllowDirty equivalent: must not raise


def test_not_yet_existent_is_clean():
    with tempfile.TemporaryDirectory() as tmp:
        ghost = Path(tmp) / "does-not-exist.json"
        assert is_data_tree_clean(ghost) is True
        assert_clean_data_tree(ghost)  # must not raise


def test_non_git_path_does_not_block():
    with tempfile.TemporaryDirectory() as tmp:
        loose = Path(tmp) / "loose.json"
        loose.write_text("x\n", encoding="utf-8")  # tmp is not a git work tree
        assert is_data_tree_clean(loose) is True
        assert_clean_data_tree(loose)  # must not raise


def test_tier_block_file_raises_without_env():
    # t/2909: a BLOCK-tier basename (situations.json) raises on a dirty target with NO
    # env override — the tier decides.
    with tempfile.TemporaryDirectory() as tmp:
        f = _make_repo(Path(tmp) / "tb", name="situations.json")
        f.write_text("mutated\n", encoding="utf-8")
        raised = False
        with _guard_mode(None):  # no env -> per-target tier
            try:
                assert_clean_data_tree(f)
            except DirtyTreeError:
                raised = True
        assert raised, "BLOCK-tier situations.json must raise on a dirty target without env override"


def test_tier_warn_file_warns_without_env():
    # t/2909: a WARN-tier basename (high-traffic POV file) warns, does NOT raise, with
    # no env override.
    with tempfile.TemporaryDirectory() as tmp:
        f = _make_repo(Path(tmp) / "tw", name="accelerationist.json")
        f.write_text("mutated\n", encoding="utf-8")
        with _guard_mode(None):
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                assert_clean_data_tree(f)  # WARN tier -> no raise
            assert "uncommitted changes" in err.getvalue()


def test_env_override_wins_over_tier():
    # t/2909: env=block forces block even on a WARN-tier file.
    with tempfile.TemporaryDirectory() as tmp:
        f = _make_repo(Path(tmp) / "ov", name="accelerationist.json")
        f.write_text("mutated\n", encoding="utf-8")
        raised = False
        with _guard_mode("Block"):
            try:
                assert_clean_data_tree(f)
            except DirtyTreeError:
                raised = True
        assert raised, "env=Block must override the WARN tier"


if __name__ == "__main__":
    _tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in _tests:
        try:
            t()
            print(f"[+] {t.__name__}")
        except Exception as exc:  # noqa: BLE001 — standalone runner surfaces all
            failed += 1
            print(f"[-] {t.__name__}: {exc}")
    print(f"\n{len(_tests) - failed}/{len(_tests)} passed")
    raise SystemExit(1 if failed else 0)
