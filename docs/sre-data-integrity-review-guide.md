# SRE Agent: Data Integrity Review Guide

**Purpose:** Structured review guidance for an SRE agent to assess and maintain data integrity across the AI Triad platform.
**Controls:** Derived from SRE:CONTROL:040, 043, 044, 045, 046, 050, 111 (Data Integrity category).
**Scope:** All persistent data across both repos (ai-triad-research code, ai-triad-data data).

---

## Data Assets Inventory

Before reviewing, understand what data exists and where it lives:

| Asset | Location (data repo) | Format | Write Frequency | Criticality |
|---|---|---|---|---|
| POV taxonomy files | `taxonomy/Origin/{pov}.json` | JSON | On user edit or AI extraction | **Critical** — source of truth for all POV knowledge |
| Cross-cutting nodes | `taxonomy/Origin/cross-cutting.json` | JSON | On user edit | **Critical** — multi-POV contested concepts |
| Embeddings | `taxonomy/Origin/embeddings.json` | JSON | On node edit or batch rebuild | High — search/relevance depends on it |
| Source metadata | `sources/{doc-id}/metadata.json` | JSON | On document import | High — provenance chain root |
| Source snapshots | `sources/{doc-id}/snapshot.md` | Markdown | On document import | High — immutable after creation |
| Summaries | `summaries/{doc-id}.json` | JSON | On AI summarization | High — derived but expensive to regenerate |
| Conflicts | `conflicts/{claim-id}.json` | JSON | On conflict detection or harvest | Medium — derived from summaries |
| Debate sessions | `debates/debate-{id}.json` | JSON | Continuously during debate | Medium — user-driven, can't regenerate |
| Policy registry | `taxonomy/Origin/policy_actions.json` | JSON | On user edit | Medium |
| Edges | `taxonomy/Origin/edges.json` | JSON | On user edit or AI discovery | Medium |
| Harvests | `harvests/{manifest-id}.json` | JSON | After debate harvest | Low — audit trail only |

---

## Review 1: At-Rest Data Corruption Detection

**Control:** SRE:CONTROL:040
**When:** Weekly automated check + after any batch operation (re-summarization, schema migration, embedding rebuild)
**Tool:** Run `Get-TaxonomyHealth` (PowerShell) or implement equivalent checks

### What to check

**1.1 JSON Parse Validity**

Every JSON file in the data repo must parse without error.

```
Files to check:
  taxonomy/Origin/*.json
  sources/*/metadata.json
  summaries/*.json
  conflicts/*.json
  debates/*.json
  harvests/*.json
```

Look for:
- Truncated files (incomplete JSON — sign of crash during non-atomic write)
- Zero-byte files (write failed before any content)
- Files with trailing garbage after the closing `}`
- Invalid UTF-8 sequences (can occur from document ingestion)

**1.2 Schema Conformance**

Validate taxonomy files against their JSON schemas:
- `taxonomy/schemas/pov-taxonomy.schema.json` — validates POV files
- `taxonomy/schemas/situations-taxonomy.schema.json` — validates cross-cutting file

Look for:
- Nodes missing required fields (`id`, `label`, `description`, `category`)
- Category values not in `{Beliefs, Desires, Intentions}`
- Node IDs not matching pattern `^(acc|saf|skp)-(goals|data|methods)-\d{3}$`
- `parent_relationship` values not in `{is_a, part_of, specializes}`

**1.3 Embedding Consistency**

File: `taxonomy/Origin/embeddings.json`

Look for:
- `node_count` field does not match `Object.keys(nodes).length`
- Vectors with wrong dimension (should all be 384 for `all-MiniLM-L6-v2`)
- Nodes referenced in embeddings that no longer exist in taxonomy files
- Taxonomy nodes that have no embedding entry (coverage gap)

---

## Review 2: Referential Integrity

**Control:** SRE:CONTROL:043, SRE:CONTROL:050
**When:** After any node creation, deletion, rename, or parent-child change. Weekly sweep for drift.

### What to check

**2.1 Parent-Child Consistency**

For each POV file (`accelerationist.json`, `safetyist.json`, `skeptic.json`):

| Check | How | Severity |
|---|---|---|
| Every `children[id]` exists as a node in the same POV file | Iterate nodes, lookup each child ID | **Critical** |
| No duplicate entries in any `children[]` array | `Set(children).size === children.length` | High |
| If node has `parent_id`, the parent's `children[]` includes this node's ID | Bidirectional check | High |
| No node lists itself as its own child or parent | `id !== parent_id`, `!children.includes(id)` | High |
| No circular parent chains | Walk parent_id chain, detect cycles | Medium |

**2.2 Cross-File References**

| Reference Field | Source File | Target | Check |
|---|---|---|---|
| `cross_cutting_refs[]` on POV nodes | `{pov}.json` | `cross-cutting.json` | Every ref ID exists in cross-cutting nodes |
| `linked_nodes[]` on CC nodes | `cross-cutting.json` | `{pov}.json` files | Every ref ID exists in some POV file |
| `conflict_ids[]` on any node | `{pov}.json`, `cross-cutting.json` | `conflicts/*.json` | Every ID matches a conflict filename |
| `debate_refs[]` on any node | `{pov}.json`, `cross-cutting.json` | `debates/debate-*.json` | Every ID matches a debate file |

**2.3 Summary References**

For each `summaries/{doc-id}.json`:

| Check | How | Severity |
|---|---|---|
| `doc_id` matches filename | Parse filename, compare to field | High |
| Every `key_points[].taxonomy_node_id` (non-null) exists in some POV file | Lookup in all 3 POV files | Medium |
| Every `factual_claims[].linked_taxonomy_nodes[]` ID exists | Same lookup | Medium |
| A matching `sources/{doc-id}/metadata.json` exists | File existence check | High |

**2.4 Conflict References**

For each `conflicts/{claim-id}.json`:

| Check | How | Severity |
|---|---|---|
| Every `linked_taxonomy_nodes[]` ID exists in some POV or CC file | Lookup | Medium |
| Every `instances[].doc_id` has a matching source in `sources/` | File existence check | Medium |

---

## Review 3: Write Atomicity

**Control:** SRE:CONTROL:111
**When:** Code review of any PR that touches file write paths. Audit existing write paths quarterly.

### What to check

Verify every persistent write uses the atomic pattern: write to `.tmp` then `fs.renameSync` (or PowerShell equivalent). Non-atomic writes risk truncation on process crash.

| Write Path | File | Atomic? | Action Needed |
|---|---|---|---|
| Taxonomy save (TS) | `taxonomy-editor/src/main/fileIO.ts:160-173` | Yes (`writeJsonFileAtomic`) | None |
| Summary write (PS) | `scripts/AITriad/Public/Invoke-POVSummary.ps1:413-415` | **No** — uses `Set-Content` | Convert to write-tmp-then-rename |
| Conflict create (PS) | `scripts/AITriad/Public/Find-Conflict.ps1:112,127` | **No** — uses `Set-Content` | Convert to write-tmp-then-rename |
| Conflict create (TS harvest) | `taxonomy-editor/src/main/ipcHandlers.ts:214-216` | Yes | None |
| Debate save | `taxonomy-editor/src/main/debateIO.ts:61-66` | **No** — uses `writeFileSync` | Convert to write-tmp-then-rename |
| Embeddings update | `taxonomy-editor/src/main/embeddings.ts:207` | **No** — uses `writeFileSync` | Convert to write-tmp-then-rename |
| Metadata update (PS) | `scripts/AITriad/Public/Invoke-POVSummary.ps1:434` | **No** — uses `Set-Content` | Convert to write-tmp-then-rename |

### Atomic write pattern (TypeScript)

```typescript
// CORRECT — used in fileIO.ts writeJsonFileAtomic
const tmpPath = filePath + '.tmp';
fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
fs.renameSync(tmpPath, filePath);
```

### Atomic write pattern (PowerShell)

```powershell
# CORRECT pattern for PowerShell
$tmpPath = "$FilePath.tmp"
Set-Content -Path $tmpPath -Value $json -Encoding UTF8
Move-Item -Path $tmpPath -Destination $FilePath -Force
```

---

## Review 4: Data Recovery Capability

**Control:** SRE:CONTROL:044, SRE:CONTROL:046
**When:** Quarterly drill. After any data loss incident.

### What to check

**4.1 Recovery from taxonomy corruption**

Scenario: A POV file (`accelerationist.json`) is corrupted (truncated, invalid JSON, or semantically wrong).

| Step | Verify |
|---|---|
| Can you identify the last known-good commit in data repo? | `git log -- taxonomy/Origin/accelerationist.json` produces history |
| Can you restore it? | `git checkout <sha> -- taxonomy/Origin/accelerationist.json` succeeds |
| Does the app load correctly after restore? | Taxonomy Editor launches and shows the restored nodes |
| Are embeddings still valid? | Run `Update-TaxEmbeddings` to regenerate for changed nodes |
| Are downstream references intact? | Run referential integrity checks from Review 2 |

**4.2 Recovery from summary corruption**

Scenario: A batch re-summarization produced bad output for 10 documents.

| Step | Verify |
|---|---|
| Can you identify affected summaries? | `git diff` between pre/post batch shows changed files |
| Can you revert them selectively? | `git checkout <pre-batch-sha> -- summaries/{doc-id}.json` for each |
| Can you regenerate from sources? | `Invoke-POVSummary -DocId <id>` succeeds using source snapshot |
| Are conflicts derived from bad summaries cleaned up? | `Find-Conflict` re-run produces correct conflicts |

**4.3 Recovery from embedding corruption**

Scenario: `embeddings.json` is corrupted or vectors are from wrong model.

| Step | Verify |
|---|---|
| Can you regenerate from scratch? | `Update-TaxEmbeddings` rebuilds all vectors from current taxonomy |
| How long does full rebuild take? | Time it. Should complete in < 10 minutes for ~450 nodes. |
| Does semantic search work after rebuild? | Verify in Taxonomy Editor search panel |

**4.4 Git as backup**

| Check | How | Severity |
|---|---|---|
| Data repo has remote configured | `git remote -v` in ai-triad-data | **Critical** |
| Remote is reachable and up-to-date | `git fetch --dry-run` succeeds | **Critical** |
| No uncommitted changes older than 24 hours | `git status` + check modification dates | High |
| Code repo and data repo are at compatible versions | Compare TAXONOMY_VERSION in both | Medium |

---

## Review 5: Recovery Objectives

**Control:** SRE:CONTROL:045
**When:** Define once, review quarterly, update after any data loss incident.

### Recommended objectives

| Dataset | RPO (max data loss) | RTO (recovery time) | Notes |
|---|---|---|---|
| Taxonomy files | Last git commit (< 1 day) | < 15 min (git restore) | Highest priority. Manual edits are expensive. |
| Embeddings | Regenerable | < 10 min (full rebuild) | Derived from taxonomy. No RPO needed. |
| Source snapshots | Zero loss (immutable) | < 5 min (git restore) | Created once at import, never modified. |
| Summaries | Regenerable | < 2 hours (batch re-summarize) | Expensive to regenerate (AI API cost + time). |
| Conflicts | Regenerable | < 30 min (re-run Find-Conflict) | Derived from summaries. |
| Debates | Last save point | < 5 min (git restore) | User-created content, cannot regenerate. |

### Validate quarterly

- [ ] `git log --since="24 hours ago"` shows recent commits in data repo (data is being committed)
- [ ] `git remote -v` shows a remote (backup exists outside this machine)
- [ ] Full taxonomy restore drill completed in under 15 minutes
- [ ] Embedding rebuild drill completed in under 10 minutes
- [ ] Single-document re-summarization tested successfully

---

## Review 6: In-Flight Data Corruption

**Control:** SRE:CONTROL:111
**When:** Code review of any PR that processes AI output. Quarterly audit of AI → persistence pipelines.

### AI output pipelines to audit

Each pipeline takes AI-generated text, parses it, and writes to persistent storage. The risk is that malformed or hallucinated AI output corrupts the data store.

**Pipeline 1: Summary Generation**

```
Document text → AI model → JSON response → Parse → Validate → Write summary
```

| Stage | File | Validation | Gap |
|---|---|---|---|
| AI response | `Invoke-POVSummary.ps1:295` | None (raw text) | — |
| JSON parse | `Invoke-POVSummary.ps1:326-344` | Parse with repair for truncated JSON | Repaired JSON may be semantically wrong |
| Key structure | `Invoke-POVSummary.ps1:346-351` | Required keys present | Doesn't check key_points structure |
| Stance values | `Invoke-POVSummary.ps1:353-373` | Enum validation | Good |
| Density | `Invoke-POVSummary.ps1:384-396` | Floor check | Good |
| **Node IDs** | — | **Not validated** | AI may invent IDs like `acc-desires-999` that don't exist |
| Write | `Invoke-POVSummary.ps1:413` | None | Non-atomic |

**Pipeline 2: Argument Network Extraction**

```
Debate statement → AI model → JSON claims → Parse → Validate overlap → Write to session
```

| Stage | File | Validation | Gap |
|---|---|---|---|
| AI response | `useDebateStore.ts:172` | None | — |
| JSON parse | `useDebateStore.ts:173-176` | Strip code fences, bracket extraction | Fragile |
| Claims structure | `useDebateStore.ts:178-179` | Array check | Doesn't validate claim.text exists |
| **Word overlap** | `useDebateStore.ts:196-204` | **>30% overlap with statement** | Good — prevents hallucinated claims |
| **Prior claim refs** | `useDebateStore.ts:222-225` | **Checks prior ID exists** | Good — prevents phantom references |
| Write | `useDebateStore.ts:254-265` | Via Zustand `set()` | Debate save may not be atomic |

**Pipeline 3: Document Analysis (new)**

```
Document text → AI model → JSON i-nodes → Parse → Write to session → Seed argument network
```

| Stage | File | Validation | Gap |
|---|---|---|---|
| AI response | `useDebateStore.ts:1138` | None | — |
| JSON parse | `useDebateStore.ts:1143` | `parseAIJson` | Tolerant parser |
| i_nodes check | `useDebateStore.ts:1144` | Array exists and non-empty | Doesn't validate individual i-node structure |
| **Taxonomy refs** | — | **Not validated** | AI may invent node IDs not in taxonomy |
| Write | `useDebateStore.ts:1155-1170` | Via Zustand `set()` | Same debate save atomicity concern |

**Pipeline 4: Debate Harvest**

```
Debate synthesis → User selects items → AI generates descriptions → Write to taxonomy/conflicts
```

| Stage | File | Validation | Gap |
|---|---|---|---|
| Conflict creation | `ipcHandlers.ts:209-218` | Atomic write | Good |
| Steelman update | `ipcHandlers.ts:244-270` | Atomic write | Good |
| Debate ref add | `ipcHandlers.ts:221-242` | Duplicate check, atomic write | Good |
| Verdict add | `ipcHandlers.ts:272-283` | Atomic write | **No schema validation on verdict object** |

### What to look for in each pipeline

1. **Does parsed AI output get schema-validated before persisting?** (Usually: no)
2. **Are referenced IDs (node IDs, conflict IDs, debate IDs) verified to exist?** (Usually: no)
3. **Is the write atomic?** (TypeScript taxonomy writes: yes. PowerShell writes: no. Debate saves: no.)
4. **Is there a rollback path if the write succeeds but the data is semantically wrong?** (Usually: git revert only)

---

## Review Schedule Summary

| Review | Frequency | Trigger | Estimated Time |
|---|---|---|---|
| 1. At-rest corruption detection | Weekly + after batch ops | Automated (CI or cron) | 5 min automated |
| 2. Referential integrity | Weekly + after node CRUD | Automated (CI or cron) | 5 min automated |
| 3. Write atomicity audit | Quarterly + PR review | Code changes to write paths | 30 min manual |
| 4. Recovery drill | Quarterly | Scheduled | 1 hour manual |
| 5. Recovery objectives review | Quarterly | Scheduled or post-incident | 30 min manual |
| 6. AI pipeline audit | Quarterly + PR review | Code changes to AI pipelines | 1 hour manual |
