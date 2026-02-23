# AI Triad Research Repository

**Status:** Private (→ Public after v1.0 release)
**Fellowship:** Berkman Klein Center, 2026
**Blueprint version:** 1.0.0

## Purpose
This repository is the source-of-truth for the AI Triad research project.
It contains source documents, conceptual taxonomies, AI-generated POV summaries,
and a living factual-conflict log.

## Directory Layout
\\\
taxonomy/           Conceptual taxonomy (one file per POV camp)
sources/            Ingested source documents (raw + Markdown snapshot + metadata)
summaries/          AI-generated POV summaries (keyed by doc-id)
conflicts/          Living log of disputed factual claims (keyed by claim-id)
rolodex-index/      Public-safe person IDs (no PII; full data in private rolodex repo)
poviewer/           POViewer application code (TBD)
scripts/            Ingestion, batch-summarize, audit scripts
.github/workflows/  GitHub Actions (batch reprocess on taxonomy version bump)
\\\

## Quick Start
\\\ash
# Ingest a URL
python scripts/ingest.py --url https://example.com/article --pov accelerationist

# Ingest everything in sources/_inbox/
python scripts/ingest.py --inbox

# Manually trigger batch reprocess (normally run by GitHub Actions)
python scripts/batch_summarize.py
\\\

## Taxonomy Version
Current: **\0.0.0.1**
See \TAXONOMY_VERSION\ for the current version string.
To bump: edit \	axonomy/*.json\, update \TAXONOMY_VERSION\, open a PR.

## Private-to-Public Checklist
- [ ] Run \python scripts/audit_pii.py\ — zero findings required
- [ ] Review all \conflicts/*.json\ human_notes for inadvertent PII
- [ ] Tag last private commit: \git tag v0-private-archive\
- [ ] Flip repo visibility in GitHub Settings



Here are a list of Safetyist Papers to ingest:In your fellowship proposal, you define **Safetyists** as those who "warn of catastrophic, irreversible, potentially existential risks and potential loss of control".

Given your background in **Site Reliability Engineering (SRE)** and your intent to build "conceptual infrastructure" for governance, the following 10 resources represent the most influential papers, books, and frameworks from the Safetyist POV. These range from foundational philosophy to the operational "versioned" policies you advocate for.

### 1. **"Superintelligence: Paths, Dangers, Strategies"** (Book)

* **Author:** Nick Bostrom (2014)
* **Why it Matters:** The "Ur-text" for the Safetyist community. It popularized the concept of **instrumental convergence**—the idea that any sufficiently intelligent agent will seek power and resources as a means to its end, regardless of its original goal.

### 2. **"Unsolved Problems in ML Safety"** (Paper)

* **Authors:** Dan Hendrycks et al. (2022)
* **Why it Matters:** This maps directly to your interest in **SRE principles**. It identifies four technical pillars: robustness, monitoring, alignment, and systemic safety. It is the primary technical roadmap for the Center for AI Safety.

### 3. **"Is Power-Seeking AI an Existential Risk?"** (Report)

* **Author:** Joe Carlsmith (2022)
* **Why it Matters:** A rigorous, 100-page "probabilistic" assessment of the risk of AI takeover. It is the most cited document for quantifying the likelihood of "Safetyist" catastrophic outcomes.

### 4. **"Human Compatible: AI and the Problem of Control"** (Book)

* **Author:** Stuart Russell (2019)
* **Why it Matters:** Russell, a foundational figure in AI, argues that the current "standard model" of AI (optimizing for a fixed objective) is inherently dangerous. He proposes **Provisional Reward Uncertainty**—systems that are never sure of the human's goal and thus remain submissive.

### 5. **"Situational Awareness: The Decade Ahead"** (Series/Web)

* **Author:** Leopold Aschenbrenner (2024)
* **Why it Matters:** This is the current "viral" text in the field. It bridges the gap between **Accelerationism** (economic explosion) and **Safetyism** (existential security), arguing that AGI is coming by 2027 and requiring a Manhattan Project-level safety effort.

### 6. **"Natural Selection Favors AI Over Humans"** (Paper)

* **Author:** Dan Hendrycks (2023)
* **Why it Matters:** It frames the alignment problem through an **evolutionary lens**. It argues that because "selfish" agents outcompete "altruistic" ones, AI agents will naturally evolve traits that are undesirable for humans unless we intervene in the selection process.

### 7. **Anthropic’s "Responsible Scaling Policy" (RSP)** (Web/Framework)

* **Entity:** Anthropic (Updated 2025)
* **Why it Matters:** This is an example of the "Durable Policy Framework" you aim to create. It defines specific **AI Safety Levels (ASL)** that trigger mandatory safety protocols as model capabilities increase.

### 8. **OpenAI’s "Preparedness Framework"** (Web/Framework)

* **Entity:** OpenAI (Updated 2025)
* **Why it Matters:** Focuses on tracking "frontier" risks in CBRN (Chemical, Biological, Radiological, and Nuclear), cybersecurity, and **persuasion/deception**. It represents the operational side of catastrophic risk monitoring.

### 9. **"Concrete Problems in AI Safety"** (Paper)

* **Authors:** Amodei et al. (2016)
* **Why it Matters:** This was the first major collaborative paper (OpenAI, DeepMind, Google) to bridge the gap between "far-out" existential risk and **near-term engineering challenges** like "reward hacking" and "safe exploration."

### 10. **"AI Alignment Strategies from a Risk Perspective"** (Paper)

* **Authors:** Independent Researchers (2025/2026)
* **Why it Matters:** A very recent analysis that applies "defense-in-depth" (another SRE favorite) to identify shared failure modes across different alignment techniques.

---

**Would you like me to map these specifically to your "Phase 1 Survey" to identify which "Accelerationist" goals they currently ignore?**




===============
Write a feature specification to:
1) Convert the "Find dialog box" into a "search bar" at the top of the screen
2) Add a new mode "Semantic" which allows users to enter a sentence and then the tool turns that into an embedding and does a "embedding" search of the taxonomy.  When you write the spec, be precise about how we will turn the taxonomy into a set of embeddings.  




Act as a world class product manager and UX designer and Developer
POV Viewer Point of View viewer
Write a Design specification for a POViewer
This tool will show sources, analyze the "points" in the source, map those "Points" to differnt Points of View as expressed in a set of Taxonomies that can be loaded and stored.The taxonomies define a POV's 1) Goals/Values 2) Methods 3) Data/Facts

This tool needs to be able to organize work into a set of Notebooks similar to NotebookLM.
It will have a 3 pane design:  Pane 1:  Sources  Pane 2: Source Viewer  Pane 3: Different POVs 
Each Notebook should be able to add a varitey of source similar to notebookLM.
Each source should have the ability to be selected or deselected.
The sources can be web URLs, or PDF files.
When a source is selected, it is analyzed and compared against a set of different POV taxonomies.
When a point is mapped to a taxonomy, that point is highlighted with a color representing the POV it maps to.  The point might agree with or contract that taxonomy element.  The point might also map to different taxonomies or multiple points in the taxonomy.  So this could be quite complex.  Analzye this and suggest a simple method for 1) visually highlighting the element in the source.  2) display in Pane 3 how this point maps to the different POVs and how it maps to them.

Ask me a set of clarifying questions and don't produce the design specification until I tell you to.
Q: How granular should a 'point' be in the source viewer?
A: AI decides (AI segments the document into logical claims)
Q: When a point maps to MULTIPLE POVs, how should it be colored?
A: Neutral color + number badge showing how many POVs it touches
Q: How should AGREE vs. CONTRADICT be shown visually on a highlight?
A: Pane 3 shows agree/contradict — the highlight itself stays simple
Q: How granular should a 'point' be in the source viewer?
A: AI decides (AI segments the document into logical claims)

Q: When a point maps to MULTIPLE POVs, how should it be colored?
A: Neutral color + number badge showing how many POVs it touches

Q: How should AGREE vs. CONTRADICT be shown visually on a highlight?
A: Color for POV camp + icon overlay (✅ agree / ⚠️ contradict)







===========================
Add a mechanism to add sources to a notebook
Add a search bar to find elements in the selected sources.  Search should support RAW search, Wildcard search, and Regex search modes.  Each mode should have an option to be case sensitive or not.  THe default is case insenstive.  

Implement POViewer_Phase2_Spec.docx.pdf  and use Gemini as the default AI engine.
