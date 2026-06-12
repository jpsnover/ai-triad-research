#!/usr/bin/env node
/**
 * One-time migration: copy global chats/ and debates/ into users/jpsnover/.
 *
 * Usage:
 *   node scripts/migrate-user-data.mjs [--data-root <path>] [--dry-run]
 *
 * Defaults to ../ai-triad-data relative to repo root.
 * The script copies (not moves) so the originals stay as a safety net.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dataRootIdx = args.indexOf('--data-root');
const DATA_ROOT = dataRootIdx >= 0 && args[dataRootIdx + 1]
  ? path.resolve(args[dataRootIdx + 1])
  : path.resolve(REPO_ROOT, '..', 'ai-triad-data');

const TARGET_USER = 'jpsnover';

async function copyDir(src, dest) {
  let entries;
  try {
    entries = await fs.readdir(src);
  } catch {
    console.log(`  [skip] ${src} does not exist`);
    return 0;
  }

  await fs.mkdir(dest, { recursive: true });
  let count = 0;

  for (const entry of entries) {
    if (entry.startsWith('_')) continue; // skip index files
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);

    const stat = await fs.stat(srcPath);
    if (!stat.isFile()) continue;

    if (dryRun) {
      console.log(`  [dry-run] ${srcPath} → ${destPath}`);
    } else {
      await fs.copyFile(srcPath, destPath);
      console.log(`  copied ${entry}`);
    }
    count++;
  }
  return count;
}

async function main() {
  console.log(`Data root: ${DATA_ROOT}`);
  console.log(`Target user: ${TARGET_USER}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  const userDir = path.join(DATA_ROOT, 'users', TARGET_USER);

  console.log('Migrating chats...');
  const chatCount = await copyDir(
    path.join(DATA_ROOT, 'chats'),
    path.join(userDir, 'chats'),
  );

  console.log('Migrating debates...');
  const debateCount = await copyDir(
    path.join(DATA_ROOT, 'debates'),
    path.join(userDir, 'debates'),
  );

  console.log(`\nDone. ${chatCount} chats, ${debateCount} debates migrated to users/${TARGET_USER}/`);
  if (dryRun) console.log('(dry run — no files were actually copied)');
}

main().catch(err => { console.error(err); process.exit(1); });
