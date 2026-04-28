#!/usr/bin/env python3

"""
coin_second_batch.py — Phase 4 second-batch vocabulary coining.

Adds 11 new standardized terms across 4 colloquial families:
  autonomy (3), accountability (3), bias (2), fairness (3)

Brings total from 21 to 32 standardized terms (within 25-35 target).
Appends to existing coinage log. Does NOT overwrite Phase 2 entries.
"""

import json
import re
from datetime import date
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
TODAY = date.today().isoformat()
REVIEWER = "jpsnover"
SCHEMA_VERSION = "1.0.0"
LOG_ENTRY_START = 22  # Phase 2 used 1-21


def _resolve_data_root():
    config_path = _SCRIPT_DIR.parent / ".aitriad.json"
    if config_path.exists():
        cfg = json.loads(config_path.read_text(encoding="utf-8"))
        data_root = cfg.get("data_root", ".")
        base = Path(data_root) if Path(data_root).is_absolute() else (_SCRIPT_DIR.parent / data_root)
        return base.resolve()
    return _SCRIPT_DIR.parent.resolve()


def find_nodes_using_term(data_root: Path, term: str) -> dict[str, list[str]]:
    taxonomy_dir = data_root / "taxonomy" / "Origin"
    camp_files = {
        "accelerationist": "accelerationist.json",
        "safetyist": "safetyist.json",
        "skeptic": "skeptic.json",
    }
    result = {}
    pattern = re.compile(rf"\b{re.escape(term)}\b", re.IGNORECASE)
    for camp, fname in camp_files.items():
        fpath = taxonomy_dir / fname
        if not fpath.exists():
            continue
        data = json.loads(fpath.read_text(encoding="utf-8"))
        nodes = data if isinstance(data, list) else data.get("nodes", [])
        ids = []
        for node in nodes:
            text = f"{node.get('label', '')} {node.get('description', '')}"
            if pattern.search(text):
                ids.append(node.get("id", ""))
        if ids:
            result[camp] = ids
    return result


STANDARDIZED_TERMS = [
    # ── autonomy family ──
    {
        "canonical_form": "autonomy_machine",
        "display_form": "autonomy (machine)",
        "definition": "The capacity of AI systems to operate, make decisions, and take actions without direct human intervention. Framed as a positive capability milestone enabling scalable deployment and reduced human bottlenecks.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "accelerationist",
        "rationale_for_coinage": "Accelerationists celebrate machine autonomy as an achievement that unlocks scale. Safetyists view the same capability as a control risk. Skeptics question whether 'autonomy' is even the right framing for statistical pattern-matching. The bare term hides which entity is autonomous and whether that is desirable.",
        "characteristic_phrases": ["autonomous agents", "agentic AI", "self-directed", "autonomous operation", "reduced human bottleneck", "autonomous decision-making", "agent capabilities"],
        "translates_from_colloquial": ["autonomy"],
        "see_also": ["autonomy_human", "autonomy_individual"],
        "do_not_confuse_with": [
            {"term": "autonomy_human", "note": "Human autonomy is about preserving human decision authority; machine autonomy is about AI acting independently."},
            {"term": "control_optimization", "note": "Optimization control is about AI managing systems; machine autonomy is about AI's self-directed operation."}
        ],
        "contested_aspects": [
            "Whether machine autonomy is a real property or anthropomorphic projection (Skeptics argue the latter)",
            "Whether autonomous AI systems can be meaningfully controlled (Safetyists doubt this)"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-022",
    },
    {
        "canonical_form": "autonomy_human",
        "display_form": "autonomy (human preservation)",
        "definition": "The principle that AI systems must not undermine meaningful human decision-making authority over consequential life choices. Preserving the capacity for humans to understand, contest, and override AI-driven outcomes.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "safetyist",
        "rationale_for_coinage": "Safetyists frame autonomy as something humans possess that AI threatens. This is semantically opposite to the accelerationist framing where autonomy is something AI achieves. Cross-camp analysis requires distinguishing the two.",
        "characteristic_phrases": ["human autonomy", "human agency", "meaningful choice", "human oversight", "right to override", "human-in-the-loop", "informed consent", "human dignity"],
        "translates_from_colloquial": ["autonomy"],
        "see_also": ["autonomy_machine", "control_human_agency"],
        "do_not_confuse_with": [
            {"term": "autonomy_machine", "note": "Machine autonomy celebrates AI independence; human autonomy preservation constrains it."},
            {"term": "autonomy_individual", "note": "Individual autonomy is about personal data and algorithmic decisions; human autonomy is broader."}
        ],
        "contested_aspects": [
            "Whether human autonomy is being genuinely threatened or is a rhetorical frame (Accelerationists argue the latter)",
            "Whether meaningful human control is possible at scale"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-023",
    },
    {
        "canonical_form": "autonomy_individual",
        "display_form": "autonomy (individual/data)",
        "definition": "Individual control over personal data, algorithmic decisions, and the right to understand, contest, and opt out of AI-driven processes that affect one's life. Grounded in existing civil rights and consumer protection frameworks.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "skeptic",
        "rationale_for_coinage": "Skeptics ground autonomy in concrete individual rights — data control, algorithmic recourse, informed consent — rather than abstract existential or capability framings. This practical sense gets lost when 'autonomy' is used in its machine or human-preservation senses.",
        "characteristic_phrases": ["data sovereignty", "algorithmic recourse", "right to explanation", "opt-out", "informed consent", "individual rights", "data autonomy", "personal agency"],
        "translates_from_colloquial": ["autonomy"],
        "see_also": ["autonomy_human", "autonomy_machine"],
        "do_not_confuse_with": [
            {"term": "autonomy_human", "note": "Human autonomy preservation is a broad principle; individual autonomy is about specific enforceable rights."}
        ],
        "contested_aspects": [
            "Whether individual opt-out rights are compatible with AI systems that require population-level data",
            "Whether individual recourse is meaningful when AI decisions are opaque"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-024",
    },
    # ── accountability family ──
    {
        "canonical_form": "accountability_market",
        "display_form": "accountability (market)",
        "definition": "Market forces, consumer choice, competitive pressure, and reputational risk as the primary mechanisms for holding AI developers accountable. Accountability through economic consequences rather than regulatory mandate.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "accelerationist",
        "rationale_for_coinage": "Accelerationists argue markets self-correct faster than regulators. Safetyists demand institutional accountability structures. Skeptics demand algorithmic auditing. Same word, three different enforcement mechanisms with different power dynamics.",
        "characteristic_phrases": ["market accountability", "competitive pressure", "consumer choice", "reputational risk", "market forces", "market discipline", "industry self-regulation"],
        "translates_from_colloquial": ["accountability"],
        "see_also": ["accountability_institutional", "accountability_algorithmic"],
        "do_not_confuse_with": [
            {"term": "accountability_institutional", "note": "Institutional accountability uses legal and regulatory mechanisms, not market forces."},
            {"term": "accountability_algorithmic", "note": "Algorithmic accountability audits specific systems; market accountability operates at the firm level."}
        ],
        "contested_aspects": [
            "Whether market forces are sufficient for AI accountability (Safetyists and Skeptics argue not)",
            "Whether reputational risk works when AI harms are diffuse or delayed"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-025",
    },
    {
        "canonical_form": "accountability_institutional",
        "display_form": "accountability (institutional)",
        "definition": "Formal legal, regulatory, and organizational structures that assign liability, mandate disclosure, and provide remediation pathways for AI-caused harm. Accountability enforced through governance institutions.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "safetyist",
        "rationale_for_coinage": "Safetyists insist on structural accountability that survives corporate incentives. This means legal liability, mandatory disclosure, and institutional oversight — mechanisms that markets cannot replicate. The bare term 'accountability' hides whether enforcement is structural or market-based.",
        "characteristic_phrases": ["legal liability", "regulatory accountability", "mandatory disclosure", "institutional oversight", "liability framework", "corporate governance", "duty of care"],
        "translates_from_colloquial": ["accountability"],
        "see_also": ["accountability_market", "accountability_algorithmic", "transparency_accountability"],
        "do_not_confuse_with": [
            {"term": "accountability_market", "note": "Market accountability relies on economic incentives; institutional accountability relies on legal obligation."}
        ],
        "contested_aspects": [
            "Whether institutional accountability can keep pace with AI development",
            "Whether liability frameworks designed for human actors apply to AI systems"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-026",
    },
    {
        "canonical_form": "accountability_algorithmic",
        "display_form": "accountability (algorithmic)",
        "definition": "Systematic auditing, testing, and evaluation of specific AI systems for discriminatory outcomes, errors, and failures. Technical accountability through measurable evaluation of algorithmic behavior against defined fairness and performance standards.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "skeptic",
        "rationale_for_coinage": "Skeptics ground accountability in measurable algorithmic auditing — concrete tests for bias, discrimination, and error rates. This is more specific than institutional accountability and more rigorous than market accountability. The bare term hides the mechanism.",
        "characteristic_phrases": ["algorithmic audit", "bias testing", "impact assessment", "algorithmic impact", "discrimination testing", "model evaluation", "fairness audit", "disparate impact"],
        "translates_from_colloquial": ["accountability"],
        "see_also": ["accountability_institutional", "accountability_market", "oversight_audit"],
        "do_not_confuse_with": [
            {"term": "accountability_institutional", "note": "Institutional accountability is about governance structures; algorithmic accountability is about technical evaluation of specific systems."},
            {"term": "oversight_audit", "note": "Audit oversight is about general empirical verification; algorithmic accountability specifically targets discrimination and fairness."}
        ],
        "contested_aspects": [
            "Whether algorithmic audits capture all relevant harms or only measurable ones",
            "Whether audit standards can be standardized across domains"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-027",
    },
    # ── bias family ──
    {
        "canonical_form": "bias_technical",
        "display_form": "bias (technical/statistical)",
        "definition": "Systematic errors in AI model outputs arising from training data distributions, model architecture choices, or optimization objectives. A measurable property of systems that can be identified, quantified, and mitigated through engineering interventions.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "accelerationist",
        "rationale_for_coinage": "Accelerationists frame bias as a technical property that can be measured and fixed through better engineering. Skeptics frame it as a social justice issue reflecting structural power asymmetries. Using 'bias' without specifying which framing silently adopts one camp's ontology.",
        "characteristic_phrases": ["statistical bias", "model bias", "training data bias", "distribution shift", "benchmark evaluation", "bias mitigation", "debiasing", "calibration error"],
        "translates_from_colloquial": ["bias"],
        "see_also": ["bias_systemic"],
        "do_not_confuse_with": [
            {"term": "bias_systemic", "note": "Systemic bias is about social power structures reproducing through AI; technical bias is about measurable model errors."}
        ],
        "contested_aspects": [
            "Whether bias is primarily a technical problem with technical solutions (Skeptics argue not)",
            "Whether debiasing techniques address root causes or only symptoms"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-028",
    },
    {
        "canonical_form": "bias_systemic",
        "display_form": "bias (systemic/social)",
        "definition": "AI systems encoding, reproducing, and amplifying existing societal inequalities — racial, gender, economic, and other structural power asymmetries. Bias as a social justice issue reflecting whose perspectives are centered and whose are marginalized in AI design and deployment.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "skeptic",
        "rationale_for_coinage": "Skeptics insist that bias in AI is not just a technical measurement error but a reflection of structural power. Technical debiasing is insufficient if the underlying social structure is biased. This framing demands different interventions than the technical framing.",
        "characteristic_phrases": ["systemic bias", "structural discrimination", "algorithmic discrimination", "disparate impact", "representational harm", "racial bias", "gender bias", "power asymmetry", "marginalized communities"],
        "translates_from_colloquial": ["bias"],
        "see_also": ["bias_technical", "documented_present_harm"],
        "do_not_confuse_with": [
            {"term": "bias_technical", "note": "Technical bias is a model property to be measured; systemic bias is a social power structure reproduced through AI."}
        ],
        "contested_aspects": [
            "Whether AI creates new bias or only reflects existing bias (camps disagree on causal direction)",
            "Whether technical fixes can address systemic bias (Skeptics argue not without structural change)"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-029",
    },
    # ── fairness family ──
    {
        "canonical_form": "fairness_individual",
        "display_form": "fairness (individual/meritocratic)",
        "definition": "Each person or case should be evaluated on its own merits by an AI system, without reference to group membership. Fairness as equal treatment of individuals, assessed case-by-case based on relevant attributes only.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "accelerationist",
        "rationale_for_coinage": "Accelerationists favor individual fairness because it aligns with meritocratic values and is technically tractable. Safetyists prefer group fairness metrics. Skeptics demand procedural fairness. These three conceptions of fairness are mathematically incompatible and lead to different system designs.",
        "characteristic_phrases": ["individual fairness", "meritocratic", "case-by-case", "relevant attributes", "equal treatment", "calibration", "individual merit"],
        "translates_from_colloquial": ["fairness"],
        "see_also": ["fairness_group", "fairness_procedural"],
        "do_not_confuse_with": [
            {"term": "fairness_group", "note": "Group fairness evaluates outcomes across demographic groups; individual fairness evaluates treatment of each case."},
            {"term": "fairness_procedural", "note": "Procedural fairness is about process transparency; individual fairness is about outcome equality."}
        ],
        "contested_aspects": [
            "Whether individual fairness can address structural inequality (Skeptics argue not)",
            "Whether individual fairness is mathematically compatible with group fairness (generally not)"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-030",
    },
    {
        "canonical_form": "fairness_group",
        "display_form": "fairness (group/demographic)",
        "definition": "AI systems should produce equitable outcomes across demographic groups — equal error rates, equal positive/negative prediction rates, or equal benefit distribution across protected categories. Fairness measured at the population level.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "safetyist",
        "rationale_for_coinage": "Safetyists focus on group-level fairness because individual fairness can mask systematic disadvantage. If a model is individually fair but produces racially disparate outcomes, that is still unfair in this framing. The choice of fairness definition determines what counts as discrimination.",
        "characteristic_phrases": ["group fairness", "demographic parity", "equalized odds", "equal opportunity", "disparate impact", "protected groups", "statistical parity", "representational fairness"],
        "translates_from_colloquial": ["fairness"],
        "see_also": ["fairness_individual", "fairness_procedural", "bias_systemic"],
        "do_not_confuse_with": [
            {"term": "fairness_individual", "note": "Individual fairness evaluates each case; group fairness evaluates aggregate outcomes across populations."}
        ],
        "contested_aspects": [
            "Whether group fairness constraints reduce overall system quality (Accelerationists argue yes)",
            "Which group fairness metric to prioritize (mathematically incompatible options exist)"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-031",
    },
    {
        "canonical_form": "fairness_procedural",
        "display_form": "fairness (procedural)",
        "definition": "Fair processes for AI decision-making: transparency about how decisions are made, meaningful access to appeals and remediation, and the right to understand and contest AI-driven outcomes. Fairness as process rather than outcome.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "skeptic",
        "rationale_for_coinage": "Skeptics ground fairness in procedural rights — can you find out why an AI decided against you? Can you appeal? This is distinct from both individual and group fairness metrics. It centers affected people's agency rather than statistical properties of the system.",
        "characteristic_phrases": ["procedural fairness", "due process", "right to explanation", "algorithmic recourse", "appeal process", "contestability", "transparency", "meaningful access"],
        "translates_from_colloquial": ["fairness"],
        "see_also": ["fairness_individual", "fairness_group", "autonomy_individual"],
        "do_not_confuse_with": [
            {"term": "fairness_individual", "note": "Individual fairness measures outcome equality; procedural fairness measures process quality."},
            {"term": "fairness_group", "note": "Group fairness measures population-level outcomes; procedural fairness measures access to remediation."}
        ],
        "contested_aspects": [
            "Whether procedural fairness is meaningful when the underlying process is opaque",
            "Whether procedural rights slow AI deployment unacceptably (Accelerationists argue yes)"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-032",
    },
]

COLLOQUIAL_TERMS = [
    {
        "colloquial_term": "autonomy",
        "status": "do_not_use_bare",
        "translation_required": True,
        "resolves_to": [
            {"standardized_term": "autonomy_machine", "when": "Used to describe AI operating independently; co-occurs with autonomous agents, agentic, self-directed, automated operation", "default_for_camp": "accelerationist", "confidence_typical": "high"},
            {"standardized_term": "autonomy_human", "when": "Used to describe preserving human decision authority; co-occurs with human autonomy, human agency, override, human-in-the-loop", "default_for_camp": "safetyist", "confidence_typical": "high"},
            {"standardized_term": "autonomy_individual", "when": "Used to describe individual rights over data and algorithmic decisions; co-occurs with data sovereignty, opt-out, right to explanation", "default_for_camp": "skeptic", "confidence_typical": "medium"},
        ],
        "translation_ambiguous_when": [
            "Author discusses both machine and human autonomy without distinguishing",
            "Philosophical usage of autonomy without specifying agent type",
            "Autonomous weapons context where both machine capability and human oversight are at issue"
        ],
    },
    {
        "colloquial_term": "accountability",
        "status": "do_not_use_bare",
        "translation_required": True,
        "resolves_to": [
            {"standardized_term": "accountability_market", "when": "Used in context of market forces, consumer choice, competitive pressure as accountability mechanism", "default_for_camp": "accelerationist", "confidence_typical": "high"},
            {"standardized_term": "accountability_institutional", "when": "Used in context of legal liability, regulatory mandate, governance structures", "default_for_camp": "safetyist", "confidence_typical": "high"},
            {"standardized_term": "accountability_algorithmic", "when": "Used in context of algorithmic auditing, bias testing, impact assessment of specific systems", "default_for_camp": "skeptic", "confidence_typical": "high"},
        ],
        "translation_ambiguous_when": [
            "General call for accountability without specifying mechanism",
            "Author discusses multiple accountability mechanisms together"
        ],
    },
    {
        "colloquial_term": "bias",
        "status": "do_not_use_bare",
        "translation_required": True,
        "resolves_to": [
            {"standardized_term": "bias_technical", "when": "Used as model/statistical property; co-occurs with training data, calibration, debiasing, benchmarks, distribution shift", "default_for_camp": "accelerationist", "confidence_typical": "high"},
            {"standardized_term": "bias_systemic", "when": "Used as social justice issue; co-occurs with discrimination, structural inequality, marginalized communities, racial/gender bias", "default_for_camp": "skeptic", "confidence_typical": "high"},
        ],
        "translation_ambiguous_when": [
            "Author uses 'bias' without specifying technical or social framing",
            "Author bridges both framings (measuring systemic bias via technical metrics)"
        ],
    },
    {
        "colloquial_term": "fairness",
        "status": "do_not_use_bare",
        "translation_required": True,
        "resolves_to": [
            {"standardized_term": "fairness_individual", "when": "Individual case-by-case evaluation; co-occurs with meritocratic, calibration, individual treatment, relevant attributes", "default_for_camp": "accelerationist", "confidence_typical": "medium"},
            {"standardized_term": "fairness_group", "when": "Population-level outcome equality; co-occurs with demographic parity, equalized odds, disparate impact, protected groups", "default_for_camp": "safetyist", "confidence_typical": "high"},
            {"standardized_term": "fairness_procedural", "when": "Process transparency and recourse rights; co-occurs with due process, right to explanation, contestability, appeal", "default_for_camp": "skeptic", "confidence_typical": "medium"},
        ],
        "translation_ambiguous_when": [
            "Generic use of 'fairness' without specifying which conception",
            "Author argues for multiple fairness definitions simultaneously",
            "Fairness used in a non-technical, colloquial sense"
        ],
    },
]


def populate_used_by_nodes(data_root: Path, terms: list[dict]) -> None:
    colloquial_to_canonical = {}
    for t in terms:
        for bare in t["translates_from_colloquial"]:
            colloquial_to_canonical.setdefault(bare, []).append(t)

    for bare_term, std_terms in colloquial_to_canonical.items():
        camp_nodes = find_nodes_using_term(data_root, bare_term)
        for std_term in std_terms:
            camp = std_term["primary_camp_origin"]
            node_ids = camp_nodes.get(camp, [])
            std_term["used_by_nodes"] = node_ids[:20]


def write_standardized(dict_dir: Path, terms: list[dict]) -> None:
    out_dir = dict_dir / "standardized"
    out_dir.mkdir(parents=True, exist_ok=True)
    for term in terms:
        entry = {"$schema_version": SCHEMA_VERSION, **term}
        entry["coined_at"] = TODAY
        entry["coined_by"] = REVIEWER
        fname = f"{term['canonical_form']}.json"
        (out_dir / fname).write_text(json.dumps(entry, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(terms)} new standardized terms")


def write_colloquial(dict_dir: Path, terms: list[dict]) -> None:
    out_dir = dict_dir / "colloquial"
    out_dir.mkdir(parents=True, exist_ok=True)
    for term in terms:
        entry = {
            "$schema_version": SCHEMA_VERSION,
            **term,
            "first_added": TODAY,
            "last_reviewed": TODAY,
        }
        fname = f"{term['colloquial_term']}.json"
        (out_dir / fname).write_text(json.dumps(entry, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(terms)} new colloquial terms")


def append_coinage_log(dict_dir: Path, terms: list[dict]) -> None:
    log_path = dict_dir / "coinage_log.md"
    lines = []
    if log_path.exists():
        existing = log_path.read_text(encoding="utf-8")
        if existing.rstrip().endswith("---"):
            lines.append(existing.rstrip())
        else:
            lines.append(existing.rstrip())
            lines.append("\n---\n")
    else:
        lines.append("# Coinage Log\n")
        lines.append("Append-only record of every vocabulary coining decision.\n")
        lines.append("---\n")

    for term in terms:
        ref = term["coinage_log_ref"]
        lines.append(f"\n## {ref}")
        lines.append(f"**Date:** {TODAY}")
        lines.append(f"**Reviewer:** {REVIEWER}")
        lines.append(f"**Canonical Form:** `{term['canonical_form']}`")
        lines.append(f"**Display Form:** `{term['display_form']}`")
        lines.append(f"**Status:** {term['coinage_status']}")
        lines.append(f"\n### Rationale")
        lines.append(term["rationale_for_coinage"])
        lines.append(f"\n### Characteristic Phrases")
        for phrase in term["characteristic_phrases"]:
            lines.append(f"- {phrase}")
        lines.append(f"\n### Cross-Camp Usage")
        lines.append(f"- **Primary origin:** {term['primary_camp_origin']}")
        if term.get("contested_aspects"):
            for aspect in term["contested_aspects"]:
                lines.append(f"- {aspect}")
        lines.append(f"\n### Colloquial Terms It Translates From")
        for bare in term["translates_from_colloquial"]:
            lines.append(f"- `{bare}`")
        lines.append(f"\n### Definition")
        lines.append(term["definition"])
        lines.append("\n---\n")

    log_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Appended {len(terms)} entries to coinage log")


def main():
    data_root = _resolve_data_root()
    dict_dir = data_root / "dictionary"

    print(f"Data root: {data_root}")
    print(f"Dictionary: {dict_dir}")

    # Verify existing terms
    existing_dir = dict_dir / "standardized"
    existing_count = len(list(existing_dir.glob("*.json"))) if existing_dir.exists() else 0
    print(f"Existing standardized terms: {existing_count}")

    populate_used_by_nodes(data_root, STANDARDIZED_TERMS)
    write_standardized(dict_dir, STANDARDIZED_TERMS)
    write_colloquial(dict_dir, COLLOQUIAL_TERMS)
    append_coinage_log(dict_dir, STANDARDIZED_TERMS)

    new_total = len(list((dict_dir / "standardized").glob("*.json")))
    print(f"\nTotal standardized terms: {new_total}")
    print("Run 'python scripts/build_sense_embeddings.py' to update sense embeddings.")


if __name__ == "__main__":
    main()
