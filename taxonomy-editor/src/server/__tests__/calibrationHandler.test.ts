import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { calibrationReviewHandler as handler } from '../community/admin/calibrationHandler';
import { readCalibrationIntegrationLog } from '../storage/fileIO';

// Resolves under AI_TRIAD_DATA_ROOT (config.getDataRoot), like calibrationCuration.test.ts.
let dataRoot: string;
const usersDir = () => path.join(dataRoot, 'calibration', 'users');
const coreDir = () => path.join(dataRoot, 'calibration', 'core');

function writeJsonl(origin: string, file: string, entries: unknown[]) {
  const p = path.join(usersDir(), origin, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
}
function writeUserLineage(origin: string, map: Record<string, unknown>) {
  const p = path.join(usersDir(), origin, 'lineage-enrichments.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(map, null, 2));
}
function readCoreJsonl(file: string): Record<string, unknown>[] {
  const p = path.join(coreDir(), file);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}
function readCoreLineage(): Record<string, unknown> {
  const p = path.join(coreDir(), 'lineage-enrichments.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : {};
}

describe('calibration ReviewDomainHandler (t/647)', () => {
  beforeAll(() => {
    process.env.AI_TRIAD_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-handler-'));
    dataRoot = process.env.AI_TRIAD_DATA_ROOT;
  });
  afterAll(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
    delete process.env.AI_TRIAD_DATA_ROOT;
  });
  beforeEach(() => {
    fs.rmSync(path.join(dataRoot, 'calibration'), { recursive: true, force: true });
  });

  it('domain is "calibration"', () => {
    expect(handler.domain).toBe('calibration');
  });

  it('getPendingItems groups all three file types per user with combined counts', async () => {
    writeJsonl('local', 'calibration-log.jsonl', [
      { debate_id: 'd-1', timestamp: '2026-06-01T00:00:00Z', saturation: 0.8 },
      { debate_id: 'd-2', timestamp: '2026-06-03T00:00:00Z', saturation: 0.6 },
    ]);
    writeJsonl('local', 'extraction-metrics.jsonl', [{ debate_id: 'd-1', timestamp: '2026-06-02T00:00:00Z', f1: 0.9 }]);
    writeUserLineage('local', { Governance: { category: 'gov' }, Safety: { category: 'saf' } });
    writeJsonl('azure-user', 'calibration-log.jsonl', [{ debate_id: 'd-9', timestamp: '2026-06-10T00:00:00Z' }]);

    const items = await handler.getPendingItems();
    expect(items.map(i => i.submitter)).toEqual(['azure-user', 'local']); // newest-first by submittedAt
    const local = items.find(i => i.submitter === 'local')!;
    expect(local.id).toBe('calibration:local');
    expect(local.itemCount).toBe(5); // 2 cal + 1 ext + 2 lineage
    expect(local.summary).toContain('2 debate metrics');
    expect(local.summary).toContain('1 extraction metric');
    expect(local.summary).toContain('2 enrichments');
  });

  it('getPendingItems filters by submitter when userId given', async () => {
    writeJsonl('local', 'calibration-log.jsonl', [{ debate_id: 'd-1', timestamp: 't' }]);
    writeJsonl('azure-user', 'calibration-log.jsonl', [{ debate_id: 'd-9', timestamp: 't' }]);
    const items = await handler.getPendingItems('local');
    expect(items).toHaveLength(1);
    expect(items[0].submitter).toBe('local');
  });

  it('returns empty pending list when there is no data', async () => {
    expect(await handler.getPendingItems()).toEqual([]);
  });

  it('getDetailForViewer returns qualified item ids, core averages, and lineage values', async () => {
    writeJsonl('local', 'calibration-log.jsonl', [{ debate_id: 'd-1', timestamp: 't', saturation: 0.8 }]);
    writeUserLineage('local', { Governance: { category: 'gov', description: 'g' } });
    // Seed core with two entries to average.
    fs.mkdirSync(coreDir(), { recursive: true });
    fs.writeFileSync(path.join(coreDir(), 'calibration-log.jsonl'),
      [{ debate_id: 'c1', saturation: 0.5 }, { debate_id: 'c2', saturation: 0.7 }].map(e => JSON.stringify(e)).join('\n') + '\n');

    const detail = await handler.getDetailForViewer('calibration:local') as {
      calibrationLog: { entries: Array<{ itemId: string }>; coreAverages: Record<string, number>; coreCount: number };
      lineageEnrichments: { entries: Array<{ itemId: string; key: string; value: unknown; coreValue: unknown }> };
    };
    expect(detail.calibrationLog.entries[0].itemId).toBe('calibration-log::d-1');
    expect(detail.calibrationLog.coreCount).toBe(2);
    expect(detail.calibrationLog.coreAverages.saturation).toBeCloseTo(0.6);
    expect(detail.lineageEnrichments.entries[0]).toMatchObject({
      itemId: 'lineage-enrichments::Governance',
      key: 'Governance',
      value: { category: 'gov', description: 'g' },
      coreValue: null,
    });
  });

  it('executeAction promote routes JSONL + lineage to core and writes audit records', async () => {
    writeJsonl('local', 'calibration-log.jsonl', [{ debate_id: 'd-1', x: 1 }, { debate_id: 'd-2', x: 2 }]);
    writeUserLineage('local', { Governance: { category: 'gov' } });

    await handler.executeAction({
      domain: 'calibration',
      groupId: 'calibration:local',
      action: 'promote',
      itemIds: ['calibration-log::d-1', 'lineage-enrichments::Governance'],
    });

    expect(readCoreJsonl('calibration-log.jsonl').map(e => e.debate_id)).toEqual(['d-1']);
    expect(readCoreLineage()).toHaveProperty('governance'); // case-normalized
    const audit = await readCalibrationIntegrationLog();
    expect(audit.some(r => r.action === 'promote' && (r.kind ?? 'calibration-log') === 'calibration-log' && r.entries.includes('d-1'))).toBe(true);
    expect(audit.some(r => r.action === 'promote' && r.kind === 'lineage-enrichments' && r.entries.includes('Governance'))).toBe(true);
  });

  it('edit-on-promote merges patches keyed by qualified item id', async () => {
    writeJsonl('local', 'calibration-log.jsonl', [{ debate_id: 'd-1', category: 'old' }]);
    await handler.executeAction({
      domain: 'calibration',
      groupId: 'calibration:local',
      action: 'promote',
      itemIds: ['calibration-log::d-1'],
      edits: { 'calibration-log::d-1': { category: 'fixed' } },
    });
    expect(readCoreJsonl('calibration-log.jsonl')[0]).toMatchObject({ debate_id: 'd-1', category: 'fixed' });
  });

  it('executeAction reject writes audit only and never touches user/core files', async () => {
    writeJsonl('local', 'calibration-log.jsonl', [{ debate_id: 'd-1' }, { debate_id: 'd-2' }]);
    await handler.executeAction({
      domain: 'calibration',
      groupId: 'calibration:local',
      action: 'reject',
      itemIds: ['calibration-log::d-2'],
      reason: 'test run',
    });
    expect(fs.existsSync(path.join(coreDir(), 'calibration-log.jsonl'))).toBe(false);
    const audit = await readCalibrationIntegrationLog();
    expect(audit[0]).toMatchObject({ action: 'reject', entries: ['d-2'], reason: 'test run' });
    // user file intact
    const userEntries = fs.readFileSync(path.join(usersDir(), 'local', 'calibration-log.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(userEntries.map(e => e.debate_id)).toEqual(['d-1', 'd-2']);
  });

  it('dedup: promoted/rejected entries drop out of subsequent pending', async () => {
    writeJsonl('local', 'calibration-log.jsonl', [{ debate_id: 'd-1', timestamp: 't' }, { debate_id: 'd-2', timestamp: 't' }, { debate_id: 'd-3', timestamp: 't' }]);
    await handler.executeAction({ domain: 'calibration', groupId: 'calibration:local', action: 'promote', itemIds: ['calibration-log::d-1'] });
    await handler.executeAction({ domain: 'calibration', groupId: 'calibration:local', action: 'reject', itemIds: ['calibration-log::d-2'], reason: 'x' });

    const detail = await handler.getDetailForViewer('calibration:local') as { calibrationLog: { entries: Array<{ entry: { debate_id: string } }> } };
    expect(detail.calibrationLog.entries.map(e => e.entry.debate_id)).toEqual(['d-3']);
  });

  it('per-kind dedup: a shared debate_id stays pending for the other kind', async () => {
    // Same debate_id in both JSONL kinds — promoting it for calibration-log must
    // not hide the extraction-metrics entry.
    writeJsonl('local', 'calibration-log.jsonl', [{ debate_id: 'shared', timestamp: 't' }]);
    writeJsonl('local', 'extraction-metrics.jsonl', [{ debate_id: 'shared', timestamp: 't' }]);
    await handler.executeAction({ domain: 'calibration', groupId: 'calibration:local', action: 'promote', itemIds: ['calibration-log::shared'] });

    const items = await handler.getPendingItems('local');
    expect(items).toHaveLength(1);
    expect(items[0].itemCount).toBe(1); // calibration-log resolved, extraction-metrics still pending
    expect(items[0].summary).toContain('1 extraction metric');
  });
});
