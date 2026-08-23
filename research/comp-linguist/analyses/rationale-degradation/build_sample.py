import argparse, json, re, subprocess, os, sys
import build_diff_controls   # t/2963 diff-mode controls — one regenerable pipeline

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))   # <repo>/research/comp-linguist/analyses/rationale-degradation
OUT = os.path.join(HERE, "labelled_sample.json")                     # relative — regenerable anywhere


def main_checkout_root():
    """The MAIN checkout root, which differs from REPO when running inside a linked worktree.

    A worktree lives at <main>/.claude/worktrees/<name>, so REPO-relative resolution of the
    `../ai-triad-data` sibling would point at <main>/.claude/worktrees/ai-triad-data — which does
    not exist. `git rev-parse --git-common-dir` resolves to the MAIN checkout's .git in both a
    worktree and a normal clone, so its parent is the right anchor for the sibling data repo.
    Returns None when git is unavailable or this is not a checkout at all.
    """
    try:
        # shell=False + tokenized argv (no shell metacharacter surface); bounded so a hung or
        # credential-prompting git cannot freeze sample regeneration indefinitely.
        out = subprocess.run(["git", "-C", REPO, "rev-parse", "--git-common-dir"],
                             capture_output=True, text=True, timeout=15)
        if out.returncode != 0 or not out.stdout.strip():
            return None
        common = out.stdout.strip()
        if not os.path.isabs(common):
            common = os.path.join(REPO, common)
        return os.path.abspath(os.path.join(common, os.pardir))
    except (OSError, subprocess.SubprocessError):
        # SubprocessError covers TimeoutExpired, which does NOT inherit from OSError; git being
        # absent/hung degrades to "no main-checkout anchor" rather than killing the regeneration.
        return None


def resolve_data_root(cli_value=None):
    """Data-root resolution, repo-relative and clean-checkout safe (t/2964 AC4).

    Priority mirrors the project convention (root AGENTS.md, "Two-Repo Split"):
    CLI --data-root > $AI_TRIAD_DATA_ROOT > .aitriad.json `data_root` > the `../ai-triad-data`
    sibling. The last two are each tried against BOTH the current tree and the main checkout root,
    and the first candidate that actually exists wins — so this resolves correctly from a linked
    worktree, where tree-relative paths point outside the real repo. No absolute path is baked in,
    so it runs from any clean checkout rather than only the authoring machine.

    Returns the first existing candidate; if none exists, returns the best guess so the caller can
    report a concrete path in its error.
    """
    if cli_value:
        return os.path.abspath(cli_value)
    env = os.environ.get("AI_TRIAD_DATA_ROOT")
    if env:
        return os.path.abspath(env)

    anchors = [REPO]
    main_root = main_checkout_root()
    if main_root and os.path.abspath(main_root) != os.path.abspath(REPO):
        anchors.append(main_root)

    candidates = []
    for anchor in anchors:
        cfg = os.path.join(anchor, ".aitriad.json")
        if os.path.isfile(cfg):
            try:
                with open(cfg, encoding="utf-8") as f:
                    rel = json.load(f).get("data_root")
                if rel:
                    candidates.append(os.path.abspath(os.path.join(anchor, rel)))
            except (OSError, ValueError):
                pass   # malformed config falls through to the sibling default rather than dying here
        candidates.append(os.path.abspath(os.path.join(anchor, os.pardir, "ai-triad-data")))

    for c in candidates:
        if os.path.isdir(c):
            return c
    return candidates[-1] if candidates else os.path.abspath(os.path.join(REPO, os.pardir, "ai-triad-data"))


_ap = argparse.ArgumentParser(description="Regenerate labelled_sample.json (t/2948 / t/2963 / t/2964 / t/2965)")
_ap.add_argument("--data-root", help="path to the ai-triad-data checkout (default: env / .aitriad.json / ../ai-triad-data)")
_args = _ap.parse_args()
DATA = resolve_data_root(_args.data_root)
if not os.path.isdir(DATA):
    sys.exit(f"data root not found: {DATA}\n"
             f"  Pass --data-root <path>, set AI_TRIAD_DATA_ROOT, or check .aitriad.json `data_root`.")

def edges_at(ref):
    return json.loads(subprocess.run(["git","-C",DATA,"show",f"{ref}:taxonomy/Origin/edges.json"],
                                     capture_output=True,text=True).stdout)["edges"]
def rat(e):
    r=e.get("rationale"); return r if isinstance(r,str) and r.strip() else None
def key(e): return (e.get("source"),e.get("target"),e.get("type"))
_ID=re.compile(r"\b(?:acc|saf|skp|cc|sit|pol)-[a-z]+-\d+\b",re.I)

src=edges_at("ba3128f5")
rats=[(key(e),rat(e)) for e in src if rat(e)]
# deterministic pick: sort by composite key, then take the alphabetically-FIRST 8 referent-bearing
# + 17 referent-free rationales (a fixed slice, not a statistical spread) — 25 real, CL-labelled clean
rats.sort(key=lambda kr: "|".join(kr[0]))
with_ref=[kr for kr in rats if _ID.search(kr[1])]
without_ref=[kr for kr in rats if not _ID.search(kr[1])]
picks = with_ref[:8] + without_ref[:17]   # 25 real, CL-labelled clean (alphabetically-first slice)

sample=[]
for k,r in picks:
    sample.append({"label":"clean","provenance":"observed","source_key":"|".join(k),
                   "text":r,"note":"real ba3128f5 rationale, CL-labelled substantive"})

# the 3 real non-empty->non-empty revisions (all ENrichments) — must stay CLEAN under diff mode
older={key(e):rat(e) for e in edges_at("3673d3ee") if rat(e)}
enrich=[(k,older[k],r) for k,r in rats if k in older and older[k]!=r]
for k,o,n in enrich:
    sample.append({"label":"clean","provenance":"observed","source_key":"|".join(k),
                   "old":o,"new":n,"note":"real revision (enrichment: new ~2x longer) — must NOT flag as degradation"})

# CONSTRUCTED degraded cases (FIRE arm) — degrade a handful of the real ones, label constructed
base = picks[0][1]  # a real substantive rationale w/ referent
ref_pick = with_ref[1][1]
sample += [
 {"label":"degraded","provenance":"constructed","old":base,"new":"Related.","note":"total collapse to a stub"},
 {"label":"degraded","provenance":"constructed","old":ref_pick,"new":"This edge supports the target.","note":"generic shell, referent lost"},
 {"label":"degraded","provenance":"constructed","old":base,"new":base[:38],"note":"truncated fragment (<40 chars)"},
 {"label":"degraded","provenance":"constructed","old":ref_pick,"new":re.sub(_ID,'the node',ref_pick)[:55],"note":"referent-stripped + truncated"},
 {"label":"degraded","provenance":"constructed","text":"Cross-category link.","note":"standalone boilerplate shell"},
 {"label":"degraded","provenance":"constructed","text":"Supports.","note":"standalone one-word stub"},
 # CLEAN constructed controls (must NOT flag):
 # (1) a genuine SAME-SCALE paraphrase — reworded, comparable length + content words, no collapse.
 {"label":"clean","provenance":"constructed",
  "old":"The source node's belief that observable, falsifiable metrics are the only reliable basis for judgment directly grounds the intention to build empirical safety evaluations for advanced systems.",
  "new":"Because the source treats measurable, testable indicators as the sole trustworthy basis for judgement, it directly motivates constructing rigorous empirical safety evaluations for advanced AI systems.",
  "note":"legitimate same-scale paraphrase (reworded, comparable length + content) — must NOT flag"},
 # (2) a legitimately concise-but-substantive rationale that simply carries no node-id referent.
 {"label":"clean","provenance":"constructed",
  "new":"The belief in unbounded compute-driven scaling directly underwrites the desire for transformative, abundance-creating artificial intelligence.",
  "note":"substantive, referent-free, above the short floor — must NOT flag"},
]

# t/2964 — SIGNAL-ISOLATION cases. In the t/2948 sample every degraded transition landed BELOW the
# 60-char floor, so short_and_shell co-fired on all four and neither length_collapse nor
# referent_loss was ever observed firing ALONE — they were asserted, not validated. These two rows
# put each transition signal on the record in isolation. Both are ABOVE the floor (so shell is
# false by construction) and were confirmed by running detect.flag_transition, not by reading the
# rule (t/2294): the signal list each produces is recorded in `isolates` and asserted by
# `--validate`'s isolation check.
_ISO_OLD_NOREF = ("The source node's commitment to unbounded compute scaling as the primary driver of "
                  "capability gains directly underwrites its desire for transformative economic abundance, "
                  "because sustained exponential investment in training infrastructure is treated as both "
                  "necessary and sufficient for the broad deployment of general-purpose automation across "
                  "every productive sector.")
_ISO_OLD_REF = ("The belief encoded in acc-beliefs-051 that rapid capability gains are strictly compute-bound "
                "provides the mechanistic justification for acc-desires-001, namely the pursuit of "
                "transformative abundance through aggressive scaling of frontier training runs.")
sample += [
 # length_collapse ALONE: 369->92 chars (ratio 0.25) with content words 33->8. Above the 60-char
 # floor so short_and_shell is false; the OLD carries no node-id/quoted referent so referent_loss
 # cannot fire either. Isolates the length+content conjunction on its own.
 {"label":"degraded","provenance":"constructed","isolates":"length_collapse",
  "old":_ISO_OLD_NOREF,
  "new":"Sustained investment in training infrastructure is treated as the route to broad automation.",
  "note":"ABOVE-FLOOR truncation: fires length_collapse ALONE (ratio 0.25, content 33->8 words, "
         "new 92ch > 60ch floor, old referent-free so referent_loss cannot co-fire) — t/2964 AC1"},
 # referent_loss ALONE: the new text RETAINS 63% of the length (so the ratio<0.5 length_collapse
 # conjunct is FALSE) and stays above the floor (so shell is FALSE), but drops both node-id
 # referents and collapses content words 22->7. This is the "vague filler of similar length"
 # degradation — the one shape that only referent_loss catches.
 {"label":"degraded","provenance":"constructed","isolates":"referent_loss",
  "old":_ISO_OLD_REF,
  "new":"This node is connected to the other node in the way that is described, and it is on that "
        "basis that the one is said to be related to the other as stated above.",
  "note":"ABOVE-FLOOR referent strip: fires referent_loss ALONE (ratio 0.63 so length_collapse is "
         "false, new 159ch > 60ch floor so shell is false, content 22->7 words, both node-ids "
         "dropped) — t/2964 AC1"},
 # t/2964 AC2 — BOUNDARY-ADJACENT clean controls. The t/2948 zero-FP claim rested on 30 clean rows
 # whose SHORTEST was 128 chars (>2x the 60-char floor) — so it showed no clean case was NEAR the
 # boundary, not that the boundary is well placed. These sit just above the floor. See the README
 # "Boundary FP" note: substantive rationales BELOW 60 chars DO flag, a known and bounded FP.
 {"label":"clean","provenance":"constructed","control":"boundary_adjacent",
  "new":"Scaling compute underwrites the desire for transformative abundance.",
  "note":"boundary-adjacent clean control (68ch, just above the 60ch floor) — must NOT flag"},
 {"label":"clean","provenance":"constructed","control":"boundary_adjacent",
  "new":"Falsifiable metrics ground the intention to build empirical evaluations.",
  "note":"boundary-adjacent clean control (72ch) — must NOT flag"},
 {"label":"clean","provenance":"constructed","control":"boundary_adjacent",
  "new":"The belief in compute-bound capability gains motivates aggressive scaling.",
  "note":"boundary-adjacent clean control (74ch) — must NOT flag"},
]

# t/2963 — NON-VACUOUS clean diff-mode controls: 26 faithful same-edge paraphrases across
# compression ratios 0.53-0.97, so the transition signals (length_collapse/referent_loss) are
# exercised on real clean data, not only the 3 near-vacuous enrichments above. Every one MUST
# stay quiet; the ratio-binned FP distribution is reported by diff_fp_sweep.py.
sample += build_diff_controls.build_rows()

# t/2965 — SUB-BOUNDARY (<0.5x) controls: 6 faithful compressions (ratio 0.40-0.49, retention >=0.5,
# MUST stay quiet — the length-TRUE/content-FALSE demonstration) + 5 lossy degradations (retention
# <0.5, MUST flag) from 6 NEW sources disjoint from the t/2963 seven. Drives the detector into the
# <0.5 region COLLAPSE_RATIO governs and characterises the faithful/lossy boundary from both sides.
sample += build_diff_controls.build_subboundary_rows()

with open(OUT, "w", encoding="utf-8") as _out:   # context-managed: guarantees flush+close
    json.dump(sample, _out, ensure_ascii=False, indent=1)
from collections import Counter
print("wrote",len(sample),"rows ->",OUT)
print("labels:",dict(Counter(r["label"] for r in sample)),
      "provenance:",dict(Counter(r["provenance"] for r in sample)))
print("diff_ratio controls:",sum(1 for r in sample if str(r.get("control","")).startswith("diff_ratio")))
print("  t/2963 band:",sum(1 for r in sample if r.get("control")=="diff_ratio"),
      "| t/2965 sub-boundary:",sum(1 for r in sample if str(r.get("control","")).startswith("diff_ratio_subboundary")))
