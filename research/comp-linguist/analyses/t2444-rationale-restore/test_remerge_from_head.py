#!/usr/bin/env python3
"""Both-arms proof for remerge_from_head.py.

A deliberate failure must fire the refusal; the clean case must pass with zero noise.
Builds throwaway git repos so the real code path (including `git show`) is exercised.
"""
import json, os, shutil, subprocess, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from remerge_from_head import serialize  # noqa: E402

TOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "remerge_from_head.py")
ENV = dict(os.environ, MSYS_NO_PATHCONV="1")


def edge(src, typ, tgt, conf, disc, model, rat=None):
    e = {"source": src, "target": tgt, "type": typ, "bidirectional": False,
         "confidence": conf, "weight": conf, "discovered_at": disc, "model": model}
    if rat is not None:
        # match the live layout: rationale sits immediately after confidence
        out = {}
        for k, v in e.items():
            out[k] = v
            if k == "confidence":
                out["rationale"] = rat
        return out
    return e


def doc(edges):
    return {"_schema_version": "1.0.0", "last_modified": "2026-08-20T00:00:00.000Z",
            "edges": edges}


def make_repo(tmp, head_edges, wt_edges):
    repo = tempfile.mkdtemp(dir=tmp)
    os.makedirs(os.path.join(repo, "taxonomy", "Origin"))
    path = os.path.join(repo, "taxonomy", "Origin", "edges.json")

    def write(edges):
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(serialize(doc(edges)))

    q = dict(capture_output=True, cwd=repo, env=ENV)
    subprocess.run(["git", "init", "-q"], **q)
    subprocess.run(["git", "config", "user.email", "t@t"], **q)
    subprocess.run(["git", "config", "user.name", "t"], **q)
    subprocess.run(["git", "config", "core.autocrlf", "false"], **q)
    write(head_edges)
    subprocess.run(["git", "add", "-A"], **q)
    subprocess.run(["git", "commit", "-qm", "head"], **q)
    write(wt_edges)
    return repo, path


def run(repo):
    return subprocess.run([sys.executable, TOOL, "--data-repo", repo, "--write-in-place"],
                          capture_output=True, text=True, env=ENV)


failures = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


tmp = tempfile.mkdtemp()
try:
    # ---- ARM 1 (positive): stripped rationales re-merge; appended edge preserved -------
    print("\nARM 1 -- positive: strip 2, append 1")
    head = [edge("a", "SUPPORTS", "b", 0.9, "2026-01-01", "m1", "rat-AB"),
            edge("c", "SUPPORTS", "d", 0.8, "2026-01-02", "m1", "rat-CD"),
            edge("e", "SUPPORTS", "f", 0.7, "2026-01-03", "m1")]
    wt = [edge("a", "SUPPORTS", "b", 0.9, "2026-01-01", "m1"),          # stripped
          edge("c", "SUPPORTS", "d", 0.8, "2026-01-02", "m1"),          # stripped
          edge("e", "SUPPORTS", "f", 0.7, "2026-01-03", "m1"),          # never had one
          edge("g", "SUPPORTS", "h", 0.6, "2026-02-01", "m2", "rat-GH")]  # appended by user
    repo, path = make_repo(tmp, head, wt)
    r = run(repo)
    print("   " + r.stdout.strip().replace("\n", "\n   "))
    check("exit 0", r.returncode == 0, r.stderr)
    check("re-merged=2", "re-merged=2" in r.stdout)
    check("strip-back proof PASS", "strip-back proof: PASS" in r.stdout)
    got = json.load(open(path, encoding="utf-8"))["edges"]
    check("AB rationale restored", got[0].get("rationale") == "rat-AB")
    check("CD rationale restored", got[1].get("rationale") == "rat-CD")
    check("EF still has none", "rationale" not in got[2])
    check("appended GH preserved with its rationale",
          len(got) == 4 and got[3]["source"] == "g" and got[3]["rationale"] == "rat-GH")
    check("rationale inserted after confidence",
          list(got[0].keys()).index("rationale") == list(got[0].keys()).index("confidence") + 1)

    # ---- ARM 2 (negative): ambiguous twin must refuse and write NOTHING ---------------
    print("\nARM 2 -- negative: ambiguous twin (same key, same discovered_at+model)")
    head = [edge("a", "SUPPORTS", "b", 0.9, "2026-01-01", "m1", "rat-TWIN-1"),
            edge("a", "SUPPORTS", "b", 0.5, "2026-01-01", "m1", "rat-TWIN-2")]
    wt = [edge("a", "SUPPORTS", "b", 0.9, "2026-01-01", "m1"),
          edge("a", "SUPPORTS", "b", 0.5, "2026-01-01", "m1")]
    repo, path = make_repo(tmp, head, wt)
    before = open(path, encoding="utf-8", newline="").read()
    r = run(repo)
    print("   " + (r.stdout + r.stderr).strip().replace("\n", "\n   "))
    check("exit non-zero", r.returncode != 0)
    check("refused_ambiguous=2", "refused_ambiguous=2" in r.stdout)
    check("REFUSED logged", "REFUSED" in r.stdout)
    check("re-merged=0", "re-merged=0" in r.stdout)
    check("file left byte-identical (nothing written)",
          open(path, encoding="utf-8", newline="").read() == before)

    # ---- ARM 3 (twin, resolvable): distinct discovered_at/model -> correct attribution -
    print("\nARM 3 -- twin resolvable on discovered_at+model")
    head = [edge("a", "SUPPORTS", "b", 0.9, "2026-03-01", "gemini-2.5-flash", "rat-MARCH"),
            edge("a", "SUPPORTS", "b", 0.5, "2026-06-11", "llm_proposed", "rat-JUNE")]
    wt = [edge("a", "SUPPORTS", "b", 0.9, "2026-03-01", "gemini-2.5-flash"),
          edge("a", "SUPPORTS", "b", 0.5, "2026-06-11", "llm_proposed")]
    repo, path = make_repo(tmp, head, wt)
    r = run(repo)
    print("   " + r.stdout.strip().replace("\n", "\n   "))
    check("exit 0", r.returncode == 0, r.stderr)
    check("re-merged=2", "re-merged=2" in r.stdout)
    got = json.load(open(path, encoding="utf-8"))["edges"]
    check("March twin got the March rationale", got[0].get("rationale") == "rat-MARCH")
    check("June twin got the June rationale", got[1].get("rationale") == "rat-JUNE")

    # ---- ARM 4 (clean no-op): nothing to do, zero noise -------------------------------
    print("\nARM 4 -- clean: working tree already matches HEAD")
    head = [edge("a", "SUPPORTS", "b", 0.9, "2026-01-01", "m1", "rat-AB")]
    repo, path = make_repo(tmp, head, head)
    before = open(path, encoding="utf-8", newline="").read()
    r = run(repo)
    print("   " + r.stdout.strip().replace("\n", "\n   "))
    check("exit 0", r.returncode == 0, r.stderr)
    check("re-merged=0", "re-merged=0" in r.stdout)
    check("no refusals", "REFUSED" not in r.stdout)
    check("file unchanged", open(path, encoding="utf-8", newline="").read() == before)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print("\n" + ("ALL ARMS PASS" if not failures else f"FAILURES: {failures}"))
sys.exit(1 if failures else 0)
