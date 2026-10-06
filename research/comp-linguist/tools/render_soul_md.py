#!/usr/bin/env python3
"""Render each lib/debate/soul-docs/*.soul.json to its derived Markdown view (*.soul.md).

The JSON is the source of truth; the .md is a generated view for reading. No generator existed, so the
views were hand-edited and drifted (skeptic.soul.md kept a stock example its JSON had dropped, t/3932).
This makes the view reproducible. Covers POV souls (<pov>.soul.json) and tag souls (<pov>.<tag>.soul.json).

Usage:
  python render_soul_md.py            # write every view
  python render_soul_md.py --check    # exit 1 if any view differs from its JSON (no writes)
  python render_soul_md.py FILE ...   # only these .soul.json files
"""
import glob, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SOUL_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "..", "lib", "debate", "soul-docs"))


def render(doc, json_name):
    tag = doc.get("tag")
    title = f"{doc['label']}" if not tag else f"Skeptic · {doc['label']}" if doc["pov"] == "skeptic" else f"{doc['pov'].capitalize()} · {doc['label']}"
    v, b = doc["voice"], doc["boundaries"]
    lines = [f"# {title} — Soul Document", ""]
    head = f"> **POV:** `{doc['pov']}`"
    if tag:
        head += f"  ·  **Tag:** `{tag}`"
    lines += [head + f"  ·  **Color:** `{doc['color']}`  ", f"> **Personality:** {doc['personality']}", ""]
    lines += ["## Voice", ""]
    for key, name in (("disposition", "Disposition"), ("style", "Style"), ("reasoning", "Reasoning"),
                      ("evidence", "Evidence"), ("signature", "Signature move")):
        lines += [f"**{name}.** {v[key]}", ""]
    lines += ["### Prose style", "", v["prose_style"], "", "### Voice hygiene", "", v["voice_hygiene"], ""]
    lines += [f"**Prose style (short):** {v['prose_style_short']}", "",
              f"**Voice hygiene (short):** {v['voice_hygiene_short']}", ""]
    lines += ["## Anti-patterns", ""] + [f"- {x}" for x in doc["anti_patterns"]] + [""]
    lines += ["## Value hierarchy", ""] + [f"{i}. {x}" for i, x in enumerate(doc["value_hierarchy"], 1)] + [""]
    lines += ["## Epistemic stance", ""] + [f"- {x}" for x in doc["epistemic_stance"]] + [""]
    lines += ["## Boundaries", "", "**Hardcoded (non-negotiable):**", ""] + [f"- {x}" for x in b["hardcoded"]]
    lines += ["", "**Softcoded (movable with sufficient evidence):**", ""] + [f"- {x}" for x in b["softcoded"]]
    lines += ["", "---", "",
              f"*Derived view generated from [`{json_name}`](./{json_name}) — the JSON is the source of truth; "
              f"regenerate this Markdown when the JSON changes.*", ""]
    return "\n".join(lines)


def main(argv):
    check = "--check" in argv
    files = [a for a in argv if a.endswith(".soul.json")] or sorted(glob.glob(os.path.join(SOUL_DIR, "*.soul.json")))
    stale = []
    for path in files:
        doc = json.load(open(path, encoding="utf-8"))
        md_path = path[: -len(".json")] + ".md"
        out = render(doc, os.path.basename(path))
        cur = open(md_path, encoding="utf-8", newline="").read() if os.path.exists(md_path) else None
        if cur != out:
            stale.append(os.path.basename(md_path))
            if not check:
                open(md_path, "w", encoding="utf-8", newline="").write(out)
    print(("stale: " if check else "regenerated: ") + (", ".join(stale) if stale else "none"))
    return 1 if (check and stale) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
