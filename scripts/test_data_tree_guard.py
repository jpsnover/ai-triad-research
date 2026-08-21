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

import importlib.util
import os
import subprocess
import tempfile
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "data_tree_guard", Path(__file__).resolve().parent / "data_tree_guard.py"
)
data_tree_guard = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(data_tree_guard)

assert_clean_data_tree = data_tree_guard.assert_clean_data_tree
is_data_tree_clean = data_tree_guard.is_data_tree_clean
DirtyTreeError = data_tree_guard.DirtyTreeError


def _make_repo(root: Path) -> Path:
    """Init a throwaway git repo with one committed, clean file; return its path.

    Identity + signing are set LOCAL to this fixture repo only (CI has no signing
    key) — it is a disposable fixture, not a project repo.
    """
    root.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "-C", str(root), "init", "--quiet"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.email", "fixture@example.com"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.name", "Fixture"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "commit.gpgsign", "false"], check=True)
    f = root / "data.json"
    f.write_text('{ "stance": "aligned" }\n', encoding="utf-8")
    subprocess.run(["git", "-C", str(root), "add", "data.json"], check=True)
    subprocess.run(["git", "-C", str(root), "commit", "--quiet", "-m", "seed"], check=True)
    return f


def test_clean_arm_committed_file_is_clean():
    with tempfile.TemporaryDirectory() as tmp:
        f = _make_repo(Path(tmp) / "clean")
        assert is_data_tree_clean(f) is True
        assert_clean_data_tree(f)  # must not raise


def test_dirty_arm_uncommitted_change_blocks():
    with tempfile.TemporaryDirectory() as tmp:
        f = _make_repo(Path(tmp) / "dirty")
        f.write_text('{ "stance": "strongly_opposed", "sit-477": true }\n', encoding="utf-8")
        assert is_data_tree_clean(f) is False
        raised = False
        try:
            assert_clean_data_tree(f)
        except DirtyTreeError as exc:
            raised = True
            assert "uncommitted changes" in str(exc)
        assert raised, "expected DirtyTreeError on a dirty target"


def test_force_downgrades_to_warning():
    with tempfile.TemporaryDirectory() as tmp:
        f = _make_repo(Path(tmp) / "force")
        f.write_text("mutated\n", encoding="utf-8")
        assert_clean_data_tree(f, force=True)  # must not raise


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
