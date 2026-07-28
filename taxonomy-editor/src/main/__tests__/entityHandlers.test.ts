// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * t/1809: the `entity-resolve` IPC handler is the desktop mirror of the web route
 * GET /api/entity/:ref (server/routes/entity.ts). It drives the REAL handler by
 * mocking `electron` (capture the registered handler) plus the main-process data
 * layer (`../fileIO.js`, `../organizations.js`) — both transitively import electron
 * and can't load under vitest. parseEntityRef / EntityDetail come from the real
 * shared lib (no electron), so the contract is exercised unmocked.
 *
 * Asserts: malformed → throw (400-equivalent), resolve → typed EntityDetail,
 * miss → not_found, and the entity kind deferred to not_found.
 */

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  org: null as { id: string; name?: string } | null,
  policy: null as unknown,
  taxonomy: {} as Record<string, unknown>,
  entities: [] as unknown[],
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => { h.handlers.set(ch, fn); } },
}));

vi.mock('../fileIO.js', () => ({
  readTaxonomyFile: (pov: string) => h.taxonomy[pov] ?? null,
  readPolicyRegistry: () => h.policy,
  // Point the colloquial-dictionary dir at a nonexistent path so term lookups
  // resolve to [] deterministically (term resolution is covered by the server suite).
  getDataRootPath: () => '/no-such-data-root-for-entity-test',
  readEntities: () => h.entities,
}));

vi.mock('../organizations.js', () => ({
  getOrganizationById: (id: string) => (h.org && h.org.id === id ? h.org : null),
}));

// Imported AFTER the mocks so entityHandlers binds the mocked deps.
import { registerEntityHandlers } from '../ipc/entityHandlers.js';
import { ActionableError } from '../../../../lib/debate/errors.js';

function resolve(raw: string): unknown {
  const fn = h.handlers.get('entity-resolve');
  if (!fn) throw new Error('entity-resolve not registered');
  return fn({}, raw);
}

function listEntities(query?: unknown): unknown {
  const fn = h.handlers.get('list-entities');
  if (!fn) throw new Error('list-entities not registered');
  return fn({}, query);
}

beforeEach(() => {
  h.handlers.clear();
  h.org = null;
  h.policy = null;
  h.taxonomy = {};
  h.entities = [];
  registerEntityHandlers();
});

describe('entity-resolve IPC handler (t/1809)', () => {
  it('throws an ActionableError on a malformed ref (400-equivalent, not not_found)', () => {
    expect(() => resolve('not-a-real-ref')).toThrow(ActionableError);
  });

  it('resolves an organization ref to its record', () => {
    h.org = { id: 'org-42', name: 'Acme' };
    expect(resolve('org-42')).toEqual({
      ref: { kind: 'organization', id: 'org-42' },
      kind: 'organization',
      record: { id: 'org-42', name: 'Acme' },
    });
  });

  it('returns not_found for an organization miss', () => {
    expect(resolve('org-404')).toEqual({ ref: { kind: 'organization', id: 'org-404' }, kind: 'not_found' });
  });

  it('resolves a POV node ref from its camp file', () => {
    h.taxonomy = { accelerationist: { nodes: [{ id: 'acc-desires-001', label: 'x' }] } };
    expect(resolve('acc-desires-001')).toMatchObject({ kind: 'node', record: { id: 'acc-desires-001' } });
  });

  it('returns not_found for a node miss (right file, absent id)', () => {
    h.taxonomy = { accelerationist: { nodes: [] } };
    expect(resolve('acc-desires-999')).toMatchObject({ kind: 'not_found' });
  });

  it('resolves a policy ref (tolerates the { policies: [] } registry shape)', () => {
    h.policy = { policies: [{ id: 'pol-001' }] };
    expect(resolve('pol-001')).toMatchObject({ kind: 'policy', record: { id: 'pol-001' } });
  });

  it('resolves a situation ref from the situations file', () => {
    h.taxonomy = { situations: { nodes: [{ id: 'sit-007' }] } };
    expect(resolve('sit-007')).toMatchObject({ kind: 'situation', record: { id: 'sit-007' } });
  });

  it('defers the entity kind to not_found (entities.json not shipped)', () => {
    expect(resolve('ent-001')).toMatchObject({ ref: { kind: 'entity', id: 'ent-001' }, kind: 'not_found' });
  });
});

describe('list-entities IPC handler (t/1889)', () => {
  it('returns [] when the entity registry is empty (entities.json absent)', () => {
    expect(listEntities()).toEqual([]);
  });

  it('maps each entity to the 7-field EntitySummary, dropping non-summary fields', () => {
    h.entities = [{
      id: 'ent-001', name: 'Ada Lovelace', aliases: ['Ada'],
      entity_type: 'person', status: 'approved', confidence: 0.9, last_modified: '2026-07-28',
      // extra Entity fields that must NOT leak into the summary row:
      description: 'should be dropped', dolce_category: 'should be dropped', created_at: 'should be dropped',
    }];
    expect(listEntities()).toEqual([{
      id: 'ent-001', name: 'Ada Lovelace', aliases: ['Ada'],
      entity_type: 'person', status: 'approved', confidence: 0.9, last_modified: '2026-07-28',
    }]);
  });

  it('returns one row per entity and ignores the v1 query (client-side filtering — TL t/1766#7)', () => {
    h.entities = [
      { id: 'ent-001', name: 'A', aliases: [], entity_type: 'person', status: 'approved', confidence: 1, last_modified: 'x' },
      { id: 'ent-002', name: 'B', aliases: [], entity_type: 'artifact', status: 'proposed', confidence: 1, last_modified: 'y' },
    ];
    const rows = listEntities({ search: 'A', type: 'person' }) as unknown[];
    expect(rows).toHaveLength(2);   // v1 returns the full list; query accepted for forward-compat, not applied
  });
});
