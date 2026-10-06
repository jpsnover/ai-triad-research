#!/usr/bin/env python3
"""Tests for render_soul_md.py, the JSON -> Markdown soul view renderer (t/3956).

The .md views are generated, and the JSON is the source of truth. Before the renderer existed, the views were
hand-edited and drifted (skeptic.soul.md kept a stock example its JSON had dropped, t/3932). These tests pin
that every committed view matches its JSON, and that --check really fails on a stale view. Pure: they read
only lib/debate/soul-docs from this repo, so they run in CI without the data repo (t/3940)."""
import glob
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_SCRIPT = os.path.join(_HERE, "render_soul_md.py")
_SOUL_DIR = os.path.normpath(os.path.join(_HERE, "..", "..", "..", "lib", "debate", "soul-docs"))


def _load_module():
    spec = importlib.util.spec_from_file_location("render_soul_md", _SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _run(*args):
    return subprocess.run([sys.executable, _SCRIPT, *args], capture_output=True, text=True, encoding="utf-8")


def test_every_committed_view_matches_its_json():
    """--check over the real soul-docs folder: no committed .soul.md has drifted from its JSON."""
    souls = glob.glob(os.path.join(_SOUL_DIR, "*.soul.json"))
    assert len(souls) >= 5, f"expected the 3 POV souls plus the tag souls, found {len(souls)}"
    r = _run("--check")
    assert r.returncode == 0, f"stale views: {r.stdout}{r.stderr}"
    assert "stale: none" in r.stdout


def test_check_fails_on_a_stale_view_and_writes_nothing():
    """The refusing arm: edit one view by hand and --check must exit 1, name it, and leave it alone."""
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(_SOUL_DIR, "skeptic.critical.soul.json")
        js = os.path.join(tmp, "skeptic.critical.soul.json")
        md = os.path.join(tmp, "skeptic.critical.soul.md")
        shutil.copy(src, js)
        shutil.copy(src[: -len(".json")] + ".md", md)
        with open(md, "a", encoding="utf-8", newline="") as f:
            f.write("hand edit\n")
        before = open(md, encoding="utf-8", newline="").read()
        r = _run("--check", js)
        assert r.returncode == 1
        assert "skeptic.critical.soul.md" in r.stdout
        assert open(md, encoding="utf-8", newline="").read() == before


def test_regenerate_repairs_a_stale_view():
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(_SOUL_DIR, "skeptic.institutional.soul.json")
        js = os.path.join(tmp, "skeptic.institutional.soul.json")
        md = os.path.join(tmp, "skeptic.institutional.soul.md")
        shutil.copy(src, js)
        with open(md, "w", encoding="utf-8", newline="") as f:
            f.write("stale\n")
        assert _run(js).returncode == 0
        assert _run("--check", js).returncode == 0
        assert open(md, encoding="utf-8", newline="").read() == open(src[: -len(".json")] + ".md", encoding="utf-8", newline="").read()


def test_tag_soul_header_names_pov_and_tag():
    """A tag soul's view keeps the POV identity in its title and header (tags never change who speaks)."""
    mod = _load_module()
    doc = json.load(open(os.path.join(_SOUL_DIR, "skeptic.critical.soul.json"), encoding="utf-8"))
    out = mod.render(doc, "skeptic.critical.soul.json")
    assert out.startswith("# Skeptic · Critical — Soul Document\n")
    assert "**POV:** `skeptic`" in out and "**Tag:** `critical`" in out


def test_base_soul_has_no_tag_line():
    mod = _load_module()
    doc = json.load(open(os.path.join(_SOUL_DIR, "safetyist.soul.json"), encoding="utf-8"))
    out = mod.render(doc, "safetyist.soul.json")
    assert "**Tag:**" not in out
    assert all(b in out for b in doc["boundaries"]["hardcoded"])
