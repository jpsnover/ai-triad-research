// @vitest-environment node
//
// t/2643 — state-root isolation. Class-A WRITES (feature flags, runtime config, keys,
// calibration, telemetry, flight-recorder) route through getStateRoot(); grounding READS stay
// on getDataRoot(). On staging, AI_TRIAD_STATE_ROOT points at an isolated RW mount so a class-A
// write cannot mutate prod's shared data root. These tests prove the split + the fail-fast guard
// + the unit-level arm-B property (a flag write lands in the state root, NOT the data root).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDataRoot, getStateRoot, resolveStatePath, isStagingIdentity, assertStateRootIsolation } from '../config.js';
import { setFlag, getFlagMetadata, _resetFlagCache } from '../featureFlags.js';

const SAVED: Record<string, string | undefined> = {};
const KEYS = ['AI_TRIAD_DATA_ROOT', 'AI_TRIAD_STATE_ROOT', 'CONTAINER_APP_NAME', 'AI_TRIAD_ENV', 'ADMIN_USERS'];
let dataRoot: string;
let stateRoot: string;

beforeEach(() => {
  for (const k of KEYS) SAVED[k] = process.env[k];
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'data-'));
  stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
  for (const k of KEYS) delete process.env[k];
  process.env.AI_TRIAD_DATA_ROOT = dataRoot;
  process.env.ADMIN_USERS = 'jpsnover';
  _resetFlagCache();
});
afterEach(() => {
  for (const k of KEYS) { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k]; }
  fs.rmSync(dataRoot, { recursive: true, force: true });
  fs.rmSync(stateRoot, { recursive: true, force: true });
  _resetFlagCache();
});

describe('t/2643 — getStateRoot / resolveStatePath', () => {
  it('defaults to getDataRoot() when AI_TRIAD_STATE_ROOT is unset (prod/local unchanged)', () => {
    expect(getStateRoot()).toBe(getDataRoot());
  });
  it('resolves to AI_TRIAD_STATE_ROOT when set (staging isolation)', () => {
    process.env.AI_TRIAD_STATE_ROOT = stateRoot;
    expect(getStateRoot()).toBe(path.resolve(stateRoot));
    expect(getStateRoot()).not.toBe(getDataRoot());
  });
  it('resolveStatePath joins the state root', () => {
    process.env.AI_TRIAD_STATE_ROOT = stateRoot;
    expect(resolveStatePath('admin/x.json')).toBe(path.resolve(stateRoot, 'admin/x.json'));
  });
});

describe('t/2643 — isStagingIdentity', () => {
  it('true when CONTAINER_APP_NAME contains "staging" (ACA-injected, drift-proof)', () => {
    process.env.CONTAINER_APP_NAME = 'taxonomy-editor-staging';
    expect(isStagingIdentity()).toBe(true);
  });
  it('true when AI_TRIAD_ENV=staging (explicit backstop)', () => {
    process.env.AI_TRIAD_ENV = 'staging';
    expect(isStagingIdentity()).toBe(true);
  });
  it('false on prod (CONTAINER_APP_NAME=taxonomy-editor, no env flag)', () => {
    process.env.CONTAINER_APP_NAME = 'taxonomy-editor';
    expect(isStagingIdentity()).toBe(false);
  });
});

describe('t/2643 — assertStateRootIsolation fail-fast guard', () => {
  it('THROWS on staging identity when the state root fell back to the data root (env drift)', () => {
    process.env.CONTAINER_APP_NAME = 'taxonomy-editor-staging';
    // AI_TRIAD_STATE_ROOT unset → getStateRoot()===getDataRoot() → the hazard.
    expect(() => assertStateRootIsolation()).toThrow(/refusing to start/i);
  });
  it('passes on staging when the state root IS isolated', () => {
    process.env.CONTAINER_APP_NAME = 'taxonomy-editor-staging';
    process.env.AI_TRIAD_STATE_ROOT = stateRoot;
    expect(() => assertStateRootIsolation()).not.toThrow();
  });
  it('passes on prod/local (not staging) even when stateRoot===dataRoot', () => {
    // no staging identity; stateRoot===dataRoot is legitimate (prod owns its share)
    expect(() => assertStateRootIsolation()).not.toThrow();
  });
});

describe('t/2643 — arm-B property (unit level): a class-A write lands in the STATE root, not the data root', () => {
  it('setFlag writes under getStateRoot() and does NOT create the file under getDataRoot()', () => {
    process.env.AI_TRIAD_STATE_ROOT = stateRoot; // isolate (staging-like)
    _resetFlagCache();
    setFlag('env-web-opeds', { enabled: true, scope: 'env:web' }, 'jpsnover');

    const stateFile = path.join(stateRoot, 'admin', 'feature-flags.json');
    const dataFile = path.join(dataRoot, 'admin', 'feature-flags.json');
    expect(fs.existsSync(stateFile)).toBe(true);                 // written to the isolated state root
    expect(fs.existsSync(dataFile)).toBe(false);                 // prod's data root is UNTOUCHED
    _resetFlagCache();
    expect(getFlagMetadata('env-web-opeds')?.enabled).toBe(true); // and readable back from the state root
  });
});
