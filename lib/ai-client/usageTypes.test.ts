// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderTemplate, loadUsageRegistry, validateUsageConfig } from './usageTypes.js';
import type { ModelRegistry } from './registry.js';

// ── renderTemplate ──────────────────────────────────────

describe('renderTemplate', () => {
  it('replaces single variable', () => {
    expect(renderTemplate('Hello {{name}}!', { name: 'World' })).toBe('Hello World!');
  });

  it('replaces multiple variables', () => {
    const result = renderTemplate('{{greeting}} {{name}}, welcome to {{place}}', {
      greeting: 'Hello',
      name: 'Alice',
      place: 'Wonderland',
    });
    expect(result).toBe('Hello Alice, welcome to Wonderland');
  });

  it('passes through template with no placeholders', () => {
    expect(renderTemplate('No variables here', {})).toBe('No variables here');
  });

  it('handles empty string values', () => {
    expect(renderTemplate('Before{{gap}}After', { gap: '' })).toBe('BeforeAfter');
  });

  it('throws ActionableError for single missing variable', () => {
    expect(() => renderTemplate('Hello {{name}}', {})).toThrow('Missing template variable: {{name}}');
  });

  it('throws ActionableError listing all missing variables', () => {
    expect(() => renderTemplate('{{a}} and {{b}} and {{c}}', { b: 'ok' }))
      .toThrow('Missing template variables: {{a}}, {{c}}');
  });

  it('handles multiline templates', () => {
    const template = 'Line 1: {{first}}\nLine 2: {{second}}';
    expect(renderTemplate(template, { first: 'A', second: 'B' })).toBe('Line 1: A\nLine 2: B');
  });
});

// ── loadUsageRegistry ───────────────────────────────────

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('node:fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path');
  return { ...actual, join: (...parts: string[]) => parts.join('/') };
});

function setRegistryFile(data: Record<string, unknown>) {
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(JSON.stringify(data));
}

describe('loadUsageRegistry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('loads and returns entries, stripping meta-fields', () => {
    setRegistryFile({
      _schema_version: '1.0.0',
      _doc: 'Some description',
      'enrichment.test': {
        description: 'Test usage',
        model: 'gemini-2.5-flash',
      },
    });
    const reg = loadUsageRegistry('/repo');
    expect(reg['enrichment.test']).toBeDefined();
    expect(reg['enrichment.test'].description).toBe('Test usage');
    expect(reg['_schema_version' as keyof typeof reg]).toBeUndefined();
    expect(reg['_doc' as keyof typeof reg]).toBeUndefined();
  });

  it('resolves _extends by merging parent fields', () => {
    setRegistryFile({
      'base.usage': {
        description: 'Base',
        model: 'gemini-2.5-flash',
        temperature: 0.5,
        maxTokens: 4096,
        tags: ['base'],
      },
      'child.usage': {
        _extends: 'base.usage',
        description: 'Child override',
        temperature: 0.9,
      },
    });
    const reg = loadUsageRegistry('/repo');
    const child = reg['child.usage'];
    expect(child.description).toBe('Child override');
    expect(child.temperature).toBe(0.9);
    expect(child.model).toBe('gemini-2.5-flash');
    expect(child.maxTokens).toBe(4096);
    expect(child._extends).toBeUndefined();
  });

  it('throws on missing parent', () => {
    setRegistryFile({
      'child.usage': {
        _extends: 'nonexistent.parent',
        description: 'Orphan',
        model: 'gemini-2.5-flash',
      },
    });
    expect(() => loadUsageRegistry('/repo')).toThrow('extends unknown parent "nonexistent.parent"');
  });

  it('throws on self-referencing _extends', () => {
    setRegistryFile({
      'loop.usage': {
        _extends: 'loop.usage',
        description: 'Self-loop',
        model: 'gemini-2.5-flash',
      },
    });
    expect(() => loadUsageRegistry('/repo')).toThrow('extends itself');
  });

  it('throws on mutual cycle', () => {
    setRegistryFile({
      'a.usage': {
        _extends: 'b.usage',
        description: 'A',
        model: 'gemini-2.5-flash',
      },
      'b.usage': {
        _extends: 'a.usage',
        description: 'B',
        model: 'gemini-2.5-flash',
      },
    });
    expect(() => loadUsageRegistry('/repo')).toThrow(/Circular _extends|extends unknown parent/);
  });

  it('throws when file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(() => loadUsageRegistry('/repo')).toThrow('Usage registry not found');
  });

  it('throws on invalid JSON', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('NOT JSON {{{');
    expect(() => loadUsageRegistry('/repo')).toThrow('Failed to parse');
  });
});

// ── validateUsageConfig ─────────────────────────────────

const TEST_MODEL_REGISTRY: ModelRegistry = {
  backends: [{ id: 'gemini', label: 'Gemini' }],
  models: [
    { id: 'gemini-2.5-flash', apiModelId: 'gemini-2.5-flash', label: 'Flash', backend: 'gemini' },
    { id: 'gemini-3.1-flash-lite', apiModelId: 'gemini-3.1-flash-lite', label: 'Flash Lite', backend: 'gemini' },
  ],
};

describe('validateUsageConfig', () => {
  it('returns empty array for valid registry', () => {
    const registry = {
      'test.usage': {
        description: 'Valid usage',
        model: 'gemini-2.5-flash',
        temperature: 0.5,
        maxTokens: 1024,
        timeoutMs: 30000,
      },
    };
    expect(validateUsageConfig(registry, TEST_MODEL_REGISTRY)).toEqual([]);
  });

  it('reports unknown model', () => {
    const registry = {
      'test.usage': {
        description: 'Bad model',
        model: 'nonexistent-model',
      },
    };
    const errors = validateUsageConfig(registry, TEST_MODEL_REGISTRY);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('model');
    expect(errors[0].message).toContain('nonexistent-model');
  });

  it('reports missing description', () => {
    const registry = {
      'test.usage': {
        description: '',
        model: 'gemini-2.5-flash',
      },
    };
    const errors = validateUsageConfig(registry, TEST_MODEL_REGISTRY);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('description');
  });

  it('reports out-of-range temperature', () => {
    const registry = {
      'test.usage': {
        description: 'Hot',
        model: 'gemini-2.5-flash',
        temperature: 3.0,
      },
    };
    const errors = validateUsageConfig(registry, TEST_MODEL_REGISTRY);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('temperature');
  });

  it('reports negative temperature', () => {
    const errors = validateUsageConfig({
      'test.usage': { description: 'Cold', model: 'gemini-2.5-flash', temperature: -0.1 },
    }, TEST_MODEL_REGISTRY);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('temperature');
  });

  it('reports non-integer maxTokens', () => {
    const errors = validateUsageConfig({
      'test.usage': { description: 'Float tokens', model: 'gemini-2.5-flash', maxTokens: 10.5 },
    }, TEST_MODEL_REGISTRY);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('maxTokens');
  });

  it('reports zero timeoutMs', () => {
    const errors = validateUsageConfig({
      'test.usage': { description: 'No timeout', model: 'gemini-2.5-flash', timeoutMs: 0 },
    }, TEST_MODEL_REGISTRY);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('timeoutMs');
  });

  it('collects multiple errors from one entry', () => {
    const errors = validateUsageConfig({
      'test.usage': { description: '', model: 'bad-model', temperature: 5 },
    }, TEST_MODEL_REGISTRY);
    expect(errors).toHaveLength(3);
  });
});
