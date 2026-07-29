// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// The entity-mention index contract (entity-ontology-proposal §5, epic t/1890).
// `entity_mentions.json` maps a container to the entity references detected in its
// text — the unifier layer across the facts / POV / debate stores. Shipped
// interface-first (t/1893) so the indexer (B), read path (C), and resolver (D1)
// all build in parallel against one frozen shape.
//
// The whole file is a DERIVED ARTIFACT: nothing here is a source of truth. The
// retroactive re-index (§7) can rebuild it from containers plus approved entities,
// which is what licenses "apply-late-or-never" as a supported outcome. This is a
// type-only contract — no runtime logic lives here.
//
// ── GEOMETRY INVARIANT (Main-TL ruling, t/1893#4) ────────────────────────────────
// All mention geometry — `offset`, `quote`, and `text_sha256` — is defined over the
// NFC-CANONICAL form of the container text. Every producer AND every consumer MUST
// NFC-canonicalize the container text before computing OR applying an offset or hash.
// This is a decision, not a description of what any one implementation happens to do.
// Why it's load-bearing: if a producer hashes/offsets over NFC-canonical text but a
// consumer indexes the raw (non-NFC) text, then the moment a denormalized sequence
// appears earlier in the text, every `offset` points at the wrong character, `quote`
// fails to substring-match, and — worst — `text_sha256` never matches, so the
// supersession guard false-fires and silently drops every patch as "stale". Rare
// input, latent bug, miserable to debug. Decide once; consumers build to it. (NFC is
// already the basis D1's resolver and indexer B use for alias normalization, so this
// is consistent, not a new axis.) Consumers to hold to it: C (t/1895) re-hashes the
// NFC-canonical entry text; E (t/1898) NFC-canonicalizes before applying `offset`.

import type { EntityRef } from './types.js';

/**
 * How a mention came to be linked. Kept distinct so an automated pass can never
 * overwrite a human correction (§5): `human` entries are authoritative over
 * `alias` (deterministic table match) and `extraction` (statement-side instrument).
 */
export type MentionProvenance = 'alias' | 'extraction' | 'human';

/**
 * Container key. For debates this is `<debate_id>#<entry_id>` (one bucket per turn),
 * so a per-turn patch touches exactly one key and never rewrites a sibling turn.
 */
export type ContainerId = string;

/**
 * A single detected reference within one container's text.
 *
 * `entity_ref` is persisted as the **raw token string** (e.g. `"org-001"`,
 * `"term:foo"`), NOT a pre-parsed {@link EntityRef}. The kind union lives in code
 * (`parseEntityRef`), so storing the parsed shape would freeze a type decision into
 * data and force a migration every time the kind set changes — it already changed
 * once (the `organization` split). Parse at read time.
 */
export interface Mention {
  /** Raw ref token; typed on read by `parseEntityRef()`. Never persisted pre-parsed. */
  entity_ref: string;
  /** The matched surface form, e.g. "Anthropic"; sliced from the NFC-canonical container
   *  text (case preserved). See the Geometry Invariant in the file header. */
  quote: string;
  /** Char offset of the mention into the **NFC-canonical** container text. See the
   *  Geometry Invariant in the file header. */
  offset: number;
  /** Provenance — governs the human-wins overwrite rule (§5). */
  discovered_by: MentionProvenance;
}

/**
 * All mentions extracted from one container, plus the guard that keeps them honest.
 *
 * `text_sha256` is **per container, not per mention** (§5): it is the hash of the
 * exact text the extraction pass ran against. It doubles as the idempotency key and
 * the supersession guard — on apply, if the container's current text hashes
 * differently, the patch was computed from text that no longer exists and is dropped.
 */
export interface ContainerMentions {
  /** SHA-256 of the **NFC-canonical** container text the extraction ran against; idempotency
   *  + staleness guard. Consumers MUST hash the NFC-canonical form or the guard false-fires —
   *  see the Geometry Invariant in the file header. */
  text_sha256: string;
  /** ISO-8601 timestamp of the extraction pass. */
  extracted_at: string;
  mentions: Mention[];
}

/**
 * On-disk shape of `entity_mentions.json`. A derived artifact — rebuildable by
 * re-index (§7), so absence of a container means "no links yet", never an error.
 */
export interface EntityMentionsFile {
  /** Schema version; starts at "1.0.0". */
  _schema_version: string;
  /** Human-facing note that this file is derived and rebuildable. */
  _doc: string;
  /** ISO-8601 (date or datetime) of the last write to the file. */
  last_modified: string;
  /** Container id → its extracted mentions. */
  containers: Record<ContainerId, ContainerMentions>;
}

// `EntityRef` is imported type-only above to anchor the doc reference from
// `Mention.entity_ref` (the raw token these mentions carry parses into an EntityRef).
export type { EntityRef };
