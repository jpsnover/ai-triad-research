import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

export interface StepDefinition {
  id: string;
  name: string;
  description: string;
  phase: string;
  canSkip: boolean;
  requiresConfig: boolean;
}

export const PIPELINE_STEPS: StepDefinition[] = [
  {
    id: 'import',
    name: 'Import Documents',
    description: 'Ingest new PDFs, web articles, or process the inbox folder',
    phase: 'Ingest',
    canSkip: false,
    requiresConfig: true,
  },
  {
    id: 'summarize',
    name: 'Generate Summaries',
    description: 'Extract key points, factual claims, and unmapped concepts per POV',
    phase: 'Summarize',
    canSkip: false,
    requiresConfig: false,
  },
  {
    id: 'conflicts',
    name: 'Detect Conflicts',
    description: 'Find cross-POV disagreements on factual claims',
    phase: 'Summarize',
    canSkip: true,
    requiresConfig: false,
  },
  {
    id: 'health',
    name: 'Taxonomy Health Check',
    description: 'Analyze orphan nodes, coverage balance, and unmapped concepts',
    phase: 'Analyze',
    canSkip: true,
    requiresConfig: false,
  },
  {
    id: 'proposals',
    name: 'Generate Proposals',
    description: 'AI-generated taxonomy improvements: NEW, SPLIT, MERGE, RELABEL',
    phase: 'Improve',
    canSkip: true,
    requiresConfig: false,
  },
  {
    id: 'review',
    name: 'Review Proposals',
    description: 'Approve or reject each taxonomy change proposal',
    phase: 'Improve',
    canSkip: true,
    requiresConfig: false,
  },
  {
    id: 'integrity',
    name: 'Validate Integrity',
    description: 'Check all node references, edges, policy IDs, and embeddings',
    phase: 'Validate',
    canSkip: false,
    requiresConfig: false,
  },
  {
    id: 'backfill',
    name: 'Backfill Resolved Concepts',
    description: 'Create key_point entries for resolved unmapped concepts that lack evidence trails',
    phase: 'Validate',
    canSkip: true,
    requiresConfig: false,
  },
  {
    id: 'attributes',
    name: 'Extract Attributes',
    description: 'Enrich nodes with epistemic type, rhetorical strategy, and more',
    phase: 'Enrich',
    canSkip: true,
    requiresConfig: false,
  },
  {
    id: 'lineage',
    name: 'Update Lineage',
    description: 'Populate, normalize, and enrich intellectual lineage with descriptions and validated URLs',
    phase: 'Enrich',
    canSkip: true,
    requiresConfig: false,
  },
  {
    id: 'steelman',
    name: 'Populate Steelman',
    description: 'Generate steelman arguments and vulnerability analysis for each taxonomy node',
    phase: 'Enrich',
    canSkip: true,
    requiresConfig: false,
  },
  {
    id: 'embeddings',
    name: 'Update Embeddings',
    description: 'Regenerate 384-dim sentence embeddings for all taxonomy nodes',
    phase: 'Enrich',
    canSkip: true,
    requiresConfig: false,
  },
  {
    id: 'edges',
    name: 'Discover Edges',
    description: 'Propose typed, directed relationships between taxonomy nodes',
    phase: 'Enrich',
    canSkip: true,
    requiresConfig: false,
  },
  {
    id: 'git-commit',
    name: 'Commit Changes',
    description: 'Stage and commit all data changes to the local git repository',
    phase: 'Publish',
    canSkip: false,
    requiresConfig: true,
  },
  {
    id: 'git-push',
    name: 'Push to GitHub',
    description: 'Push committed changes to the remote repository',
    phase: 'Publish',
    canSkip: true,
    requiresConfig: false,
  },
];

export function getProjectRoot(): string {
  // __dirname is workflow-app/dist/main → go up three levels to repo root
  return path.resolve(__dirname, '..', '..', '..');
}

export function getDataRoot(): string {
  const projectRoot = getProjectRoot();
  const configPath = path.join(projectRoot, '.aitriad.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const resolved = path.resolve(projectRoot, config.data_root);
    if (fs.existsSync(resolved)) return resolved;
  } catch { /* fall through */ }

  if (process.env.AI_TRIAD_DATA_ROOT) {
    return process.env.AI_TRIAD_DATA_ROOT;
  }

  return path.resolve(projectRoot, '..', 'ai-triad-data');
}

function getPowerShellCommand(): string {
  return 'pwsh';
}

/** workflow-app's own version, for the `Tool:` commit trailer. Best-effort; never throws. */
function getToolVersion(): string {
  try {
    const pkgPath = path.join(getProjectRoot(), 'workflow-app', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Builds the data-repo commit command with a self-describing subject + provenance
 * trailers (data-repo CONTRIBUTING.md §3) and an explicit-pathspec stage when the
 * orchestrator supplies the touched surfaces (§5). Falls back to a full-tree
 * `git add -A` — with the surface explicitly flagged `(unknown — full-tree add)` in
 * the commit body AND a warning echoed to the run log — when scope can't be
 * determined, rather than silently scoping or hard-failing the commit step (t/1333).
 *
 * Caller-supplied context (via the git-commit step config, threaded by the renderer):
 *   steps: string[]        — pipeline steps that produced data this run
 *   runId: string          — stable id for the run
 *   commitSummary: string  — one-line what-changed
 *   touchedDirs: string[]  — data-repo surfaces to stage; empty → full-tree fallback
 */
export function buildGitCommitCommand(dataRoot: string, config: Record<string, unknown>): string {
  const steps = Array.isArray(config.steps) ? (config.steps as string[]) : [];
  const runId = (config.runId as string) || 'no-run-id';
  const summary =
    (config.commitSummary as string) ||
    (config.commitMessage as string) ||
    'automated data pipeline update';
  const triggeredBy = process.env.ORCA_AGENT_ID
    ? `agent:${process.env.ORCA_AGENT_ID}`
    : `user:${os.userInfo().username}`;

  // workflowName: '+'-joined executed step set, truncated ~40 chars (TL t/1333#2).
  // The full list is preserved in the `Steps:` trailer (PowerShell t/1333).
  let workflowName = steps.join('+') || 'adhoc';
  if (workflowName.length > 40) workflowName = `${steps[0]}+${steps.length - 1}-more`;

  const touchedDirs = Array.isArray(config.touchedDirs) ? (config.touchedDirs as string[]) : [];
  const scoped = touchedDirs.length > 0;
  const surfaces = scoped ? touchedDirs.join(', ') : '(unknown — full-tree add)';

  const subject = `pipeline(${workflowName}): ${summary}`;
  const trailers = [
    '',
    `Run-Id: ${runId}`,
    `Triggered-By: ${triggeredBy}`,
    `Surfaces: ${surfaces}`,
  ];
  if (steps.length) trailers.push(`Steps: ${steps.join(', ')}`);
  trailers.push(`Tool: workflow-app v${getToolVersion()}`);
  const message = `${subject}${trailers.join('\n')}`.replace(/'/g, "''");

  // Stage: explicit pathspec when scoped (Test-Path-guarded so a listed-but-absent
  // surface can't brick the commit); surfaced full-tree fallback otherwise.
  let stage: string;
  if (scoped) {
    const surfaceList = touchedDirs.map(d => `'${d.replace(/'/g, "''")}'`).join(', ');
    stage =
      `$surfaces = @(${surfaceList}) | Where-Object { Test-Path $_ }; ` +
      `if ($surfaces) { git add -- $surfaces } ` +
      `else { Write-Warning 'None of the scoped commit surfaces exist on disk — nothing staged.' }`;
  } else {
    stage =
      `Write-Warning 'Commit surfaces unknown - staging full tree (git add -A). ` +
      `See data-repo CONTRIBUTING.md section 5.'; git add -A`;
  }

  return `Set-Location '${dataRoot}'; ${stage}; git commit -m '${message}'`;
}

function buildPsCommand(stepId: string, config: Record<string, unknown>): string {
  const projectRoot = getProjectRoot().replace(/\\/g, '/');
  const moduleImport = `Import-Module '${projectRoot}/scripts/AITriad/AITriad.psm1' -Force -ErrorAction Stop`;

  switch (stepId) {
    case 'import': {
      const mode = config.importMode as string;
      if (mode === 'inbox') {
        return `${moduleImport}; Import-AITriadDocument -Inbox -Verbose`;
      }
      if (mode === 'url') {
        const url = config.url as string;
        const pov = config.pov as string;
        let cmd = `${moduleImport}; Import-AITriadDocument -Url '${url}'`;
        if (pov) cmd += ` -Pov '${pov}'`;
        cmd += ' -Verbose';
        return cmd;
      }
      const files = config.files as string[];
      if (!files || files.length === 0) throw new Error('No files selected');
      const pov = config.pov as string;
      const commands = files.map(f => {
        let cmd = `Import-AITriadDocument -File '${f.replace(/'/g, "''")}'`;
        if (pov) cmd += ` -Pov '${pov}'`;
        cmd += ' -Verbose';
        return cmd;
      });
      return `${moduleImport}; ${commands.join('; ')}`;
    }
    case 'summarize': {
      let cmd = `${moduleImport}; Invoke-BatchSummary -Verbose`;
      if (config.importedToday) cmd += ' -ImportedToday';
      return cmd;
    }
    case 'conflicts':
      return `${moduleImport}; Invoke-QbafConflictAnalysis -Verbose`;
    case 'health':
      return `${moduleImport}; Get-TaxonomyHealth`;
    case 'proposals':
      return `${moduleImport}; Invoke-TaxonomyProposal -Verbose`;
    case 'review': {
      const proposalPath = config.proposalPath as string;
      if (!proposalPath) throw new Error('No proposal file selected');
      return `${moduleImport}; Approve-TaxonomyProposal -Path '${proposalPath.replace(/'/g, "''")}' -ApproveAll -Verbose`;
    }
    case 'integrity':
      return `${moduleImport}; Test-TaxonomyIntegrity -Verbose`;
    case 'backfill':
      return `${moduleImport}; Repair-ResolvedBackfill -Verbose`;
    case 'embeddings':
      return `${moduleImport}; Update-TaxEmbeddings -Verbose`;
    case 'edges':
      return `${moduleImport}; Invoke-EdgeDiscovery -Verbose`;
    case 'attributes':
      return `${moduleImport}; Invoke-AttributeExtraction -Verbose`;
    case 'lineage':
      return `${moduleImport}; Repair-PovLineage -Verbose`;
    case 'steelman':
      return `${moduleImport}; Repair-PovAttributes -Priority critical -Verbose`;
    case 'git-commit':
      return buildGitCommitCommand(getDataRoot().replace(/\\/g, '/'), config);
    case 'git-push': {
      const dataRoot = getDataRoot().replace(/\\/g, '/');
      return `Set-Location '${dataRoot}'; git push`;
    }
    default:
      throw new Error(`Unknown step: ${stepId}`);
  }
}

let activeProcess: ChildProcess | null = null;

export function runStep(
  stepId: string,
  config: Record<string, unknown>,
  onData: (text: string) => void,
  onError: (text: string) => void,
): Promise<{ exitCode: number }> {
  return new Promise((resolve, reject) => {
    try {
      const psCommand = buildPsCommand(stepId, config);
      const shell = getPowerShellCommand();

      const args = ['-NoProfile', '-NonInteractive', '-Command', psCommand];

      onData(`> ${shell} -Command "${stepId}"\n`);
      onData(`${psCommand}\n\n`);

      const child = spawn(shell, args, {
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      activeProcess = child;

      child.stdout?.on('data', (chunk: Buffer) => {
        onData(chunk.toString('utf-8'));
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        if (text.startsWith('VERBOSE:') || text.startsWith('WARNING:')) {
          onData(text);
        } else {
          onError(text);
        }
      });

      child.on('close', (code) => {
        activeProcess = null;
        resolve({ exitCode: code ?? 1 });
      });

      child.on('error', (err) => {
        activeProcess = null;
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

export function cancelStep(): void {
  if (activeProcess) {
    activeProcess.kill();
    activeProcess = null;
  }
}

export function getGitStatus(): { summary: string; hasChanges: boolean } {
  const dataRoot = getDataRoot();
  try {
    const { execSync } = require('child_process');
    const status = execSync('git status --porcelain', { cwd: dataRoot, encoding: 'utf-8' });
    const lines = status.trim().split('\n').filter((l: string) => l.trim());
    return {
      summary: status || 'No changes',
      hasChanges: lines.length > 0,
    };
  } catch {
    return { summary: 'Error reading git status', hasChanges: false };
  }
}

export function getGitDiffStat(): string {
  const dataRoot = getDataRoot();
  try {
    const { execSync } = require('child_process');
    const diff = execSync('git diff --stat HEAD', { cwd: dataRoot, encoding: 'utf-8' });
    const untracked = execSync('git ls-files --others --exclude-standard', { cwd: dataRoot, encoding: 'utf-8' });
    let result = diff || '';
    if (untracked.trim()) {
      result += '\nNew files:\n' + untracked.trim().split('\n').map((f: string) => `  + ${f}`).join('\n');
    }
    return result || 'No changes';
  } catch {
    return 'Error reading git diff';
  }
}

export function listProposalFiles(): string[] {
  const projectRoot = getProjectRoot();
  const proposalDir = path.join(projectRoot, 'taxonomy', 'proposals');
  try {
    if (!fs.existsSync(proposalDir)) return [];
    return fs.readdirSync(proposalDir)
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(proposalDir, f));
  } catch {
    return [];
  }
}

export function readProposalFile(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}
