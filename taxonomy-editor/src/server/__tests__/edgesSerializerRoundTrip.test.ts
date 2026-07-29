// @vitest-environment node
//
// t/1941 — writeEdgesFile round-trip test.
// Writes the golden input fixture through writeEdgesFile (via MemoryBackend) and
// asserts byte-for-byte identity with expected.json — the contract fixture verified
// against the shared serializer (67f93f85). Catches any regression where the server
// writer drifts from the byte-level contract in docs/edges-json-format.md.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { StorageBackend } from '../storage/storageBackend.js';
import * as fileIO from '../storage/fileIO.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '../../../../tests/fixtures/edges-format');

class MemoryBackend implements StorageBackend {
  files = new Map<string, string>();
  private norm(p: string) { return p.replace(/\\/g, '/'); }
  async readFile(filePath: string): Promise<string | null> { return this.files.get(this.norm(filePath)) ?? null; }
  async writeFile(filePath: string, content: string): Promise<void> { this.files.set(this.norm(filePath), content); }
  async listDirectory(): Promise<string[]> { return []; }
  async deleteFile(): Promise<void> { /* stub */ }
  async fileExists(): Promise<boolean> { return false; }
  async readBinaryFile(): Promise<Buffer | null> { return null; }
  async writeBinaryFile(): Promise<void> { /* stub */ }
}

let mem: MemoryBackend;
let dataRoot: string;

describe('writeEdgesFile round-trip (t/1941)', () => {
  beforeAll(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edges-rt-'));
    process.env.AI_TRIAD_DATA_ROOT = dataRoot;
  });
  afterAll(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
    delete process.env.AI_TRIAD_DATA_ROOT;
  });
  beforeEach(() => {
    mem = new MemoryBackend();
    fileIO.setBackend(mem);
  });

  it('reproduces expected.json from input.json byte-for-byte', async () => {
    const input = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'input.json'), 'utf8'));
    const expected = fs.readFileSync(path.join(FIXTURES, 'expected.json'), 'utf8');

    await fileIO.writeEdgesFile(input);

    const actual = [...mem.files.values()][0];
    expect(actual).toBe(expected);
  });
});
