#!/usr/bin/env python3
"""t/3962 step 1: an LLM proposes pov_tags for Skeptic nodes, written in the side-file shape of spec §7 step 4.

This script never writes the data repo. It reads taxonomy/Origin/skeptic.json and writes a proposals file to --out
(default: ./out/). The proposals reach the data repo only through the review queue (t/3961) and an authorized
t/3969 batch.

Usage:
  python propose_tags.py --sample 12               # dry run: a category-stratified sample
  python propose_tags.py --all --out <file>        # every Skeptic node (paid run: needs PI authorization)
"""
import argparse, datetime, json, os, random, re, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", "..", ".."))
DATA = os.environ.get("AI_TRIAD_DATA_ROOT") or os.path.normpath(os.path.join(REPO, "..", "ai-triad-data"))
REGISTRY = os.path.join(REPO, "lib", "debate", "soul-docs", "pov-tags.json")
PROMPT_FILE = os.path.join(HERE, "propose.prompt")
PROMPT_VERSION = "v1"


def allowed_tags():
    reg = json.load(open(REGISTRY, encoding="utf-8"))
    return [e["id"] for e in reg["povs"].get("skeptic", [])], reg["version"]


def parse(text):
    t = text.strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1].lstrip("json").strip()
    return json.loads(t[t.find("{"): t.rfind("}") + 1])


def validate(p, allowed):
    """Same rule as validatePovTags for one skeptic node: an array of registered, distinct ids."""
    tags = p.get("proposed")
    if not isinstance(tags, list) or any(t not in allowed for t in tags) or len(set(tags)) != len(tags):
        return f"invalid proposed {tags!r}"
    c = p.get("confidence")
    if not isinstance(c, (int, float)) or not 0 <= c <= 1:
        return f"invalid confidence {c!r}"
    return None


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--sample", type=int)
    g.add_argument("--all", action="store_true")
    g.add_argument("--ids", help="comma-separated node ids (t/4036: nodes added after the full run)")
    ap.add_argument("--ticket", default="t/3962", help="ticket recorded in run.ticket")
    ap.add_argument("--model", default="gemini-3.8-flash")
    ap.add_argument("--seed", type=int, default=3962)
    ap.add_argument("--out", default=os.path.join(HERE, "out", "pov-tag-proposals.sample.json"))
    a = ap.parse_args()

    allowed, reg_version = allowed_tags()
    if sorted(allowed) != ["critical", "institutional"]:
        sys.exit(f"ABORT: registry skeptic tags are {allowed}; this prompt is written for critical/institutional")
    nodes = json.load(open(os.path.join(DATA, "taxonomy", "Origin", "skeptic.json"), encoding="utf-8"))["nodes"]
    if a.ids:
        want = [i.strip() for i in a.ids.split(",") if i.strip()]
        have = {n["id"] for n in nodes}
        missing = [i for i in want if i not in have]
        if missing:
            sys.exit(f"ABORT: not Skeptic node ids in {DATA}: {missing}")
        nodes = [n for n in nodes if n["id"] in set(want)]
    if a.sample:
        rnd = random.Random(a.seed)
        by_cat = {}
        for n in nodes: by_cat.setdefault(n["category"], []).append(n)
        per = max(1, a.sample // len(by_cat))
        nodes = [n for cat in sorted(by_cat) for n in rnd.sample(by_cat[cat], min(per, len(by_cat[cat])))]

    import google.generativeai as genai
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model = genai.GenerativeModel(a.model, generation_config={"temperature": 0.0, "response_mime_type": "application/json"})
    template = open(PROMPT_FILE, encoding="utf-8").read()

    # Checkpoint/resume: every proposal is appended to <out>.partial.jsonl the moment it lands, so a killed run
    # loses at most the call in flight. A restart with the same --out skips nodes already in the checkpoint.
    # (The first full run was reaped under memory pressure after ~32 min and lost everything: t/3962.)
    ckpt = a.out + ".partial.jsonl"
    order = {n["id"]: i for i, n in enumerate(nodes)}  # final file keeps taxonomy order even after a resume
    out, failures, done = [], [], set()
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    if os.path.exists(ckpt):
        for line in open(ckpt, encoding="utf-8"):
            if line.strip():
                rec = json.loads(line)
                if "error" not in rec:  # only successes count as done; a recorded failure is retried
                    out.append(rec)
                    done.add(rec["node_id"])
        print(f"resuming: {len(done)} nodes already proposed in {os.path.basename(ckpt)}", flush=True)
    ck = open(ckpt, "a", encoding="utf-8", newline="")

    def checkpoint(rec):
        ck.write(json.dumps(rec, ensure_ascii=False) + "\n")
        ck.flush()
        os.fsync(ck.fileno())

    for n in nodes:
        if n["id"] in done:
            continue
        prompt =(template.replace("{{ID}}", n["id"]).replace("{{CATEGORY}}", n["category"])
                  .replace("{{LABEL}}", n["label"]).replace("{{DESCRIPTION}}", n["description"]))
        for attempt in range(3):
            try:
                p = parse(model.generate_content(prompt).text)
                err = validate(p, allowed)
                if err: raise ValueError(err)
                break
            except Exception as e:  # retry, then record the failure (never silently drop a node)
                if attempt == 2:
                    failures.append({"node_id": n["id"], "error": str(e)[:200]})
                    checkpoint(failures[-1])
                    p = None
                else:
                    time.sleep(2 * (attempt + 1))
        if p is None:
            continue
        out.append({"node_id": n["id"], "proposed": p["proposed"], "confidence": round(float(p["confidence"]), 2),
                    "rationale": p.get("rationale", ""), "crux": p.get("crux"),
                    "status": "pending", "final": None, "reviewed_by": None, "reviewed_at": None})
        checkpoint(out[-1])
        print(f"{n['id']:18} {str(p['proposed']):34} {p.get('crux')!s:5} {p['confidence']:.2f}", flush=True)

    doc = {"version": 1, "registry_version": reg_version,
           "run": {"ticket": a.ticket, "model": a.model, "prompt_version": PROMPT_VERSION,
                   "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                   "scope": "all" if a.all else (f"ids {a.ids}" if a.ids else f"sample {a.sample} (seed {a.seed})"),
                   "failures": failures},
           "proposals": sorted(out, key=lambda r: order.get(r["node_id"], len(order)))}
    ck.close()
    open(a.out, "w", encoding="utf-8", newline="").write(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
    # The final file is complete only when every node has a proposal; keep the checkpoint otherwise, so a
    # rerun retries just the failures.
    if not failures and {r["node_id"] for r in out} >= {n["id"] for n in nodes}:
        os.remove(ckpt)
    split = {}
    for p in out: split[tuple(sorted(p["proposed"]))] = split.get(tuple(sorted(p["proposed"])), 0) + 1
    print(f"\n{len(out)} proposed, {len(failures)} failed -> {a.out}")
    print("split:", {("+".join(k) or "untagged"): v for k, v in sorted(split.items())})


if __name__ == "__main__":
    main()
