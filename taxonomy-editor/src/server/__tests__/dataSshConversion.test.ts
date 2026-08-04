// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { convertSshToHttps } from '../routes/data.js';

describe('convertSshToHttps', () => {
  it('converts SSH URL with .git suffix', () => {
    expect(convertSshToHttps('git@github.com:owner/repo.git')).toBe('https://github.com/owner/repo.git');
  });

  it('converts SSH URL without .git suffix', () => {
    expect(convertSshToHttps('git@github.com:owner/repo')).toBe('https://github.com/owner/repo');
  });

  it('leaves HTTPS URL unchanged', () => {
    expect(convertSshToHttps('https://github.com/owner/repo.git')).toBe('https://github.com/owner/repo.git');
  });

  it('leaves non-GitHub SSH URL unchanged', () => {
    expect(convertSshToHttps('git@gitlab.com:owner/repo.git')).toBe('git@gitlab.com:owner/repo.git');
  });
});
