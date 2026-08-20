// @vitest-environment node
//
// t/2850 — brief-export container-selection regression. getBriefExportBackend()
// must return the dedicated brief-export backend when wired, independently of the
// user-content backend. This gate ensures the lifecycle-rule container routing is
// never silently un-wired.

import { describe, it, expect, afterEach } from 'vitest';
import * as fileIO from '../storage/fileIO.js';
import type { StorageBackend } from '../storage/storageBackend.js';

function makeStub(name: string): StorageBackend {
  return { backendName: name } as unknown as StorageBackend;
}

const originalUserContent = fileIO.getUserContentBackend();
const originalBriefExport = fileIO.getBriefExportBackend();

afterEach(() => {
  fileIO.setUserContentBackend(originalUserContent);
  fileIO.setBriefExportBackend(originalBriefExport);
});

describe('getBriefExportBackend — container-selection (t/2850)', () => {
  it('returns the dedicated brief-export backend when wired', () => {
    const dedicated = makeStub('brief-exports');
    fileIO.setBriefExportBackend(dedicated);
    expect(fileIO.getBriefExportBackend()).toBe(dedicated);
  });

  it('brief-export and user-content backends are distinct when both wired', () => {
    const uc = makeStub('user-content');
    const be = makeStub('brief-exports');
    fileIO.setUserContentBackend(uc);
    fileIO.setBriefExportBackend(be);
    expect(fileIO.getBriefExportBackend()).toBe(be);
    expect(fileIO.getUserContentBackend()).toBe(uc);
    expect(fileIO.getBriefExportBackend()).not.toBe(fileIO.getUserContentBackend());
  });

  it('changing the user-content backend does not change the brief-export backend', () => {
    const be = makeStub('brief-exports-stable');
    fileIO.setBriefExportBackend(be);
    fileIO.setUserContentBackend(makeStub('new-user-content'));
    expect(fileIO.getBriefExportBackend()).toBe(be);
  });
});
