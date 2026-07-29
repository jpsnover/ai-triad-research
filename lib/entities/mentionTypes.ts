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
  /** The matched surface form, e.g. "Anthropic". */
  quote: string;
  /** Char offset of the mention into the container text. */
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
  /** SHA-256 of the exact text the extraction ran against; idempotency + staleness guard. */
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
