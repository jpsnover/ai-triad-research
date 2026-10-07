#!/usr/bin/env python3
"""t/4066: ground each PROPOSED pov_tag in that wing's soul-document Value Hierarchy (a justify pass, not a re-proposal).

The proposed tags stay fixed. For each proposed tag the model names the one Value Hierarchy element the node expresses
(`vh_index`, 1-based) plus a one-sentence `why`, or `vh_index: null` when no element genuinely applies (an
"unsupported" tag: a review signal). Untagged items get `value_basis: []` plus a `value_basis_nearest` note.

This script never writes the data repo. It reads the COMMITTED side file and skeptic.json from data origin/main
(`git show`, never the shared working tree, which may hold uncommitted reviews) and writes a local file to --out.
The data write is a separate, authorized /data-mutation step (t/4066#1, item 3).

Usage:
  python justify_tags.py --sample 12            # trial: 2 items from each review group (paid; tiny)
  python justify_tags.py --all --out <file>     # every item (paid run: PI authorization t/4066#1 item 2)
"""
import argparse, datetime, hashlib, json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", "..", ".."))
DATA = os.environ.get("AI_TRIAD_DATA_ROOT") or os.path.normpath(os.path.join(REPO, "..", "ai-triad-data"))
SOULS = os.path.join(REPO, "lib", "debate", "soul-docs")
PROMPT_FILE = os.path.join(HERE, "justify.prompt")
PROMPT_VERSION = "justify-v3"  # v2 (PI, t/4066#3): "both" items cite the base skeptic.soul.json shared element.
# v3 (PI, t/4066#5): every element that applies (a set), run twice; combine_runs.py keeps firm vs uncertain.
SIDE = "taxonomy/Origin/pov-tag-proposals.json"
WINGS = ("critical", "institutional")


def git_show(rev_path):
    r = subprocess.run(["git", "-C", DATA, "show", rev_path], capture_output=True)
    if r.returncode != 0:
        sys.exit(f"ABORT: git show {rev_path} failed in {DATA}: {r.stderr.decode('utf-8', 'replace')[:200]}")
    return r.stdout


def sha(b):
    return hashlib.sha256(b).hexdigest()


def parse(text):
    t = text.strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1].lstrip("json").strip()
    return json.loads(t[t.find("{"): t.rfind("}") + 1])


def norm_idx(v):
    """v3 (PI, t/4066#5): vh_index is a set of elements. Accept a list or a bare int; return a sorted unique list,
    or None for "no element applies" (an empty list is treated as None, never as a silent pass)."""
    if v is None:
        return None
    if isinstance(v, int) and not isinstance(v, bool):
        v = [v]
    if not isinstance(v, list) or any(not isinstance(i, int) or isinstance(i, bool) for i in v):
        raise ValueError(f"vh_index {v!r} is not a list of ints")
    return sorted(set(v)) or None


def idx_ok(v, n):
    return v is None or all(1 <= i <= n for i in v)


def validate(p, proposed, vh):
    """One basis entry per proposed tag, same tags, every vh_index in range (or null), a non-empty why."""
    basis = p.get("basis")
    if not isinstance(basis, list):
        return "basis is not a list"
    if sorted(b.get("tag") for b in basis) != sorted(proposed):
        return f"basis tags {[b.get('tag') for b in basis]} != proposed {proposed}"
    for b in basis:
        i = norm_idx(b.get("vh_index"))
        if not idx_ok(i, len(vh[b["tag"]])):
            return f"vh_index {i!r} out of range for {b['tag']}"
        if not isinstance(b.get("why"), str) or not b["why"].strip():
            return f"empty why for {b['tag']}"
    s = p.get("shared")
    if sorted(proposed) == list(WINGS):
        if not isinstance(s, dict):
            return "both-tagged node without a shared entry"
        i = norm_idx(s.get("vh_index"))
        if not idx_ok(i, len(vh["shared"])):
            return f"shared vh_index {i!r} out of range"
        if not isinstance(s.get("why"), str) or not s["why"].strip():
            return "empty shared why"
    if not proposed:
        n = p.get("nearest")
        if n is not None:
            t, i = n.get("tag"), n.get("vh_index")
            if t is not None and t not in WINGS:
                return f"nearest tag {t!r}"
            if i is not None and (t is None or not isinstance(i, int) or not 1 <= i <= len(vh[t])):
                return f"nearest vh_index {i!r}"
    return None


def review_tier(item):
    """Same grouping as the t/4052 queue (t/4052#2): 1 untagged, 2 no-crux tagged, 3 Desires incl. critical, 4 rest."""
    if not item["proposed"]:
        return 1
    if item.get("crux") is None:
        return 2
    if "-desires-" in item["node_id"] and "critical" in item["proposed"]:
        return 3
    return 4


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--sample", type=int, help="trial: about N items spread across the review groups and labels")
    g.add_argument("--all", action="store_true")
    g.add_argument("--ids", help="comma-separated node ids")
    ap.add_argument("--model", default="gemini-3.8-flash")
    ap.add_argument("--out", default=os.path.join(HERE, "out", "value-basis.sample.json"))
    a = ap.parse_args()

    base_head = subprocess.run(["git", "-C", DATA, "rev-parse", "origin/main"], capture_output=True, text=True).stdout.strip()
    side_raw = git_show(f"origin/main:{SIDE}")
    side = json.loads(side_raw)
    nodes = {n["id"]: n for n in json.loads(git_show("origin/main:taxonomy/Origin/skeptic.json"))["nodes"]}
    vh, soul_sha = {}, {}
    for w in WINGS:
        raw = open(os.path.join(SOULS, f"skeptic.{w}.soul.json"), "rb").read()
        vh[w], soul_sha[w] = json.loads(raw)["value_hierarchy"], sha(raw)
        if not vh[w]:
            sys.exit(f"ABORT: empty value_hierarchy in skeptic.{w}.soul.json")
    raw = open(os.path.join(SOULS, "skeptic.soul.json"), "rb").read()  # the camp's shared hierarchy
    vh["shared"], soul_sha["shared"] = json.loads(raw)["value_hierarchy"], sha(raw)
    if not vh["shared"]:
        sys.exit("ABORT: empty value_hierarchy in skeptic.soul.json")

    items = [p for p in side["proposals"] if p["node_id"].startswith("skp-")]
    missing = [p["node_id"] for p in items if p["node_id"] not in nodes]
    if missing:
        sys.exit(f"ABORT: side-file ids not in skeptic.json at origin/main: {missing[:10]}")
    if a.ids:
        want = {i.strip() for i in a.ids.split(",") if i.strip()}
        unknown = want - {p["node_id"] for p in items}
        if unknown:
            sys.exit(f"ABORT: not in the side file: {sorted(unknown)}")
        items = [p for p in items if p["node_id"] in want]
    elif a.sample:
        # Two from each review group, then fill with single-label items so every proposed shape is exercised.
        picked, seen = [], set()
        def take(pred, k):
            for p in items:
                if k == 0: break
                if p["node_id"] not in seen and pred(p):
                    picked.append(p); seen.add(p["node_id"]); k -= 1
        for t in (1, 2, 3):
            take(lambda p, t=t: review_tier(p) == t, 2)
        take(lambda p: review_tier(p) == 4 and p["proposed"] == ["critical"], 2)
        take(lambda p: review_tier(p) == 4 and p["proposed"] == ["institutional"], 2)
        take(lambda p: review_tier(p) == 4 and sorted(p["proposed"]) == list(WINGS), 2)
        items = picked[: max(a.sample, len(picked))]

    import google.generativeai as genai
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model = genai.GenerativeModel(a.model, generation_config={"temperature": 0.0, "response_mime_type": "application/json"})
    numbered = {w: "\n".join(f"{i}. {t}" for i, t in enumerate(vh[w], 1)) for w in (*WINGS, "shared")}
    template = (open(PROMPT_FILE, encoding="utf-8").read().replace("{{VH_SHARED}}", numbered["shared"])
                .replace("{{VH_CRITICAL}}", numbered["critical"]).replace("{{VH_INSTITUTIONAL}}", numbered["institutional"]))

    # Checkpoint/resume, as in propose_tags.py: each result is appended and fsynced the moment it lands.
    ckpt = a.out + ".partial.jsonl"
    order = {p["node_id"]: i for i, p in enumerate(items)}
    out, failures, done = [], [], set()
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    if os.path.exists(ckpt):
        for line in open(ckpt, encoding="utf-8"):
            if line.strip():
                rec = json.loads(line)
                if "error" not in rec:
                    out.append(rec); done.add(rec["node_id"])
        print(f"resuming: {len(done)} items already justified in {os.path.basename(ckpt)}", flush=True)
    ck = open(ckpt, "a", encoding="utf-8", newline="")

    def checkpoint(rec):
        ck.write(json.dumps(rec, ensure_ascii=False) + "\n"); ck.flush(); os.fsync(ck.fileno())

    for item in items:
        nid, proposed = item["node_id"], item["proposed"]
        if nid in done:
            continue
        n = nodes[nid]
        prompt = (template.replace("{{ID}}", nid).replace("{{CATEGORY}}", n["category"])
                  .replace("{{LABEL}}", n["label"]).replace("{{DESCRIPTION}}", n["description"])
                  .replace("{{PROPOSED}}", json.dumps(proposed)))
        p = None
        for attempt in range(3):
            try:
                p = parse(model.generate_content(prompt).text)
                err = validate(p, proposed, vh)
                if err: raise ValueError(err)
                break
            except Exception as e:  # retry, then record the failure (never silently drop an item)
                p = None
                if attempt == 2:
                    failures.append({"node_id": nid, "error": str(e)[:200]}); checkpoint(failures[-1])
                else:
                    time.sleep(2 * (attempt + 1))
        if p is None:
            continue
        texts = lambda hier, idx: [hier[i - 1] for i in idx] if idx else None
        basis = []
        for b in sorted(p["basis"], key=lambda b: WINGS.index(b["tag"])):
            idx = norm_idx(b.get("vh_index"))
            basis.append({"tag": b["tag"], "vh_index": idx, "vh_text": texts(vh[b["tag"]], idx), "why": b["why"].strip()})
        rec = {"node_id": nid, "value_basis": basis}
        if sorted(proposed) == list(WINGS):
            s = p["shared"]
            idx = norm_idx(s.get("vh_index"))
            rec["value_basis_shared"] = {"vh_index": idx, "vh_text": texts(vh["shared"], idx), "why": s["why"].strip()}
        if not proposed:
            nr = p.get("nearest") or {}
            rec["value_basis_nearest"] = {"tag": nr.get("tag"), "vh_index": nr.get("vh_index"),
                                          "vh_text": vh[nr["tag"]][nr["vh_index"] - 1] if nr.get("tag") and nr.get("vh_index") else None,
                                          "why": (nr.get("why") or "").strip()}
        out.append(rec); checkpoint(rec)
        show = "; ".join(f"{b['tag']}:{b['vh_index']}" for b in basis)
        if "value_basis_shared" in rec:
            show += f"; shared:{rec['value_basis_shared']['vh_index']}"
        show = show or f"none (nearest {rec.get('value_basis_nearest', {}).get('tag')}:{rec.get('value_basis_nearest', {}).get('vh_index')})"
        print(f"{nid:20} {str(proposed):34} {show}", flush=True)

    doc = {"value_basis_run": {"ticket": "t/4066", "model": a.model, "prompt_version": PROMPT_VERSION,
                               "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                               "scope": "all" if a.all else (f"ids {a.ids}" if a.ids else f"sample {a.sample}"),
                               "base_commit": base_head, "base_side_file_sha256": sha(side_raw),
                               "soul_doc_sha256": soul_sha, "failures": failures},
           "items": sorted(out, key=lambda r: order.get(r["node_id"], len(order)))}
    ck.close()
    open(a.out, "w", encoding="utf-8", newline="").write(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
    if not failures and {r["node_id"] for r in out} >= {p["node_id"] for p in items}:
        os.remove(ckpt)
    unsupported = sum(1 for r in out for b in r["value_basis"] if b["vh_index"] is None)
    by_el = {}
    for r in out:
        for b in r["value_basis"]:
            for i in (b["vh_index"] or [None]):
                k = f"{b['tag']}:{i}"; by_el[k] = by_el.get(k, 0) + 1
    print(f"\n{len(out)} justified, {len(failures)} failed, {unsupported} unsupported tag(s) -> {a.out}")
    print("by element:", dict(sorted(by_el.items())))


if __name__ == "__main__":
    main()
