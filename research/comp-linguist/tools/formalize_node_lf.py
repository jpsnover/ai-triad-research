#!/usr/bin/env python3
"""G6 (t/3162): populate `node.logical_form` on grounded BDI nodes — node-level application of the
t/3215 claim formalization. A BDI node maps 1:1 onto the claim-formalization inputs:
  CLAIM_CATEGORY = node.category (Beliefs|Desires|Intentions)   ATTRIBUTING CAMP = id prefix (acc|saf|skp)
  PROPOSITION    = label + description                          RESOLVED ENTITIES = node entity_refs + concept_refs
entity_refs are particulars (sort = register dolce_category); concept_refs are universals/kinds
(sort = non-agentive-social-object — the DOLCE-lite abstract sort). Grounds args ONLY from the node's
own refs (one-identity §7.4: sort/match_level copied from the register/ref, never the model's guess).
Ports the shipped prompt at runtime so it stays in sync. --apply writes node.logical_form; default dry.
PI-directed populate (t/3162 (B)); gated post-hoc by TL data-model review + a node golden set.
"""
import argparse, json, os, re, sys, time
sys.stdout.reconfigure(encoding="utf-8")
# t/3939: the code checkout is wherever this file lives (so the default prompt is the one shipped
# with this code, worktrees included), and the data root honours AI_TRIAD_DATA_ROOT like the rest of
# the toolchain (env var, then default), so a run can target a clean data worktree, not the shared checkout.
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
D = os.environ.get("AI_TRIAD_DATA_ROOT") or r"C:\Users\jsnov\repos\ai-triad-data"
O = os.path.join(D, "taxonomy", "Origin")
PROMPT_PATH = os.path.join(REPO, "scripts", "AITriad", "Prompts", "logical-form-formalization.prompt")
POV = {"acc": "acc", "saf": "saf", "skp": "skp"}
CAT_ATT = {"Beliefs": "belief", "Desires": "desire", "Intentions": "intention"}

# t/3940: the entity register is loaded on first use, not at import, so the pure functions
# (validate, strip_discourse_wrapper, strip_scope_notes, ...) import and test without the data repo.
# CI has no data repo; an import-time load made every test here either error or skip there.
_REG = None


def _registry():
    """id -> {sort, name} from taxonomy/Origin/entities.json, loaded once on first use."""
    global _REG
    if _REG is None:
        with open(os.path.join(O, "entities.json"), encoding="utf-8") as f:
            ents = json.load(f)["entities"]
        _REG = {e["id"]: {"sort": e.get("dolce_category", "non-agentive-social-object"), "name": e.get("name", "")}
                for e in ents}
    return _REG


def __getattr__(name):
    # Back-compat for any caller that read the old module-level `reg` (PEP 562).
    if name == "reg":
        return _registry()
    raise AttributeError(name)

def load_nodes():
    out = []
    for fn in ("accelerationist.json", "safetyist.json", "skeptic.json"):
        p = os.path.join(O, fn)
        data = json.load(open(p, encoding="utf-8"))
        for n in data["nodes"]:
            if n.get("concept_refs") or n.get("entity_refs"):
                out.append((fn, data, n))
    return out

def refs_block(n):
    lines, allowed = [], {}
    reg = _registry()
    for r in (n.get("entity_refs") or []):
        eid = r["ref"]; sort = reg.get(eid, {}).get("sort", "non-agentive-social-object")
        ml = r.get("match_level", "exact"); nm = reg.get(eid, {}).get("name", r.get("surface", ""))
        lines.append(f"- {eid} ({nm}) sort={sort} match_level={ml}")
        allowed[eid] = (sort, ml)
    for r in (n.get("concept_refs") or []):
        cid = r["ref"]  # term:cf — a concept is a UNIVERSAL (kind), the 6th arg-slot sort (t/3251),
        lines.append(f"- {cid} ({r.get('surface','')}) sort=universal match_level=exact")
        allowed[cid] = ("universal", "exact")  # distinct from the 5 particular DolceCategory sorts
    return ("\n".join(lines) if lines else "(none)"), allowed

# t/3351 v3 (class B fix): node descriptions verbatim begin "A(n) <Belief|Desire|
# Intention> within <camp> discourse that <verb>..." (917/959 frames). The model read
# that literal wrapper as an AGENT ("<camp> discourse"), producing the discourse-as-
# agent residuals the line-37 ban could not stop, it was being asked to ignore text it
# was handed. Strip the wrapper at the SOURCE so "discourse" is never a candidate agent;
# the camp attribution is carried by modality.holder, not by the prose. The exposed
# content clause (e.g. "advocates X") is re-capitalized. The camp's stance is still
# handled by the prompt's stance-strip self-check (class A), unchanged here.
# t/3884: the camp may be multi-word ("within skeptic and safetyist discourse that"), so the
# camp slot is non-greedy text, not a single \w+ token (the v3 pattern missed skp-desires-075).
_DISCOURSE_WRAP = re.compile(
    r"^An?\s+(?:Belief|Desire|Intention)\s+within\s+.+?\s+discourse\s+that\s+", re.IGNORECASE)
_DISCOURSE_WRAP_V3 = re.compile(
    r"^An?\s+(?:Belief|Desire|Intention)\s+within\s+\w+\s+discourse\s+that\s+", re.IGNORECASE)

# t/3884: 973/986 node descriptions end in "Encompasses: ..." and "Excludes: ..." scope notes.
# They bound the node's scope for taxonomy editors; they are not the proposition. Handing them
# to the formalizer let it pick a predicate from scope text (skp-beliefs-232's live frame
# formalized the Encompasses phrase "maintaining systems"), and Excludes lists what the node
# does NOT claim. Cut them at the source, as the wrapper strip does for class B.
_SCOPE_NOTES = re.compile(r"\s*\b(?:Encompasses|Excludes)\s*:.*\Z", re.IGNORECASE | re.DOTALL)

LEGACY_SOURCE = False  # --legacy-source reproduces the v3 node input exactly (for A/B arms)


def strip_discourse_wrapper(desc):
    """Remove the leading '<cat> within <camp> discourse that ' framing prefix (t/3351).
    No-op on descriptions that don't carry it. Re-capitalizes the exposed clause."""
    pat = _DISCOURSE_WRAP_V3 if LEGACY_SOURCE else _DISCOURSE_WRAP
    stripped = pat.sub("", desc or "")
    if stripped and stripped != (desc or ""):
        return stripped[0].upper() + stripped[1:]
    return desc or ""


def strip_scope_notes(desc):
    """Drop the trailing Encompasses/Excludes scope notes (t/3884). No-op when absent."""
    if LEGACY_SOURCE:
        return desc or ""
    return _SCOPE_NOTES.sub("", desc or "").rstrip()


def build_prompt(tmpl, n):
    cat = n.get("category", "Beliefs")
    camp = n["id"].split("-")[0]
    desc = strip_scope_notes(strip_discourse_wrapper(n.get("description") or n.get("plain_description") or ""))
    prop = (n.get("label", "") + ". " + desc).strip()
    block, allowed = refs_block(n)
    p = (tmpl.replace("{{CLAIM_CATEGORY}}", cat).replace("{{CAMP}}", POV.get(camp, camp))
             .replace("{{PROPOSITION}}", prop[:2400]).replace("{{ENTITY_REFS}}", block))
    return p, allowed, camp, cat

def parse_lf(text):
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1].lstrip("json").strip("` \n") if "```" in t[3:] else t
    s, e = t.find("{"), t.rfind("}")
    try: return json.loads(t[s:e+1])
    except Exception: return None

PARTICULAR_SORTS = frozenset({"agentive-physical-object", "non-agentive-functional-artifact",
                              "perdurant", "normative-description", "non-agentive-social-object"})
# Canonical EntityMatchLevel enum (logical-form-schema.md; PS $script:LogicalFormMatchLevels).
# `universal` is a valid args[].sort (t/3251) but NEVER a match_level — the t/3379 leak. match_level
# is enum-clamped here for both about[] and topical_candidates.
VALID_MATCH_LEVELS = frozenset({"exact", "instance_of", "subclass", "superclass", "related"})

# Option C (t/3389; SO+TL signed off e/145#13-#16). The mixed-convention about[] MISSED the
# pre-committed concept-anchored floor (0.636 < 0.80, t/3381), so about[] reverts to ent-only and
# the term: concept refs move to `topical_candidates` — a quality-marked layer whose provenance
# block makes the unvalidated status legible FROM THE DATA (a consumer sees validated:false + the
# 0.54 blind-golden precision without reading the register). Stamped by THIS generator; a repaired
# generator (t/3390) must UPDATE this block or revalidate-and-move the refs to about[] — never
# fresh refs under stale metadata (e/145#14(c) lifecycle rule).
TOPICAL_CANDIDATES_PROVENANCE = {
    "validated": False,
    "generator": "formalize_node_lf.py",
    "golden_ref": "t/3381",
    "blind_golden_precision": 0.54,
}


def _repair_bare(ref, allowed):
    """A bare cf-name that IS a node concept -> its `term:` id (t/3239: LLM dropped the prefix)."""
    if isinstance(ref, str) and ref and not ref.startswith(("ent-", "term:", "lit:")) \
       and not re.fullmatch(r"e\d+", ref):
        cand = "term:" + ref
        if cand in allowed:
            return cand
    return ref


def validate(lf, allowed, camp, cat):
    """One-identity §7.4: grounded refs (ent-/term:) copy sort/match_level authoritatively from
    `allowed`; a bare cf-name matching a node concept is repaired to its term: id (t/3239); lit:/event
    args keep a VALID particular sort + non-empty match_level (t/3239#6 hardening); hallucinated
    grounded ids are dropped. Concept sorts are `universal` (via `allowed`, t/3251). Mechanical modality."""
    if not isinstance(lf, dict): return None

    def fix(a):
        ref = _repair_bare(a.get("ref", ""), allowed)
        a["ref"] = ref
        if isinstance(ref, str) and (ref.startswith("ent-") or ref.startswith("term:")):
            if ref not in allowed:
                return None  # hallucinated grounded id -> drop (never mint)
            a["sort"], a["match_level"] = allowed[ref]
            return a
        # lit: / event / unresolved: a particular; force a valid sort + non-empty match_level
        if a.get("sort") not in PARTICULAR_SORTS:
            a["sort"] = "non-agentive-social-object"  # clamp off-enum to the abstract-particular default
        if not a.get("match_level"):
            a["match_level"] = "exact"
        return a

    lf["args"] = [x for x in (fix(a) for a in (lf.get("args") or [])) if x]
    # A perdurant (event, process, state) is never an `agent`: agency belongs to endurants (DOLCE). It is the
    # `cause` when it brings the event about, or the `theme` when it is the subject of a stative predicate
    # ("X constitutes a defect"). The right role depends on the predicate, so this is REFUSED, not relabelled:
    # the draft is discarded and retried (t/4020). Checked after fix(), so a grounded event entity is caught too.
    for a in lf["args"]:
        if a.get("role") == "agent" and a.get("sort") == "perdurant":
            raise ValueError(f"perdurant agent {a.get('ref')!r}: an event/process cannot be an agent; use cause or theme (t/4020)")
    # Option C split (t/3389): about[] = ent-* only; term: concept refs -> topical_candidates.
    # Only grounded refs survive (R6 / t/2294 — a ref not in the node's own entity_refs/concept_refs
    # is dropped, never minted); the `in allowed` gate enforces the {ent-*|term:*} vocabulary.
    kept_about, candidate_refs = [], []
    for ab in (lf.get("about") or []):
        if not isinstance(ab, dict):
            continue
        ref = _repair_bare(ab.get("ref", ""), allowed)
        if ref not in allowed:
            continue
        ab["ref"] = ref
        # Authoritative match_level from the ref's register entry (mirrors args[]), never the model's
        # guess; enum-clamp so a concept's sort=`universal` can never leak into match_level (t/3379).
        ml = allowed[ref][1]
        ab["match_level"] = ml if ml in VALID_MATCH_LEVELS else "exact"
        (kept_about if ref.startswith("ent-") else candidate_refs).append(ab)
    lf["about"] = kept_about
    # topical_candidates present only when concept refs exist (absent, not null, otherwise —
    # absent≠null contract, t/2943). Provenance stamped fresh by this generator (lifecycle rule).
    if candidate_refs:
        lf["topical_candidates"] = {**TOPICAL_CANDIDATES_PROVENANCE, "refs": candidate_refs}
    else:
        lf.pop("topical_candidates", None)
    lf["modality"] = {"holder": f"camp:{POV.get(camp, camp)}", "attitude": CAT_ATT.get(cat, "belief")}
    lf.setdefault("status", "proposed")
    return lf

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cap", type=int, default=0, help="max nodes (0=all grounded)")
    ap.add_argument("--ids", default="", help="comma-separated node ids to formalize (dry-run subset, e.g. defect nodes)")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "node_lf_sample.json"))
    ap.add_argument("--prompt", default=PROMPT_PATH, help="prompt template path (dry-run a candidate prompt; t/3884)")
    ap.add_argument("--legacy-source", action="store_true", dest="legacy_source",
                    help="reproduce the v3 node input: single-word camp wrapper strip, scope notes kept (t/3884 A/B arms)")
    args = ap.parse_args()
    global LEGACY_SOURCE
    LEGACY_SOURCE = args.legacy_source
    if args.apply and (args.legacy_source or os.path.abspath(args.prompt) != os.path.abspath(PROMPT_PATH)):
        sys.stderr.write("refusing --apply with --legacy-source or a non-shipped --prompt: those are dry-run arms only\n")
        return 2
    tmpl = open(args.prompt, encoding="utf-8").read()
    nodes = load_nodes()
    if args.ids:
        want = {s.strip() for s in args.ids.split(",") if s.strip()}
        nodes = [x for x in nodes if x[2]["id"] in want]
        missing = want - {x[2]["id"] for x in nodes}
        if missing:
            sys.stderr.write(f"  [warn] --ids not found among grounded nodes: {sorted(missing)}\n")
    if args.cap: nodes = nodes[:args.cap]
    print(f"grounded nodes to formalize: {len(nodes)}")

    import google.generativeai as genai
    genai.configure(api_key=os.environ.get("GEMINI_API_KEY", ""))
    model = genai.GenerativeModel("gemini-3.5-flash-lite", generation_config={"temperature": 0.2, "response_mime_type": "application/json"})
    from concurrent.futures import ThreadPoolExecutor

    def formalize(item):
        fn, data, n = item
        prompt, allowed, camp, cat = build_prompt(tmpl, n)
        for a in range(3):
            try:
                r = model.generate_content(prompt)
                lf = validate(parse_lf(r.text or ""), allowed, camp, cat)
                if lf and lf.get("predicate"):
                    return (n["id"], lf)
            except Exception as ex:
                sys.stderr.write(f"  [warn] {n['id']} a{a}: {type(ex).__name__}: {str(ex)[:160]}\n")  # say WHY a draft was refused
            time.sleep(0.8 * (a + 1))
        return (n["id"], None)

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        results = dict(ex.map(formalize, nodes))
    ok = {k: v for k, v in results.items() if v}
    print(f"formalized: {len(ok)}/{len(nodes)}  (failed: {len(nodes)-len(ok)})")
    # Write results: a 6-node eyeball sample for a full run, but ALL formalized frames when a
    # subset was targeted (--ids/--cap) so a dry-run can be re-scanned for defects (t/3351).
    subset = bool(args.ids) or (0 < args.cap <= 60)
    payload = {"count": len(ok), "all" if subset else "sample": ok if subset else {k: results[k] for k in list(ok)[:6]}}
    json.dump(payload, open(args.out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    for k in list(ok)[:4]:
        print(f"\n{k}: pred={ok[k].get('predicate')!r} args={[(a.get('role'),a.get('ref'),a.get('sort')) for a in ok[k].get('args',[])]} conf={ok[k].get('formalization_confidence')} status={ok[k].get('status')}")

    if args.apply:
        byfile = {}
        for fn, data, n in nodes:
            byfile.setdefault(fn, data)
        # attach to node objects (data is shared per file object)
        idmap = {n["id"]: n for _, _, n in nodes}
        applied = 0
        for nid, lf in ok.items():
            idmap[nid]["logical_form"] = lf; applied += 1
        for fn, data in byfile.items():
            with open(os.path.join(O, fn), "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False); f.write("\n")
        print(f"\nAPPLIED node.logical_form to {applied} nodes across {len(byfile)} files")
    else:
        print("\nDRY RUN (use --apply to write node.logical_form)")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
