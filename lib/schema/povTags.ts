// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// POV tags (t/3955; spec research/comp-linguist/analyses/t3935-pov-tags/spec.md §2.1–2.3a; SO e/249).
//
// `pov_tags` is a TOP-LEVEL field on POV nodes only: an array of tag ids from the node's own POV in the
// registry lib/debate/soul-docs/pov-tags.json. It is curated, editor-owned data like `label`, not
// enrichment, which is why it is not under graph_attributes.
//
// ABSENCE SEMANTICS (SO e/249#6 condition 3; also stated in taxonomy-schema.json node_fields): an absent
// or empty `pov_tags` means UNTAGGED. Under a tag in SCOPE mode an untagged node is EXCLUDED, so coverage
// gaps silently narrow Scope debates; t/3962 asserts coverage and t/3957 WARNs with the excluded count.
//
// `validatePovTags` is the single rule. It is called by every live path that writes tags: the tagging CLI
// (pov-tags-cli.ts, the blocking gate t/3969 shells out to), the editor's renderer schema (SO condition 2),
// the lib Zod node schema, and the warn-first data-repo hook (t/3970).

import { z } from 'zod';
import registryJson from '../debate/soul-docs/pov-tags.json' with { type: 'json' };

/** Node-id prefix → registry POV key. Situation (`sit-*`) and retired `cc-*` nodes have no POV. */
export const POV_BY_ID_PREFIX: Readonly<Record<string, string>> = {
  acc: 'accelerationist',
  saf: 'safetyist',
  skp: 'skeptic',
};

/** Lowercase kebab-case, unique within its POV (spec §2.1). */
export const POV_TAG_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PovTagEntrySchema = z.object({
  id: z.string().regex(POV_TAG_ID_PATTERN, 'tag id must be lowercase kebab-case'),
  label: z.string().min(1),
  /** `<pov>.<tag>`: names lib/debate/soul-docs/<pov>.<tag>.soul.json. */
  soul_doc: z.string().min(1),
  description: z.string().min(1),
}).strict();

export const PovTagRegistrySchema = z.object({
  version: z.number().int().positive(),
  // partialRecord: a POV with no entry has no tags (spec §2.1). Zod 4's z.record with enum keys is exhaustive.
  povs: z.partialRecord(z.enum(['accelerationist', 'safetyist', 'skeptic']), z.array(PovTagEntrySchema)),
}).strict().superRefine((reg, ctx) => {
  for (const [pov, entries] of Object.entries(reg.povs)) {
    const seen = new Set<string>();
    for (const [i, e] of (entries ?? []).entries()) {
      if (seen.has(e.id)) ctx.addIssue({ code: 'custom', path: ['povs', pov, i, 'id'], message: `duplicate tag id "${e.id}" in ${pov}` });
      seen.add(e.id);
      if (e.soul_doc !== `${pov}.${e.id}`) {
        ctx.addIssue({ code: 'custom', path: ['povs', pov, i, 'soul_doc'], message: `soul_doc must be "${pov}.${e.id}", got "${e.soul_doc}"` });
      }
    }
  }
});

export type PovTagRegistry = z.infer<typeof PovTagRegistrySchema>;

let cached: PovTagRegistry | undefined;

/** The bundled registry, validated once. Throws if the committed file is malformed. */
export function loadPovTagRegistry(): PovTagRegistry {
  if (!cached) cached = PovTagRegistrySchema.parse(registryJson);
  return cached;
}

/**
 * Every problem with a node's `pov_tags`, or `[]` if it is valid. Pure; never throws.
 *  - absent (`undefined`/`null`) is valid for every node and means untagged;
 *  - a non-POV node (`sit-*`, `cc-*`, anything without an acc/saf/skp prefix) must not carry the field;
 *  - on a POV node the value must be an ARRAY of strings. A bare string is rejected: PowerShell unrolls a
 *    one-element array into a scalar (TL t/3955#4 cond 2), and accepting that would hide the corruption;
 *  - each id must be kebab-case, unique on the node, and registered under the node's own POV.
 */
export function validatePovTags(nodeId: string, tags: unknown, registry: PovTagRegistry = loadPovTagRegistry()): string[] {
  if (tags === undefined || tags === null) return [];
  const prefix = /^([a-z]+)-/.exec(nodeId)?.[1] ?? '';
  const pov = POV_BY_ID_PREFIX[prefix];
  if (!pov) return [`${nodeId}: pov_tags is only allowed on POV nodes (acc-/saf-/skp-); this node must not carry it`];
  if (!Array.isArray(tags)) {
    return [`${nodeId}: pov_tags must be an array of tag ids, got ${typeof tags}${typeof tags === 'string' ? ` "${tags}" (a one-element array unrolled to a scalar?)` : ''}`];
  }
  const allowed = new Set((registry.povs[pov as keyof PovTagRegistry['povs']] ?? []).map((t) => t.id));
  const seen = new Set<string>();
  return tags.flatMap((t) => tagProblems(nodeId, pov, t, allowed, seen));
}

/** Problems with one entry of a POV node's tag array; `seen` accumulates ids to catch duplicates. */
function tagProblems(nodeId: string, pov: string, t: unknown, allowed: ReadonlySet<string>, seen: Set<string>): string[] {
  if (typeof t !== 'string') return [`${nodeId}: pov_tags entries must be strings, got ${typeof t}`];
  const errors: string[] = [];
  if (!POV_TAG_ID_PATTERN.test(t)) errors.push(`${nodeId}: tag "${t}" is not lowercase kebab-case`);
  if (seen.has(t)) errors.push(`${nodeId}: tag "${t}" appears more than once`);
  seen.add(t);
  if (!allowed.has(t)) {
    errors.push(allowed.size === 0
      ? `${nodeId}: tag "${t}" is not registered; ${pov} has no tags in lib/debate/soul-docs/pov-tags.json`
      : `${nodeId}: tag "${t}" is not registered for ${pov} (allowed: ${[...allowed].sort().join(', ')})`);
  }
  return errors;
}

/**
 * Registry ↔ soul-file pairing (spec §2.1; CL t/3955#5: the JSON soul is the source of truth). Given the
 * registry and the file names in lib/debate/soul-docs, returns every unpaired tag: a registry tag with no
 * `<pov>.<tag>.soul.json`, or a `<pov>.<tag>.soul.json` with no registry entry. Pure; `[]` when paired.
 */
export function checkRegistrySoulPairs(registry: PovTagRegistry, soulDocFileNames: readonly string[]): string[] {
  const tagSouls = new Set(
    soulDocFileNames.map((f) => /^([a-z]+)\.([a-z0-9-]+)\.soul\.json$/.exec(f)).filter((m): m is RegExpExecArray => !!m).map((m) => `${m[1]}.${m[2]}`),
  );
  const registered = new Set(Object.entries(registry.povs).flatMap(([pov, entries]) => (entries ?? []).map((e) => `${pov}.${e.id}`)));
  const problems: string[] = [];
  for (const key of [...registered].sort()) if (!tagSouls.has(key)) problems.push(`registry tag "${key}" has no soul file ${key}.soul.json`);
  for (const key of [...tagSouls].sort()) if (!registered.has(key)) problems.push(`soul file ${key}.soul.json has no registry entry`);
  return problems;
}
