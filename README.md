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




============================
ACCELERATIONISTS
Drawing on the conceptual engineering of your "AI Triad Rosetta Stone," the following resources articulate the **Accelerationist** perspective. This cohort views AI not as a risk to be managed, but as a "thermodynamic will of the universe" and a moral imperative for solving civilizational stagnancy.

### The Essential Manifestos

* **[The Techno-Optimist Manifesto](https://a16z.com/the-techno-optimist-manifesto/) (Marc Andreessen, 2023)**: The foundational text for modern market-driven accelerationism. It argues that growth is the only "kill-all" for societal problems and identifies "stagnation" and "regulatory capture" as the primary enemies.
* **[Notes on e/acc Principles and Tenets](https://beff.substack.com/p/notes-on-eacc-principles-and-tenets) (Beff Jezos/Guillaume Verdon, 2022)**: The "physics-first" document that launched the effective accelerationism (e/acc) movement. It frames AI development as an inevitable process of climbing the "Kardashev gradient" to maximize energy usage and intelligence.
* **[The Monad Manifesto](https://www.google.com/search?q=https://www.jsnover.com/blog/2011/11/14/monad-manifesto/) (Jeffrey Snover, 2002)**: While internal to Microsoft, this serves as a historical precedent for "Accelerationist" engineering—solving friction (GUI vs. CLI) by layering systems rather than choosing between them.

---

### Philosophical & Academic Foundations

* **[The Philosophy of Speed: A Genealogy of Accelerationism](https://cwi.pressbooks.pub/aiethics/chapter/progress-and-abundance/) (CWI)**: A critical trace of the movement from Enlightenment "Progress" to modern e/acc, detailing the "techno-capital mimetic machine".
* **[Manifesto for an Accelerationist Politics](https://www.e-flux.com/journal/53/59877/reflections-on-the-manifesto-for-an-accelerationist-politics) (Williams & Srnicek, 2013)**: The "Left-Accelerationist" (L/Acc) root, advocating for the liberation of productive forces from capitalist constraints.
* **[Failure Modes in Machine Learning Systems](https://arxiv.org/abs/1911.11034) (Ram Shankar Iyer et al.)**: Co-authored by you, this paper reflects an early effort to unify the "Safetyist" focus on bias with the "Skeptic/Security" focus on attacks into a single taxonomy.

---

### Strategic & Operational POVs

* **[Why AI Will Save the World](https://a16z.com/ai-will-save-the-world/) (Marc Andreessen)**: A direct rebuttal to "Safetyist" doomerism, positioning AI as a universal problem-solver for everything from education to war.co
* **[Yann LeCun’s Home Page / UN Speech](http://yann.lecun.com/)**: LeCun argues that AI systems will be "empowering assistants" and that open-source development is the only way to avoid corporate/national moats.
* **[d/acc: One Year Later](https://vitalik.eth.limo/general/2025/01/05/dacc2.html) (Vitalik Buterin)**: A nuanced "Decentralized Accelerationist" view that favors defensive over offensive technologies to prevent elite capture.
* **[The AI Acceleration Gap](https://www.youtube.com/watch?v=cRhLXGGwOmQ) (The AI Daily Brief)**: Analyzes the divergence between "frontier adopters" and mainstream users, highlighting the career and equity risks of slowing down.

---

### Influential Digital Hubs & Commentary

* **[Beff’s Newsletter](https://beff.substack.com/)**: The primary Substack for Guillaume Verdon’s "schizo-thoughts" on physics, entropy, and AGI.
* **[Digitalist Papers](https://www.digitalistpapers.com/)**: Exploration of how AI reshapes human expertise, focusing on the "vast upside benefits" of the transition.
* **[Lex Fridman Podcast #407: Guillaume Verdon](https://www.reddit.com/r/lexfridman/comments/18tutgu/guillaume_verdon_beff_jezos_eacc_movement_physics/)**: A long-form articulation of e/acc's thermodynamic basis and its rejection of centralized regulation.
* **[Imagination In Action (Davos 2025)](https://www.youtube.com/watch?v=8ZG598NuQ9s)**: Yann LeCun on why AI won't "take over" and how open source ensures democratic access.
* **[Effective Accelerationism (Wikipedia)](https://en.wikipedia.org/wiki/Effective_accelerationism)**: A high-level overview of the movement’s origins in Nick Land’s "Cybernetic Culture Research Unit" (CCRU) and its current Silicon Valley proponents.

Would you like me to synthesize these into the "Data/Facts" vs. "Values" diagnostic framework you proposed for Phase 2 of your Fellowship?

[Guillaume Verdon: Beff Jezos, e/acc Movement, Physics, Computation & AGI](https://www.youtube.com/watch?v=8ZG598NuQ9s)
This video is relevant because it features a central figure of the e/acc movement explaining the movement's core philosophy and its relation to physics and AGI.

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
Update the taxonomy editor.
Add a "Similar Search" button the the results in pane 2.  When selected, the ;abel and description are used to make an embedding which
is used to search the other elements of the taxonomy.  Those results should be shown as a resizable table in Pane 3.
The columns of that table are: Match (the percentage match), Label, Description.  The text in the table should wrap in the table cell.
At the top of the table should be a slider with values from 40 to 100.  This slider determines the match value of the search elments to show.
The default value should be 60.  This means that only rows that have a match value of 60 or greater will be shown.  If the slider is set to 55,
then additional rows will show up.  If the slider is set to 70, rows will disappear.

If search results are in pane 3 and  a new item is selected in in pane 1 which updates pane 2, the search results should be updated focusing on the new item in pane 2.
The search results should have a toggle to be able to show/hide element IDs.  THe default should be to hide them.  When shown, they should be in column 2 - between Match and Label

The Columns in the Similar search results in Pane 3 should be resizable and sortable.  Pane 3 should be resizable.


Write a PowerShell module called Taxonomy . 
Upon initialization, it should load all the taxonomy elements in the json files in the taxonomy directory. 
It should implement:  Get-Tax  -POV [Name of the json file with out the json extension (e.g. "Skeptic") the default is "*"]  

For Similar Search results found in pane 3, add a popup menu with the element "Analyze Distinction".
When selected, the Label and Description of both the Item in Pane 2 and the Row in Pane 3 are to be 
fed into the following AI prompt (as Element A and Element B) and executed.  
The results should be displayed in a Pane 4 which is dynamically added and the overall window size is increased.
When Pane 4 is closed, the overall window should decrease in size.  Pane 4 should be resizable. 

The Audit Prompt
Role: Act as a Logical Analyst and Semantic Auditor.

Task: Compare two provided elements (Label + Description) to determine if they are functionally identical, semantically redundant, or if a meaningful distinction exists between them.

Evaluation Framework:

Semantic Mapping: Do the descriptions cover the same conceptual territory using different syntax?

Functional Utility: If one element were deleted, would any unique information, constraint, or application be lost?

The "So What?" Test: Does the difference in phrasing lead to a different real-world outcome or technical requirement?

Input Data:

Element A: [Insert Label & Description]

Element B: [Insert Label & Description]

Required Output Format:

The Verdict: [Identical | Redundant | Distinct]

The Delta: Identify the exact words or phrases that create a perceived difference. Analyze if these are "cosmetic" (synonyms) or "structural" (changing the scope).

Logical Gap: If you claim they are different, define the specific scenario where Element A applies but Element B does not. If they are the same, provide a single, "Steel-manned" version that consolidates both perfectly.

Blind Spot Check: Is one a subset of the other (Taxonomic overlap)?


================C
Create a SummaryViewer
It should have 3 panes: 
Pane 1 should show all the source documents.  There should be a Select toggle box next to each and a SELECT ALL toggle at the top.
Selected source documents then populate PANE 2 with a set of key_points records organized by POV (Acclerationist, Skeptic, etc)
WHen a Key Point is selected, Pane 3 displays the source document for the key point and navigates to its excerpt_context
