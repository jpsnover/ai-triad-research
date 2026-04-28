#!/usr/bin/env python3

"""
coin_initial_vocabulary.py — Generate the Phase 2 initial vocabulary batch.

Creates standardized term entries, colloquial term entries, and coinage log
for the first 21 standardized terms across 10 colloquial families.

Run once; subsequent edits should be made to the JSON files directly.
"""

import json
import re
from datetime import date
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
TODAY = date.today().isoformat()
REVIEWER = "jpsnover"
SCHEMA_VERSION = "1.0.0"


def _resolve_data_root():
    config_path = _SCRIPT_DIR.parent / ".aitriad.json"
    if config_path.exists():
        cfg = json.loads(config_path.read_text(encoding="utf-8"))
        data_root = cfg.get("data_root", ".")
        base = Path(data_root) if Path(data_root).is_absolute() else (_SCRIPT_DIR.parent / data_root)
        return base.resolve()
    return _SCRIPT_DIR.parent.resolve()


# ── Find node IDs that use each colloquial term ──────────

def find_nodes_using_term(data_root: Path, term: str) -> dict[str, list[str]]:
    """Return {camp: [node_ids]} for nodes whose label/description contains the term."""
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


# ── Standardized terms ───────────────────────────────────

STANDARDIZED_TERMS = [
    # ── alignment family ──
    {
        "canonical_form": "safety_alignment",
        "display_form": "alignment (safety)",
        "definition": "Ensuring advanced AI systems robustly pursue intended goals under distribution shift, including goals not explicitly specified at training time. The core technical challenge of making AI systems that reliably do what their designers want.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "safetyist",
        "rationale_for_coinage": "The bare term 'alignment' is used by all three camps with substantively different referents. Safetyists mean the technical problem of goal specification and robustness; accelerationists dismiss it as orthodoxy; skeptics question whether it's a real problem or a power play.",
        "characteristic_phrases": ["alignment problem", "inner alignment", "outer alignment", "mesa-optimizer", "deceptive alignment", "goal misgeneralization", "reward hacking", "RLHF"],
        "translates_from_colloquial": ["alignment"],
        "see_also": ["commercial_alignment", "alignment_compliance"],
        "do_not_confuse_with": [
            {"term": "commercial_alignment", "note": "Product alignment with user intent is unrelated to the technical safety alignment problem."},
            {"term": "alignment_compliance", "note": "Behavioral compliance with stated values is a regulatory framing, not the technical problem."}
        ],
        "contested_aspects": [
            "Whether this is a real problem distinct from alignment_compliance (Skeptics argue not)",
            "Whether current systems exhibit misalignment (Accelerationists argue largely not)",
            "Whether it can be solved at all (positions vary within Safetyism)"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-001",
    },
    {
        "canonical_form": "commercial_alignment",
        "display_form": "alignment (commercial)",
        "definition": "AI systems that effectively serve user intent, product requirements, and business objectives. The product-market sense of 'alignment' — a system does what the customer wants.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "accelerationist",
        "rationale_for_coinage": "Accelerationists frame alignment as a solved product problem, not an unsolved technical crisis. Distinguishing commercial alignment from safety alignment prevents conflation of market success with existential risk reduction.",
        "characteristic_phrases": ["product-market fit", "user intent", "customer needs", "helpful assistant", "user satisfaction", "instruction following"],
        "translates_from_colloquial": ["alignment"],
        "see_also": ["safety_alignment", "alignment_compliance"],
        "do_not_confuse_with": [
            {"term": "safety_alignment", "note": "Safety alignment is about preventing catastrophic misalignment, not about meeting user requirements."}
        ],
        "contested_aspects": [
            "Whether commercial alignment is sufficient for safety (Accelerationists argue yes, Safetyists argue no)",
            "Whether the distinction between commercial and safety alignment is meaningful or artificial"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-002",
    },
    {
        "canonical_form": "alignment_compliance",
        "display_form": "alignment (compliance)",
        "definition": "The extent to which an AI system's behavior conforms to externally stated values, regulations, or social norms. A governance-oriented framing that treats alignment as a compliance property rather than a technical property.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "skeptic",
        "rationale_for_coinage": "Skeptics reframe alignment as a question of whose values are being enforced, treating it as a political compliance problem rather than a technical safety problem. This conflation corrupts cross-camp analysis.",
        "characteristic_phrases": ["whose values", "value alignment", "compliance", "social norms", "regulatory alignment", "behavioral compliance"],
        "translates_from_colloquial": ["alignment"],
        "see_also": ["safety_alignment", "commercial_alignment"],
        "do_not_confuse_with": [
            {"term": "safety_alignment", "note": "Safety alignment is about technical robustness, not about whose values prevail."}
        ],
        "contested_aspects": [
            "Whether alignment is fundamentally a political question (Skeptics) or a technical one (Safetyists)",
            "Whether compliance-based alignment is achievable or desirable"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-003",
    },
    # ── safety family ──
    {
        "canonical_form": "safety_existential",
        "display_form": "safety (existential)",
        "definition": "Preventing AI systems from causing irreversible, civilization-threatening or extinction-level harm. The strong interpretation of AI safety focused on catastrophic and existential risk.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "safetyist",
        "rationale_for_coinage": "Safetyists use 'safety' to mean existential risk prevention. Accelerationists use 'safety' to mean empirical output verification. Skeptics use it to mean documented harm prevention. These three senses lead to entirely different policy prescriptions.",
        "characteristic_phrases": ["existential risk", "x-risk", "extinction", "irreversible", "civilizational", "superintelligence", "catastrophic", "humanity-ending"],
        "translates_from_colloquial": ["safety"],
        "see_also": ["safety_empirical", "risk_existential"],
        "do_not_confuse_with": [
            {"term": "safety_empirical", "note": "Empirical safety is about verifiable output quality, not extinction prevention."}
        ],
        "contested_aspects": [
            "Whether existential risk from AI is plausible (Accelerationists and Skeptics dispute this)",
            "Whether existential safety is achievable before deployment"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-004",
    },
    {
        "canonical_form": "safety_empirical",
        "display_form": "safety (empirical)",
        "definition": "Verifying AI system behavior through empirical testing, output auditing, and reproducible evaluation. Safety as a measurable, iterative engineering property rather than a pre-deployment proof.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "accelerationist",
        "rationale_for_coinage": "Accelerationists treat safety as something you measure and improve post-deployment, not something you prove before deployment. This framing enables rapid iteration but is rejected by Safetyists as inadequate for existential risk.",
        "characteristic_phrases": ["empirical validation", "output verification", "reproducible results", "testing", "benchmarks", "red teaming", "iterative improvement"],
        "translates_from_colloquial": ["safety"],
        "see_also": ["safety_existential", "oversight_audit"],
        "do_not_confuse_with": [
            {"term": "safety_existential", "note": "Existential safety requires pre-deployment guarantees, not just empirical verification."}
        ],
        "contested_aspects": [
            "Whether empirical safety is sufficient without formal guarantees (Safetyists argue not)",
            "Whether post-deployment iteration is acceptable for high-stakes systems"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-005",
    },
    # ── governance family ──
    {
        "canonical_form": "governance_oversight",
        "display_form": "governance (oversight)",
        "definition": "External institutional frameworks that constrain, monitor, and regulate AI development and deployment. Governance as a check on AI power, operated by humans and institutions.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "safetyist",
        "rationale_for_coinage": "Safetyists view governance as constraining AI. Accelerationists view governance as something AI can optimize. These opposite framings make the bare term 'governance' ambiguous in cross-camp analysis.",
        "characteristic_phrases": ["regulatory oversight", "institutional control", "governance framework", "policy constraint", "compliance monitoring", "deployment gates"],
        "translates_from_colloquial": ["governance"],
        "see_also": ["governance_adaptive", "oversight_human_control", "regulation_precautionary"],
        "do_not_confuse_with": [
            {"term": "governance_adaptive", "note": "Adaptive governance uses AI as governance infrastructure, which is the opposite of governance constraining AI."}
        ],
        "contested_aspects": [
            "Whether external governance can keep pace with AI development (Accelerationists doubt this)",
            "Whether governance should be precautionary or adaptive"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-006",
    },
    {
        "canonical_form": "governance_adaptive",
        "display_form": "governance (adaptive)",
        "definition": "Governance systems that evolve dynamically with technology, potentially using AI itself as infrastructure for real-time policy adjustment and resource allocation.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "accelerationist",
        "rationale_for_coinage": "Accelerationists see static governance as an obstacle and propose AI-augmented governance as a replacement. This is fundamentally different from the Safetyist framing of governance as human constraint on AI.",
        "characteristic_phrases": ["adaptive governance", "real-time policy", "AI-augmented", "dynamic regulation", "market-based", "civilizational control layer"],
        "translates_from_colloquial": ["governance"],
        "see_also": ["governance_oversight", "regulation_adaptive"],
        "do_not_confuse_with": [
            {"term": "governance_oversight", "note": "Oversight governance constrains AI from the outside; adaptive governance lets AI participate in governance."}
        ],
        "contested_aspects": [
            "Whether AI should govern anything (Safetyists and Skeptics object)",
            "Whether adaptive governance reduces or increases concentration of power"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-007",
    },
    # ── risk family ──
    {
        "canonical_form": "risk_existential",
        "display_form": "risk (existential)",
        "definition": "The probability of AI systems causing irreversible, humanity-ending or civilization-ending outcomes. Risk as a measurable threat with non-trivial probability that demands precautionary action.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "safetyist",
        "rationale_for_coinage": "Safetyists treat AI risk as existential with measurable probability. Accelerationists treat risk as regulatory cost. These different ontological statuses of 'risk' make the bare term analytically useless in cross-camp comparison.",
        "characteristic_phrases": ["existential risk", "x-risk", "extinction probability", "catastrophic outcome", "irreversible harm", "civilizational threat"],
        "translates_from_colloquial": ["risk"],
        "see_also": ["risk_innovation", "safety_existential"],
        "do_not_confuse_with": [
            {"term": "risk_innovation", "note": "Innovation risk is the cost of not innovating, not the danger of innovation."}
        ],
        "contested_aspects": [
            "Whether existential risk from AI is non-trivial (fundamental disagreement across all camps)",
            "Whether precautionary action is justified given uncertainty"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-008",
    },
    {
        "canonical_form": "risk_innovation",
        "display_form": "risk (innovation stagnation)",
        "definition": "The cost of over-regulating AI development: foregone benefits, competitive disadvantage, and the societal harm of technological stagnation. Risk reframed as the danger of NOT innovating.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "accelerationist",
        "rationale_for_coinage": "Accelerationists invert the risk calculus: the real risk is regulation, not AI. This makes 'risk' mean opposite things depending on camp — existential threat vs. regulatory drag.",
        "characteristic_phrases": ["innovation stagnation", "regulatory burden", "competitive disadvantage", "foregone benefits", "opportunity cost", "falling behind"],
        "translates_from_colloquial": ["risk"],
        "see_also": ["risk_existential", "regulation_precautionary"],
        "do_not_confuse_with": [
            {"term": "risk_existential", "note": "Existential risk is about AI causing harm; innovation risk is about humans preventing progress."}
        ],
        "contested_aspects": [
            "Whether innovation stagnation is a real risk or a rhetorical device (Safetyists argue the latter)",
            "Whether competitive pressure justifies accepting safety risks"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-009",
    },
    # ── capabilities family ──
    {
        "canonical_form": "capabilities_scaling",
        "display_form": "capabilities (scaling)",
        "definition": "The pursuit of increasing AI capability as an inherently beneficial trajectory. More capable systems are better systems, and scaling is the primary path to beneficial AI.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "accelerationist",
        "rationale_for_coinage": "Accelerationists frame capabilities as solution; Safetyists frame them as problem. Same term, opposite causal direction — scaling capabilities is either the goal or the threat.",
        "characteristic_phrases": ["capability scaling", "frontier models", "scaling laws", "emergent capabilities", "capability overhang", "compute scaling"],
        "translates_from_colloquial": ["capabilities"],
        "see_also": ["capabilities_hazard"],
        "do_not_confuse_with": [
            {"term": "capabilities_hazard", "note": "Capabilities hazard treats the same scaling as a danger, not a benefit."}
        ],
        "contested_aspects": [
            "Whether capabilities scaling is net positive (Accelerationists) or net dangerous (Safetyists)",
            "Whether capabilities improvements can be safely unbounded"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-010",
    },
    {
        "canonical_form": "capabilities_hazard",
        "display_form": "capabilities (hazard)",
        "definition": "The danger posed by increasing AI capability: as systems become more capable, they become harder to control, align, and predict, creating compounding risks that may outpace safety measures.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "safetyist",
        "rationale_for_coinage": "Safetyists see capabilities growth as inherently risk-producing. This is the direct inversion of capabilities_scaling and makes 'capabilities' ambiguous in any cross-camp discussion.",
        "characteristic_phrases": ["capability overhang", "safety gap", "outpacing safety", "loss of control", "capability threshold", "dangerous capabilities"],
        "translates_from_colloquial": ["capabilities"],
        "see_also": ["capabilities_scaling", "risk_existential"],
        "do_not_confuse_with": [
            {"term": "capabilities_scaling", "note": "Scaling treats capability growth as positive; hazard treats it as threatening."}
        ],
        "contested_aspects": [
            "Whether capability growth necessarily creates hazards (Accelerationists deny this)",
            "Whether safety can keep pace with capabilities"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-011",
    },
    # ── harm family ──
    {
        "canonical_form": "documented_present_harm",
        "display_form": "harm (documented, present)",
        "definition": "Evidenced, currently-occurring harm caused by existing AI systems: algorithmic discrimination, labor displacement, surveillance, environmental cost. Harm that can be measured and attributed today.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "skeptic",
        "rationale_for_coinage": "Skeptics focus on documented present harm; Safetyists focus on speculative future harm. This divergence means 'harm' carries fundamentally different temporal and evidential weight depending on camp.",
        "characteristic_phrases": ["documented harm", "present harm", "algorithmic bias", "labor displacement", "surveillance", "discriminatory outcomes", "environmental cost"],
        "translates_from_colloquial": ["harm"],
        "see_also": ["speculative_future_harm"],
        "do_not_confuse_with": [
            {"term": "speculative_future_harm", "note": "Future harm is hypothetical and projected; present harm is evidenced and occurring."}
        ],
        "contested_aspects": [
            "Whether present harms are more urgent than future risks (Skeptics say yes, Safetyists say both matter)",
            "Whether documented present harm justifies slowing AI development"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-012",
    },
    {
        "canonical_form": "speculative_future_harm",
        "display_form": "harm (speculative, future)",
        "definition": "Projected catastrophic harm from future AI systems: existential risk, loss of human agency, civilizational disruption. Harm that is hypothetical but potentially irreversible.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "safetyist",
        "rationale_for_coinage": "Safetyists prioritize speculative future harm because it is potentially irreversible. Skeptics dismiss it as distraction from documented present harm. The temporal framing of 'harm' determines entire policy orientations.",
        "characteristic_phrases": ["future risk", "catastrophic harm", "existential threat", "loss of control", "civilizational disruption", "irreversible"],
        "translates_from_colloquial": ["harm"],
        "see_also": ["documented_present_harm", "risk_existential"],
        "do_not_confuse_with": [
            {"term": "documented_present_harm", "note": "Present harm is evidenced and ongoing; future harm is projected and hypothetical."}
        ],
        "contested_aspects": [
            "Whether speculative harm justifies precautionary regulation (Skeptics and Accelerationists resist this)",
            "Whether existential risk scenarios are plausible enough to act on"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-013",
    },
    # ── oversight family ──
    {
        "canonical_form": "oversight_human_control",
        "display_form": "oversight (human control)",
        "definition": "Maintaining meaningful human authority over AI systems: shutdown capability, veto power, goal modification rights. Oversight as preserving human agency and final decision-making authority.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "safetyist",
        "rationale_for_coinage": "Safetyists mean human control when they say 'oversight'; Accelerationists mean empirical audit. These are different activities with different implications for who holds power.",
        "characteristic_phrases": ["human control", "shutdown capability", "human-in-the-loop", "veto power", "corrigibility", "human authority", "kill switch"],
        "translates_from_colloquial": ["oversight"],
        "see_also": ["oversight_audit", "control_human_agency"],
        "do_not_confuse_with": [
            {"term": "oversight_audit", "note": "Audit oversight checks outputs after the fact; human control oversight prevents actions before they happen."}
        ],
        "contested_aspects": [
            "Whether meaningful human control is possible at superintelligent scales",
            "Whether human-in-the-loop oversight creates unacceptable latency"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-014",
    },
    {
        "canonical_form": "oversight_audit",
        "display_form": "oversight (audit)",
        "definition": "Empirical verification and auditing of AI system outputs, processes, and decisions. Oversight as post-hoc accountability through transparent, reproducible evaluation.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "accelerationist",
        "rationale_for_coinage": "Accelerationists prefer audit-based oversight that doesn't block deployment, unlike human-control oversight that requires pre-deployment approval. Same word, different power structure.",
        "characteristic_phrases": ["audit", "output verification", "transparency", "reproducibility", "empirical evaluation", "post-deployment monitoring"],
        "translates_from_colloquial": ["oversight"],
        "see_also": ["oversight_human_control", "transparency_verification"],
        "do_not_confuse_with": [
            {"term": "oversight_human_control", "note": "Human control oversight blocks deployment; audit oversight monitors it."}
        ],
        "contested_aspects": [
            "Whether post-hoc auditing is sufficient for high-stakes systems (Safetyists argue not)",
            "Whether audit overhead is acceptable in competitive markets"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-015",
    },
    # ── control family ──
    {
        "canonical_form": "control_human_agency",
        "display_form": "control (human agency)",
        "definition": "Preserving meaningful human decision-making authority over consequential choices, even as AI systems become more capable. The principle that humans should remain the final arbiters.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "safetyist",
        "rationale_for_coinage": "Safetyists mean preserving human power; Accelerationists mean optimizing resource allocation. 'Control' slides between human agency and system optimization in cross-camp discourse.",
        "characteristic_phrases": ["human agency", "human authority", "meaningful control", "decision-making", "human oversight", "human autonomy"],
        "translates_from_colloquial": ["control"],
        "see_also": ["control_optimization", "oversight_human_control"],
        "do_not_confuse_with": [
            {"term": "control_optimization", "note": "Optimization control is AI managing systems; agency control is humans managing AI."}
        ],
        "contested_aspects": [
            "Whether human control is desirable at all scales (Accelerationists question this)",
            "Whether AI decision-making might be preferable to human for some domains"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-016",
    },
    {
        "canonical_form": "control_optimization",
        "display_form": "control (optimization)",
        "definition": "AI systems managing complex resource allocation, logistics, and governance infrastructure. Control as an optimization problem where AI is the controller, not the controlled.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "accelerationist",
        "rationale_for_coinage": "Accelerationists envision AI as controller of complex systems. This inverts the Safetyist framing where AI is the thing being controlled. Same word, opposite subject-object relationship.",
        "characteristic_phrases": ["resource allocation", "optimization", "infrastructure management", "civilizational control", "automated governance", "systems management"],
        "translates_from_colloquial": ["control"],
        "see_also": ["control_human_agency", "governance_adaptive"],
        "do_not_confuse_with": [
            {"term": "control_human_agency", "note": "Human agency control is about controlling AI; optimization control is about AI controlling systems."}
        ],
        "contested_aspects": [
            "Whether AI should control any consequential systems (Safetyists and Skeptics resist this)",
            "Whether optimization control inevitably concentrates power"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-017",
    },
    # ── transparency family ──
    {
        "canonical_form": "transparency_accountability",
        "display_form": "transparency (accountability)",
        "definition": "Making AI systems, their development processes, and their impacts visible to external stakeholders for the purpose of holding developers and deployers responsible.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "safetyist",
        "rationale_for_coinage": "Safetyists and Skeptics use transparency to mean external accountability — making powerful actors answerable. Accelerationists use it to mean empirical verification — making systems auditable. Different purposes, different power dynamics.",
        "characteristic_phrases": ["external accountability", "public disclosure", "responsible AI", "impact assessment", "stakeholder oversight", "developer liability"],
        "translates_from_colloquial": ["transparency"],
        "see_also": ["transparency_verification", "oversight_human_control"],
        "do_not_confuse_with": [
            {"term": "transparency_verification", "note": "Verification transparency is about technical auditability, not about who answers for harm."}
        ],
        "contested_aspects": [
            "Whether transparency is achievable for proprietary systems",
            "Whether transparency requirements slow development unacceptably"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-018",
    },
    {
        "canonical_form": "transparency_verification",
        "display_form": "transparency (verification)",
        "definition": "Making AI system internals and outputs inspectable for the purpose of scientific verification, reproducibility, and empirical validation of safety claims.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "accelerationist",
        "rationale_for_coinage": "Accelerationists frame transparency as a technical verification tool rather than an accountability mechanism. This framing enables rapid development while maintaining empirical rigor.",
        "characteristic_phrases": ["empirical verification", "reproducibility", "scientific transparency", "audit trail", "output inspection", "model interpretability"],
        "translates_from_colloquial": ["transparency"],
        "see_also": ["transparency_accountability", "oversight_audit"],
        "do_not_confuse_with": [
            {"term": "transparency_accountability", "note": "Accountability transparency serves external stakeholders; verification transparency serves the development process."}
        ],
        "contested_aspects": [
            "Whether technical transparency is sufficient without accountability structures",
            "Whether verification transparency is meaningful without external access"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-019",
    },
    # ── regulation family ──
    {
        "canonical_form": "regulation_precautionary",
        "display_form": "regulation (precautionary)",
        "definition": "Restricting AI deployment until safety has been demonstrated to a specified standard. Regulation as a gate that must be passed before systems reach users.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "safetyist",
        "rationale_for_coinage": "Safetyists want deployment gates; Accelerationists want market-based, post-deployment regulation. These are structurally opposite approaches that the bare term 'regulation' obscures.",
        "characteristic_phrases": ["precautionary principle", "deployment gate", "safety proof", "pre-market approval", "moratorium", "licensing requirement"],
        "translates_from_colloquial": ["regulation"],
        "see_also": ["regulation_adaptive", "governance_oversight"],
        "do_not_confuse_with": [
            {"term": "regulation_adaptive", "note": "Adaptive regulation adjusts post-deployment; precautionary regulation blocks pre-deployment."}
        ],
        "contested_aspects": [
            "Whether precautionary regulation is feasible for rapidly evolving technology",
            "Whether the burden of safety proof is unreasonably high"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-020",
    },
    {
        "canonical_form": "regulation_adaptive",
        "display_form": "regulation (adaptive)",
        "definition": "Flexible, technology-aware regulatory frameworks that evolve alongside AI development. Regulation as an ongoing process that responds to empirical evidence rather than imposing static pre-deployment requirements.",
        "coined_for_taxonomy": True,
        "primary_camp_origin": "accelerationist",
        "rationale_for_coinage": "Accelerationists advocate for regulation that doesn't block deployment but adjusts based on observed outcomes. This is structurally opposed to precautionary regulation.",
        "characteristic_phrases": ["adaptive regulation", "flexible governance", "market-based", "innovation-preserving", "iterative policy", "evidence-based regulation"],
        "translates_from_colloquial": ["regulation"],
        "see_also": ["regulation_precautionary", "governance_adaptive"],
        "do_not_confuse_with": [
            {"term": "regulation_precautionary", "note": "Precautionary regulation blocks first; adaptive regulation observes first."}
        ],
        "contested_aspects": [
            "Whether adaptive regulation is too slow to prevent harm (Safetyists argue yes)",
            "Whether post-deployment adjustment is meaningful for irreversible harms"
        ],
        "coinage_status": "accepted",
        "coinage_log_ref": "log-entry-021",
    },
]

# ── Colloquial terms ─────────────────────────────────────

COLLOQUIAL_TERMS = [
    {
        "colloquial_term": "alignment",
        "status": "do_not_use_bare",
        "translation_required": True,
        "resolves_to": [
            {"standardized_term": "safety_alignment", "when": "Used in technical AI safety contexts; co-occurs with alignment problem, RLHF, mesa-optimizers, goal specification", "default_for_camp": "safetyist", "confidence_typical": "high"},
            {"standardized_term": "commercial_alignment", "when": "Used in product/business contexts; co-occurs with user intent, product-market fit, instruction following", "default_for_camp": "accelerationist", "confidence_typical": "high"},
            {"standardized_term": "alignment_compliance", "when": "Used to mean compliance with values, especially with critique about whose values; co-occurs with value alignment, social norms", "default_for_camp": "skeptic", "confidence_typical": "medium"},
        ],
        "translation_ambiguous_when": [
            "Author appears to deliberately conflate senses",
            "No contextual signal disambiguates",
            "Author is critiquing the conflation itself"
        ],
    },
    {
        "colloquial_term": "safety",
        "status": "do_not_use_bare",
        "translation_required": True,
        "resolves_to": [
            {"standardized_term": "safety_existential", "when": "Used in existential risk contexts; co-occurs with extinction, x-risk, catastrophic, irreversible", "default_for_camp": "safetyist", "confidence_typical": "high"},
            {"standardized_term": "safety_empirical", "when": "Used in empirical verification contexts; co-occurs with testing, benchmarks, validation, red teaming", "default_for_camp": "accelerationist", "confidence_typical": "high"},
            {"standardized_term": "safety_alignment", "when": "Used as shorthand for the alignment problem; co-occurs with alignment, robustness, goal specification", "default_for_camp": "safetyist", "confidence_typical": "medium"},
        ],
        "translation_ambiguous_when": [
            "Generic usage without contextual markers",
            "Author uses 'safety' to mean both existential and empirical safety in the same passage",
        ],
    },
    {
        "colloquial_term": "governance",
        "status": "do_not_use_bare",
        "translation_required": True,
        "resolves_to": [
            {"standardized_term": "governance_oversight", "when": "Used to mean external institutional constraint on AI; co-occurs with regulation, monitoring, compliance", "default_for_camp": "safetyist", "confidence_typical": "high"},
            {"standardized_term": "governance_adaptive", "when": "Used to mean AI-augmented or dynamic governance systems; co-occurs with adaptive, real-time, AI-augmented, infrastructure", "default_for_camp": "accelerationist", "confidence_typical": "high"},
        ],
        "translation_ambiguous_when": [
            "General reference to governance without specifying who/what governs whom",
        ],
    },
    {
        "colloquial_term": "risk",
        "status": "do_not_use_bare",
        "translation_required": True,
        "resolves_to": [
            {"standardized_term": "risk_existential", "when": "Used to mean probability of catastrophic/extinction outcome; co-occurs with x-risk, existential, irreversible", "default_for_camp": "safetyist", "confidence_typical": "high"},
            {"standardized_term": "risk_innovation", "when": "Used to mean cost of over-regulation or stagnation; co-occurs with competitive disadvantage, falling behind, innovation cost", "default_for_camp": "accelerationist", "confidence_typical": "high"},
        ],
        "translation_ambiguous_when": [
            "Author discusses both types of risk without distinguishing",
            "Risk used in a neutral cost-benefit framing"
        ],
    },
    {
        "colloquial_term": "capabilities",
        "status": "do_not_use_bare",
        "translation_required": True,
        "resolves_to": [
            {"standardized_term": "capabilities_scaling", "when": "Used positively; co-occurs with scaling, frontier, emergent, advancement, progress", "default_for_camp": "accelerationist", "confidence_typical": "high"},
            {"standardized_term": "capabilities_hazard", "when": "Used as risk factor; co-occurs with outpacing, dangerous, loss of control, capability threshold", "default_for_camp": "safetyist", "confidence_typical": "high"},
        ],
        "translation_ambiguous_when": [
            "Neutral description of what a system can do without valence"
        ],
    },
    {
        "colloquial_term": "harm",
        "status": "do_not_use_bare",
        "translation_required": True,
        "resolves_to": [
            {"standardized_term": "documented_present_harm", "when": "References current, evidenced harm; co-occurs with discrimination, bias, labor displacement, surveillance", "default_for_camp": "skeptic", "confidence_typical": "high"},
            {"standardized_term": "speculative_future_harm", "when": "References hypothetical future harm; co-occurs with existential, catastrophic, civilizational, irreversible", "default_for_camp": "safetyist", "confidence_typical": "high"},
        ],
        "translation_ambiguous_when": [
            "Author discusses harm without temporal or evidential framing",
            "Author deliberately bridges present and future harm"
        ],
    },
    {
        "colloquial_term": "oversight",
        "status": "do_not_use_bare",
        "translation_required": True,
        "resolves_to": [
            {"standardized_term": "oversight_human_control", "when": "Emphasizes human authority, shutdown capability, veto; co-occurs with human-in-the-loop, corrigibility, kill switch", "default_for_camp": "safetyist", "confidence_typical": "high"},
            {"standardized_term": "oversight_audit", "when": "Emphasizes empirical verification, output checking; co-occurs with audit, monitoring, evaluation, reproducibility", "default_for_camp": "accelerationist", "confidence_typical": "high"},
        ],
        "translation_ambiguous_when": [
            "Generic use of oversight without specifying mechanism",
        ],
    },
    {
        "colloquial_term": "control",
        "status": "do_not_use_bare",
        "translation_required": True,
        "resolves_to": [
            {"standardized_term": "control_human_agency", "when": "Humans controlling AI; co-occurs with human authority, shutdown, veto, human-in-the-loop", "default_for_camp": "safetyist", "confidence_typical": "high"},
            {"standardized_term": "control_optimization", "when": "AI controlling systems; co-occurs with resource allocation, optimization, infrastructure, automated governance", "default_for_camp": "accelerationist", "confidence_typical": "high"},
        ],
        "translation_ambiguous_when": [
            "Subject-object ambiguity: who controls whom is unclear",
        ],
    },
    {
        "colloquial_term": "transparency",
        "status": "do_not_use_bare",
        "translation_required": True,
        "resolves_to": [
            {"standardized_term": "transparency_accountability", "when": "For external stakeholder oversight; co-occurs with accountability, public disclosure, liability, responsible AI", "default_for_camp": "safetyist", "confidence_typical": "high"},
            {"standardized_term": "transparency_verification", "when": "For scientific/empirical verification; co-occurs with reproducibility, audit, inspection, validation", "default_for_camp": "accelerationist", "confidence_typical": "high"},
        ],
        "translation_ambiguous_when": [
            "Generic call for transparency without specifying purpose",
        ],
    },
    {
        "colloquial_term": "regulation",
        "status": "do_not_use_bare",
        "translation_required": True,
        "resolves_to": [
            {"standardized_term": "regulation_precautionary", "when": "Pre-deployment restrictions; co-occurs with moratorium, licensing, safety proof, deployment gate", "default_for_camp": "safetyist", "confidence_typical": "high"},
            {"standardized_term": "regulation_adaptive", "when": "Post-deployment, flexible regulation; co-occurs with adaptive, market-based, innovation-preserving, iterative", "default_for_camp": "accelerationist", "confidence_typical": "high"},
        ],
        "translation_ambiguous_when": [
            "General reference to regulation without specifying pre/post deployment timing",
        ],
    },
]


def populate_used_by_nodes(data_root: Path, terms: list[dict]) -> None:
    """Fill in used_by_nodes for each standardized term based on its colloquial source."""
    colloquial_to_canonical = {}
    for t in terms:
        for bare in t["translates_from_colloquial"]:
            colloquial_to_canonical.setdefault(bare, []).append(t)

    for bare_term, std_terms in colloquial_to_canonical.items():
        camp_nodes = find_nodes_using_term(data_root, bare_term)
        for std_term in std_terms:
            camp = std_term["primary_camp_origin"]
            node_ids = camp_nodes.get(camp, [])
            # Also include nodes from camps where this sense appears
            std_term["used_by_nodes"] = node_ids[:20]  # Cap at 20 for initial pass


def write_standardized(dict_dir: Path, terms: list[dict]) -> None:
    out_dir = dict_dir / "standardized"
    out_dir.mkdir(parents=True, exist_ok=True)
    for i, term in enumerate(terms):
        entry = {"$schema_version": SCHEMA_VERSION, **term}
        entry["coined_at"] = TODAY
        entry["coined_by"] = REVIEWER
        fname = f"{term['canonical_form']}.json"
        (out_dir / fname).write_text(json.dumps(entry, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(terms)} standardized terms")


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
    print(f"Wrote {len(terms)} colloquial terms")


def write_coinage_log(dict_dir: Path, terms: list[dict]) -> None:
    lines = ["# Coinage Log\n"]
    lines.append("Append-only record of every vocabulary coining decision.\n")
    lines.append("---\n")

    for i, term in enumerate(terms):
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

    (dict_dir / "coinage_log.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote coinage log with {len(terms)} entries")


def main():
    data_root = _resolve_data_root()
    dict_dir = data_root / "dictionary"

    print(f"Data root: {data_root}")
    print(f"Dictionary: {dict_dir}")

    populate_used_by_nodes(data_root, STANDARDIZED_TERMS)
    write_standardized(dict_dir, STANDARDIZED_TERMS)
    write_colloquial(dict_dir, COLLOQUIAL_TERMS)
    write_coinage_log(dict_dir, STANDARDIZED_TERMS)
    print("\nDone! Run 'python scripts/build_sense_embeddings.py' to compute sense embeddings.")


if __name__ == "__main__":
    main()
