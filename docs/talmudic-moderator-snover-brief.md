# Talmudic Moderator Experiment — Breadcrumb Notes

Start here: [scripts/TalmudicDebate/README.md](../scripts/TalmudicDebate/README.md). It explains how to initialize the local corpus, run a debate, review the evidence, run matched comparisons, and understand the main configuration choices.

- **Why this exists:** I explored how a Talmudic component could participate in the AI Triad. I used the suggested moderator concept, so the Talmudic feature is implemented as a moderator rather than as a fourth debater.
- **Current entry point:** I worked through the CLI and generated debate logs. I did not spin up or exercise the Web UI.
- **What the moderator does:** It diagnoses the debate’s crux, disagreement type, disputed premise, and unresolved point, then can select one relevant passage from a small local pilot corpus.
- **What the source path adds:** The selected passage is shown in the transcript with its citation, excerpt, edition/license, use label, guardrails, and a warning that the application is provisional—not a modern policy ruling.
- **What the next debater must do:** The responding debater records whether it accepts, rejects, distinguishes, or limits the comparison, plus one relevant similarity and one limiting difference.
- **Where to inspect the chain:** Debate JSON records candidate scores, selected card, checksum, rationale, moderator entry, response entry, stance, similarity, limiting difference, and validation warnings. The PowerShell reviewer surfaces these fields.
- **How it is tested:** The implementation has deterministic retrieval, corpus/license/checksum validation, citation and excerpt checks, prompt-injection boundaries, duplicate claim-ID protection, response validation, persistence tests, and legacy method-only coverage.
- **What I can and cannot conclude:** It looked coherent to my eye in CLI runs and mocked end-to-end tests, but I did not develop enough depth with the original system or the Web UI to determine whether all of the application’s pieces connect correctly in practice.
- **Next evaluation step:** Run repeated matched method-only versus source-grounded debates and inspect whether the references produce sharper distinctions and limitations rather than merely adding source decoration. The README includes the exact commands and review path.
