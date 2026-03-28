// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { execFileSync } from 'child_process';

/**
 * Diagnoses Python + sentence-transformers availability and returns
 * an actionable error message. Call this when a Python embedding
 * operation fails to give the user a precise fix.
 */
export function diagnosePythonEmbeddings(): string {
  // 1. Is python3 on PATH?
  let pythonPath: string;
  try {
    pythonPath = execFileSync('which', ['python3'], { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    try {
      pythonPath = execFileSync('which', ['python'], { encoding: 'utf-8', timeout: 5000 }).trim();
    } catch {
      return 'Python is not installed or not on PATH. Install Python 3.9+ from https://www.python.org/downloads/';
    }
  }

  // 2. Is it Python 3?
  let version: string;
  try {
    version = execFileSync(pythonPath, ['--version'], { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return `Python found at ${pythonPath} but --version failed. The installation may be corrupt.`;
  }

  if (!version.startsWith('Python 3')) {
    return `Found ${version} at ${pythonPath} but Python 3.9+ is required. Install from https://www.python.org/downloads/`;
  }

  // 3. Is sentence-transformers installed?
  try {
    execFileSync(pythonPath, ['-c', 'import sentence_transformers'], { encoding: 'utf-8', timeout: 10000 });
  } catch {
    return `Python 3 is installed (${version}) but sentence-transformers is missing. Install it with: pip3 install sentence-transformers`;
  }

  // 4. Is numpy installed? (required by sentence-transformers but check anyway)
  try {
    execFileSync(pythonPath, ['-c', 'import numpy'], { encoding: 'utf-8', timeout: 5000 });
  } catch {
    return `sentence-transformers is installed but numpy is missing. Install it with: pip3 install numpy`;
  }

  // All checks passed — the error is something else
  return 'Python and sentence-transformers are installed correctly. The error may be a timeout, memory, or model download issue.';
}
