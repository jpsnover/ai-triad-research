import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  listPendingCalibration,
  promoteCalibrationEntries,
  rejectCalibrationEntries,
  readCalibrationIntegrationLog,
} from '../fileIO';

// Calibration curation resolves paths relative to AI_TRIAD_DATA_ROOT (config.getDataRoot).
let dataRoot: string;

function usersLogPath(origin: string): string {
  return path.join(dataRoot, 'calibration', 'users', origin, 'calibration-log.jsonl');
}
function coreLogPath(): string {
  return path.join(dataRoot, 'calibration', 'core', 'calibration-log.jsonl');
}
function integrationLogPath(): string {
  return path.join(dataRoot, 'calibration', 'integration-log.jsonl');
}

function writeUserLog(origin: string, debateIds: string[]) {
  const p = usersLogPath(origin);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, debateIds.map(id => JSON.stringify({ schema_version: 1, debate_id: id, origin })).join('\n') + '\n');
}

describe('admin calibration curation', () => {
  beforeAll(() => {
    process.env.AI_TRIAD_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-cur-'));
    dataRoot = process.env.AI_TRIAD_DATA_ROOT;
  });

  afterAll(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
    delete process.env.AI_TRIAD_DATA_ROOT;
  });

  beforeEach(() => {
    // Reset the calibration tree between tests.
    const calibDir = path.join(dataRoot, 'calibration');
    fs.rmSync(calibDir, { recursive: true, force: true });
  });

  it('AC#1: lists unpromoted entries grouped by user', async () => {
    writeUserLog('local', ['d-1', 'd-2']);
    writeUserLog('azure-user', ['d-3']);

    const groups = await listPendingCalibration();
    expect(groups).toHaveLength(2);
    // Sorted by origin: azure-user before local.
    expect(groups[0]).toMatchObject({ origin: 'azure-user', source: 'users/azure-user' });
    expect(groups[0].entries.map(e => e.debate_id)).toEqual(['d-3']);
    expect(groups[1]).toMatchObject({ origin: 'local', source: 'users/local' });
    expect(groups[1].entries.map(e => e.debate_id)).toEqual(['d-1', 'd-2']);
  });

  it('returns empty when no calibration data exists', async () => {
    expect(await listPendingCalibration()).toEqual([]);
  });

  it('AC#2: promote appends full entries to core JSONL and writes an audit record', async () => {
    writeUserLog('local', ['d-1', 'd-2', 'd-3']);

    const result = await promoteCalibrationEntries('users/local', ['d-1', 'd-3'], 'jpsnover', 'looks good');
    expect(result).toEqual({ promoted: 2, entries: ['d-1', 'd-3'] });

    // Core JSONL holds the promoted entries.
    const coreEntries = fs.readFileSync(coreLogPath(), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(coreEntries.map(e => e.debate_id)).toEqual(['d-1', 'd-3']);

    // Audit record written.
    const audit = await readCalibrationIntegrationLog();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'promote',
      source: 'users/local',
      entries: ['d-1', 'd-3'],
      by: 'jpsnover',
      notes: 'looks good',
    });
    expect(audit[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // User log is untouched.
    const userEntries = fs.readFileSync(usersLogPath('local'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(userEntries.map(e => e.debate_id)).toEqual(['d-1', 'd-2', 'd-3']);
  });

  it('promote only promotes entries that exist in the user log', async () => {
    writeUserLog('local', ['d-1']);
    const result = await promoteCalibrationEntries('users/local', ['d-1', 'does-not-exist'], 'jpsnover');
    expect(result.entries).toEqual(['d-1']);
    const coreEntries = fs.readFileSync(coreLogPath(), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(coreEntries.map(e => e.debate_id)).toEqual(['d-1']);
  });

  it('AC#3: reject writes an audit record only, never touching user or core files', async () => {
    writeUserLog('local', ['d-1', 'd-2']);

    const result = await rejectCalibrationEntries('users/local', ['d-2'], 'jpsnover', 'noisy run');
    expect(result).toEqual({ rejected: 1, entries: ['d-2'] });

    const audit = await readCalibrationIntegrationLog();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'reject', source: 'users/local', entries: ['d-2'], reason: 'noisy run' });

    // No core log created, user log intact.
    expect(fs.existsSync(coreLogPath())).toBe(false);
    const userEntries = fs.readFileSync(usersLogPath('local'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(userEntries.map(e => e.debate_id)).toEqual(['d-1', 'd-2']);
  });

  it('promoted and rejected entries are excluded from pending afterward', async () => {
    writeUserLog('local', ['d-1', 'd-2', 'd-3']);

    await promoteCalibrationEntries('users/local', ['d-1'], 'jpsnover');
    await rejectCalibrationEntries('users/local', ['d-2'], 'jpsnover', 'bad');

    const groups = await listPendingCalibration();
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map(e => e.debate_id)).toEqual(['d-3']);
  });

  it('appends successive integration records as separate JSONL lines', async () => {
    writeUserLog('local', ['d-1', 'd-2']);
    await promoteCalibrationEntries('users/local', ['d-1'], 'jpsnover');
    await rejectCalibrationEntries('users/local', ['d-2'], 'jpsnover', 'bad');

    const lines = fs.readFileSync(integrationLogPath(), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).action).toBe('promote');
    expect(JSON.parse(lines[1]).action).toBe('reject');
  });

  it('rejects an invalid source string', async () => {
    await expect(promoteCalibrationEntries('not-a-source', ['d-1'], 'jpsnover')).rejects.toThrow();
    await expect(rejectCalibrationEntries('../etc', ['d-1'], 'jpsnover', 'x')).rejects.toThrow();
  });
});
