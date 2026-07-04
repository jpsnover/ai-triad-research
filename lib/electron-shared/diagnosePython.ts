import { execFileSync } from 'child_process';

/**
 * Diagnoses Python + sentence-transformers availability and returns
 * an actionable error message. Call this when a Python embedding
 * operation fails to give the user a precise fix.
 */
export function diagnosePythonEmbeddings(): string {
  let pythonPath = '';
  let version = '';
  for (const candidate of ['python', 'python3']) {
    try {
      version = execFileSync(candidate, ['--version'], { encoding: 'utf-8', timeout: 5000 }).trim();
      pythonPath = candidate;
      break;
    } catch {
      /* telemetry — silent by design */
    }
  }
  if (!pythonPath) {
    return 'Python is not installed or not on PATH. Install Python 3.9+ from https://www.python.org/downloads/';
  }

  if (!version.startsWith('Python 3')) {
    return `Found ${version} at ${pythonPath} but Python 3.9+ is required. Install from https://www.python.org/downloads/`;
  }

  try {
    execFileSync(pythonPath, ['-c', 'import sentence_transformers'], { encoding: 'utf-8', timeout: 10000 });
  } catch {
    /* telemetry — silent by design */
    return `Python 3 is installed (${version}) but sentence-transformers is missing. Install it with: pip3 install sentence-transformers`;
  }

  try {
    execFileSync(pythonPath, ['-c', 'import numpy'], { encoding: 'utf-8', timeout: 5000 });
  } catch {
    /* telemetry — silent by design */
    return `sentence-transformers is installed but numpy is missing. Install it with: pip3 install numpy`;
  }

  return 'Python and sentence-transformers are installed correctly. The error may be a timeout, memory, or model download issue.';
}
