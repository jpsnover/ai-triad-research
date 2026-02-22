import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const TAXONOMY_DIR = path.join(PROJECT_ROOT, 'taxonomy');
const CONFLICTS_DIR = path.join(PROJECT_ROOT, 'conflicts');

const POV_FILE_MAP: Record<string, string> = {
  accelerationist: 'accelerationist.json',
  safetyist: 'safetyist.json',
  skeptic: 'skeptic.json',
  'cross-cutting': 'cross-cutting.json',
};

export function readTaxonomyFile(pov: string): unknown {
  const filename = POV_FILE_MAP[pov];
  if (!filename) {
    throw new Error(`Unknown POV: ${pov}`);
  }
  const filePath = path.join(TAXONOMY_DIR, filename);
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

export function writeTaxonomyFile(pov: string, data: unknown): void {
  const filename = POV_FILE_MAP[pov];
  if (!filename) {
    throw new Error(`Unknown POV: ${pov}`);
  }
  const filePath = path.join(TAXONOMY_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function readAllConflictFiles(): unknown[] {
  if (!fs.existsSync(CONFLICTS_DIR)) {
    return [];
  }
  const files = fs.readdirSync(CONFLICTS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const raw = fs.readFileSync(path.join(CONFLICTS_DIR, f), 'utf-8');
    return JSON.parse(raw);
  });
}

export function writeConflictFile(claimId: string, data: unknown): void {
  const filePath = path.join(CONFLICTS_DIR, `${claimId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Conflict file not found: ${claimId}`);
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function createConflictFile(claimId: string, data: unknown): void {
  if (!fs.existsSync(CONFLICTS_DIR)) {
    fs.mkdirSync(CONFLICTS_DIR, { recursive: true });
  }
  const filePath = path.join(CONFLICTS_DIR, `${claimId}.json`);
  if (fs.existsSync(filePath)) {
    throw new Error(`Conflict file already exists: ${claimId}`);
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function deleteConflictFile(claimId: string): void {
  const filePath = path.join(CONFLICTS_DIR, `${claimId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Conflict file not found: ${claimId}`);
  }
  fs.unlinkSync(filePath);
}
