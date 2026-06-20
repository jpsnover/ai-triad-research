// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * One-time migration: copy user content from the GitHub data repo to Azure Blob
 * Storage (t/699, epic t/695).
 *
 * Migrates (relative paths preserved so the runtime AzureBlobBackend reads them
 * back unchanged — container routing is the only transform):
 *   - users/{userId}/chats/*.json     → user-content container
 *   - users/{userId}/debates/*.json   → user-content container
 *   - community/chats/*.json          → community container
 *   - community/debates/*.json        → community container
 *   - community/_submissions/*.json   → community container
 *
 * Reuses the existing GitHubAPIBackend (read, authed + rate-limited) and
 * AzureBlobBackend (write) rather than @octokit/rest, so blob names are
 * guaranteed identical to what the running server reads. Idempotent (upload
 * overwrites); re-run safe. Run after `npm run build:server`:
 *
 *   AZURE_STORAGE_ACCOUNT_URL=https://<acct>.blob.core.windows.net \
 *   node dist/server/taxonomy-editor/src/server/scripts/migrateUserContentToBlob.js
 */

import crypto from 'crypto';
import { pathToFileURL } from 'url';
import type { StorageBackend } from '../storageBackend.js';

export interface MigrationSummary {
  filesMigrated: number;
  bytesTransferred: number;
  verified: number;
  failures: { path: string; error: string }[];
  verifyFailures: { path: string; error: string }[];
}

export interface MigrateOptions {
  /** Progress/summary sink. Defaults to a no-op (tests stay quiet). */
  log?: (msg: string) => void;
  /** Read each blob back and SHA-compare after write. Default true. */
  verify?: boolean;
  /** Preview only: enumerate + read source (to confirm readability/size) but
   *  make NO writes to the destination. `filesMigrated`/`bytesTransferred`
   *  report what WOULD be copied. Default false. */
  dryRun?: boolean;
}

const COMMUNITY_DIRS = ['community/chats', 'community/debates', 'community/_submissions'];

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf-8').digest('hex');
}

async function listJsonFiles(backend: StorageBackend, dir: string): Promise<string[]> {
  return (await backend.listDirectory(dir)).filter(f => f.endsWith('.json'));
}

/** Enumerate every user-content file (data-root-relative path) to migrate. */
export async function collectUserContentPaths(source: StorageBackend): Promise<string[]> {
  const paths: string[] = [];

  // Per-user chats + debates under users/{userId}/
  const userIds = await source.listDirectory('users');
  for (const userId of userIds) {
    for (const kind of ['chats', 'debates']) {
      const dir = `users/${userId}/${kind}`;
      for (const f of await listJsonFiles(source, dir)) paths.push(`${dir}/${f}`);
    }
  }

  // Shared community content
  for (const dir of COMMUNITY_DIRS) {
    for (const f of await listJsonFiles(source, dir)) paths.push(`${dir}/${f}`);
  }

  return paths;
}

/**
 * Copy every user-content file from `source` to `dest`, optionally verifying
 * each with a read-back SHA compare. Per-file failures are recorded and do not
 * abort the run. Returns a summary report.
 */
export async function migrateUserContent(
  source: StorageBackend,
  dest: StorageBackend,
  opts: MigrateOptions = {},
): Promise<MigrationSummary> {
  const log = opts.log ?? (() => {});
  const verify = opts.verify ?? true;
  const dryRun = opts.dryRun ?? false;
  const summary: MigrationSummary = {
    filesMigrated: 0, bytesTransferred: 0, verified: 0, failures: [], verifyFailures: [],
  };

  const paths = await collectUserContentPaths(source);
  log(`${dryRun ? '[DRY RUN] ' : ''}Found ${paths.length} user-content files to migrate.`);

  for (const p of paths) {
    try {
      const content = await source.readFile(p);
      if (content === null) { summary.failures.push({ path: p, error: 'source returned null' }); continue; }

      // Dry run: confirm the source is readable + sized, but write nothing.
      if (dryRun) {
        summary.filesMigrated++; // would-migrate count
        summary.bytesTransferred += Buffer.byteLength(content, 'utf-8');
        continue;
      }

      await dest.writeFile(p, content);
      summary.filesMigrated++;
      summary.bytesTransferred += Buffer.byteLength(content, 'utf-8');

      if (verify) {
        const readBack = await dest.readFile(p);
        if (readBack === null || sha256(readBack) !== sha256(content)) {
          summary.verifyFailures.push({ path: p, error: 'SHA mismatch or missing after write' });
        } else {
          summary.verified++;
        }
      }

      if (summary.filesMigrated % 50 === 0) log(`  …${summary.filesMigrated} migrated`);
    } catch (err) {
      const error = (err as Error)?.message ?? String(err);
      summary.failures.push({ path: p, error });
      log(`  ! failed: ${p} — ${error}`);
    }
  }

  log(
    `${dryRun ? '[DRY RUN] would migrate' : 'Migration complete:'} ${summary.filesMigrated} files, ` +
    `${summary.bytesTransferred} bytes, ${summary.verified} verified, ` +
    `${summary.failures.length} failures, ${summary.verifyFailures.length} verify failures.`,
  );
  return summary;
}

// ── CLI entry ──

async function main(): Promise<void> {
  const { log } = await import('../logger.js');
  const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL;
  if (!accountUrl) {
    log.server.error('AZURE_STORAGE_ACCOUNT_URL is required');
    process.exit(2);
  }

  const { GitHubAPIBackend } = await import('../githubAPIBackend.js');
  const { AzureBlobBackend } = await import('../azureBlobBackend.js');
  const { CACHE_DIR } = await import('../config.js');

  const source = new GitHubAPIBackend({ cacheDir: CACHE_DIR, pollIntervalMs: 999_999_999, coherencyProbeRate: 0 });
  await source.initialize();
  const dest = new AzureBlobBackend({
    accountUrl,
    userContentContainer: process.env.AZURE_USER_CONTENT_CONTAINER || 'user-content',
    communityContainer: process.env.AZURE_COMMUNITY_CONTAINER || 'community',
  });

  const dryRun = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run');
  if (dryRun) log.server.info('DRY RUN — no writes will be made to Blob');

  const summary = await migrateUserContent(source, dest, { log: (m) => log.server.info(m), dryRun });
  log.server.info({ summary, dryRun }, 'User-content → Blob migration summary');
  source.shutdown();

  const hadErrors = summary.failures.length + summary.verifyFailures.length > 0;
  process.exit(hadErrors ? 1 : 0);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
