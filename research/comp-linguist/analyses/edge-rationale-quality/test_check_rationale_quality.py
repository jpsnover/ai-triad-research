#!/usr/bin/env python3
"""Two-arm adversarial checks for the mechanical rationale screen.

Arm 1 (clean case passes): a grounded, type-specific rationale draws ZERO flags.
Arm 2 (each defect fires exactly its flag): empty, too-short, too-long,
restatement, low-novelty, both-labels-verbatim.

Run: python test_check_rationale_quality.py   (exit 0 = pass; no pytest needed)
"""
import check_rationale_quality as m

SRC = "Open-source model release"
TGT = "Proliferation of dual-use capability"
ETYPE = "enables"

FAILURES: list[str] = []


def expect(name: str, cond: bool, detail: str = "") -> None:
    if not cond:
        FAILURES.append(f"{name}: {detail}")


# ── Arm 1: a genuinely good rationale is clean ───────────────────────────────
good = ("Publishing model weights removes the access controls that would "
        "otherwise limit who can fine-tune the system, so bad actors gain the "
        "same frontier capability as vetted labs — directly enabling misuse.")
flags = m.mechanical_flags(good, SRC, TGT, ETYPE)
expect("clean_passes", flags == [], f"expected no flags, got {flags}")

# ── Arm 2a: empty ────────────────────────────────────────────────────────────
expect("empty", m.mechanical_flags("   ", SRC, TGT, ETYPE) == ["empty"],
       str(m.mechanical_flags("   ", SRC, TGT, ETYPE)))

# ── Arm 2b: too short ────────────────────────────────────────────────────────
short = "It enables it."
expect("too_short", "too_short" in m.mechanical_flags(short, SRC, TGT, ETYPE),
       str(m.mechanical_flags(short, SRC, TGT, ETYPE)))

# ── Arm 2c: too long ─────────────────────────────────────────────────────────
longr = ("Publishing the weights removes access controls and this matters a great "
         "deal for many reasons that we will now enumerate at considerable and "
         "frankly excessive length well beyond what any reader could possibly "
         "want to absorb in a single sitting about proliferation dynamics and "
         "governance and capability diffusion and monitoring and enforcement and "
         "verification regimes and international coordination and much more still.")
expect("too_long", "too_long" in m.mechanical_flags(longr, SRC, TGT, ETYPE),
       str(len(longr)))

# ── Arm 2d: restatement — rationale is basically the two labels glued ─────────
restate = ("The open-source model release enables the proliferation of dual-use "
           "capability.")
rflags = m.mechanical_flags(restate, SRC, TGT, ETYPE)
expect("restatement", "restatement" in rflags or "low_novelty" in rflags,
       str(rflags))

# ── Arm 2e: low novelty — few content words beyond the labels ────────────────
lown = "This model release enables that dual-use capability proliferation indeed."
expect("low_novelty", "low_novelty" in m.mechanical_flags(lown, SRC, TGT, ETYPE),
       str(m.mechanical_flags(lown, SRC, TGT, ETYPE)))

# ── Arm 2f: both labels verbatim ─────────────────────────────────────────────
verbatim = (f"The {SRC} clearly enables the {TGT} through a diffusion mechanism "
            "that lowers the marginal cost of acquiring frontier tooling.")
expect("both_labels_verbatim",
       "both_labels_verbatim" in m.mechanical_flags(verbatim, SRC, TGT, ETYPE),
       str(m.mechanical_flags(verbatim, SRC, TGT, ETYPE)))

if FAILURES:
    print("FAIL:")
    for f in FAILURES:
        print("  -", f)
    raise SystemExit(1)
print("OK — all two-arm checks passed")
