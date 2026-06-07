// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DebateEngine, type DebateConfig, type DebateProgress } from './debateEngine.js';
import { createCLIAdapter } from './aiAdapter.js';
import { loadTaxonomy, resolveRepoRoot, resolveDataRoot, type LoadedTaxonomy } from './taxonomyLoader.js';
import type { DebateSession } from './types.js';
import { listDebateSessionsIndexed, updateDebateIndexEntry } from './debateIndex.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = resolveRepoRoot(__dirname);
const dataRoot = resolveDataRoot(repoRoot);
const debatesDir = path.join(dataRoot, 'debates');

// ── Lazy taxonomy loading ───────────────────────────────

let _taxonomy: LoadedTaxonomy | null = null;

function getTaxonomy(): LoadedTaxonomy {
  if (!_taxonomy) _taxonomy = loadTaxonomy(repoRoot);
  return _taxonomy;
}

// ── Active debate state (native mode) ───────────────────

interface ActiveDebate {
  controller: AbortController;
  progress: DebateProgress;
  result?: DebateSession;
  error?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
}

const activeDebates = new Map<string, ActiveDebate>();

// ── Debate file helpers ─────────────────────────────────

function loadDebateSession(id: string): unknown {
  const filePath = path.join(debatesDir, `debate-${id}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Debate session not found: ${id}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// ── MCP Server ──────────────────────────────────────────

const server = new McpServer(
  { name: 'debate', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// ── list_debates ────────────────────────────────────────

server.tool(
  'list_debates',
  'List all debate sessions from the data directory',
  {},
  async () => ({
    content: [{ type: 'text', text: JSON.stringify({ debates: listDebateSessionsIndexed(debatesDir) }, null, 2) }],
  }),
);

// ── load_debate ─────────────────────────────────────────

server.tool(
  'load_debate',
  'Load a specific debate session by ID',
  { id: z.string().describe('Debate session ID') },
  async ({ id }) => {
    try {
      const session = loadDebateSession(id);
      return { content: [{ type: 'text', text: JSON.stringify(session, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ── run_debate (CLI subprocess mode) ────────────────────

server.tool(
  'run_debate',
  'Run a debate via CLI subprocess (blocking). Returns the completed session JSON.',
  {
    topic: z.string().describe('Debate topic or question'),
    model: z.string().optional().describe('AI model to use (default: gemini-2.5-flash)'),
    rounds: z.number().optional().describe('Number of rounds (default: 3)'),
    activePovers: z.array(z.string()).optional().describe('Active perspectives (default: all three)'),
    audience: z.string().optional().describe('Target audience'),
    responseLength: z.enum(['brief', 'medium', 'detailed']).optional().describe('Response length preset'),
    pacing: z.string().optional().describe('Pacing preset'),
    outputDir: z.string().optional().describe('Output directory for session JSON'),
  },
  async (params) => {
    const configObj: Record<string, unknown> = {
      topic: params.topic,
      model: params.model ?? 'gemini-2.5-flash',
      rounds: params.rounds ?? 3,
      activePovers: params.activePovers ?? ['accelerationist', 'safetyist', 'skeptic'],
      responseLength: params.responseLength ?? 'medium',
    };
    if (params.audience) configObj.audience = params.audience;
    if (params.pacing) configObj.pacing = params.pacing;
    if (params.outputDir) configObj.outputDir = params.outputDir;

    const tmpConfig = path.join(dataRoot, `tmp-mcp-config-${randomUUID().slice(0, 8)}.json`);
    fs.writeFileSync(tmpConfig, JSON.stringify(configObj, null, 2), 'utf-8');

    try {
      const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        const child = spawn('npx', ['tsx', path.join(repoRoot, 'lib/debate/cli.ts'), '--config', tmpConfig], {
          cwd: repoRoot,
          shell: true,
          timeout: 600_000,
          env: { ...process.env },
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
        child.on('error', (err) => resolve({ stdout, stderr: stderr + err.message, code: 1 }));
      });

      if (result.code !== 0) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'CLI process failed', exit_code: result.code, stderr: result.stderr.slice(-2000) }) }],
          isError: true,
        };
      }

      // Find the output session file — CLI writes to debates/ dir
      const recentFiles = fs.readdirSync(debatesDir)
        .filter(f => f.startsWith('debate-') && f.endsWith('.json'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(debatesDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

      if (recentFiles.length > 0) {
        const sessionPath = path.join(debatesDir, recentFiles[0].name);
        const session = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
        return { content: [{ type: 'text', text: JSON.stringify({ session, output_path: sessionPath }, null, 2) }] };
      }

      return { content: [{ type: 'text', text: JSON.stringify({ output: result.stdout.slice(-5000), stderr: result.stderr.slice(-2000) }) }] };
    } finally {
      try { fs.unlinkSync(tmpConfig); } catch { /* cleanup */ }
    }
  },
);

// ── start_debate (native async mode) ────────────────────

server.tool(
  'start_debate',
  'Start a debate using the native engine (async). Returns immediately with a debate_id for polling.',
  {
    topic: z.string().describe('Debate topic or question'),
    model: z.string().optional().describe('AI model to use (default: gemini-2.5-flash)'),
    rounds: z.number().optional().describe('Number of rounds (default: 3)'),
    activePovers: z.array(z.string()).optional().describe('Active perspectives (default: all three)'),
    audience: z.string().optional().describe('Target audience'),
    responseLength: z.enum(['brief', 'medium', 'detailed']).optional().describe('Response length preset'),
    enableClarification: z.boolean().optional().describe('Enable clarification phase'),
    useAdaptiveStaging: z.boolean().optional().describe('Enable adaptive phase transitions'),
    maxTotalRounds: z.number().optional().describe('Override max total rounds'),
    pacing: z.string().optional().describe('Pacing preset'),
  },
  async (params) => {
    const debateId = randomUUID().slice(0, 8);
    const controller = new AbortController();

    const state: ActiveDebate = {
      controller,
      progress: { phase: 'setup', message: 'Initializing debate engine...' },
      status: 'running',
    };
    activeDebates.set(debateId, state);

    const config: DebateConfig = {
      topic: params.topic,
      sourceType: 'topic',
      activePovers: (params.activePovers ?? ['accelerationist', 'safetyist', 'skeptic']) as DebateConfig['activePovers'],
      model: params.model ?? 'gemini-2.5-flash',
      rounds: params.rounds ?? 3,
      responseLength: params.responseLength ?? 'medium',
      enableClarification: params.enableClarification,
      useAdaptiveStaging: params.useAdaptiveStaging,
      maxTotalRounds: params.maxTotalRounds,
      pacing: params.pacing as DebateConfig['pacing'],
      signal: controller.signal,
      audience: params.audience as DebateConfig['audience'],
    };

    const adapter = createCLIAdapter(repoRoot);
    const taxonomy = getTaxonomy();
    const engine = new DebateEngine(config, adapter, taxonomy);

    engine.run((p: DebateProgress) => {
      state.progress = p;
    }).then((session) => {
      state.result = session;
      state.status = controller.signal.aborted ? 'cancelled' : 'completed';

      // Persist to disk
      if (!fs.existsSync(debatesDir)) fs.mkdirSync(debatesDir, { recursive: true });
      const outPath = path.join(debatesDir, `debate-${session.id}.json`);
      fs.writeFileSync(outPath, JSON.stringify(session, null, 2) + '\n', 'utf-8');
      updateDebateIndexEntry(debatesDir, session as unknown as Record<string, unknown>);
    }).catch((err) => {
      state.error = err instanceof Error ? err.message : String(err);
      state.status = controller.signal.aborted ? 'cancelled' : 'failed';
    });

    return {
      content: [{ type: 'text', text: JSON.stringify({ debate_id: debateId, status: 'running' }) }],
    };
  },
);

// ── get_debate_progress ─────────────────────────────────

server.tool(
  'get_debate_progress',
  'Poll the progress of a running native-mode debate',
  { debate_id: z.string().describe('Debate ID returned by start_debate') },
  async ({ debate_id }) => {
    const state = activeDebates.get(debate_id);
    if (!state) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown debate_id: ${debate_id}` }) }], isError: true };
    }

    const response: Record<string, unknown> = {
      status: state.status,
      phase: state.progress.phase,
      speaker: state.progress.speaker,
      round: state.progress.round,
      total_rounds: state.progress.totalRounds,
      message: state.progress.message,
    };

    if (state.status === 'completed' && state.result) {
      response.session = state.result;
      activeDebates.delete(debate_id);
    } else if (state.status === 'failed') {
      response.error = state.error;
      activeDebates.delete(debate_id);
    } else if (state.status === 'cancelled') {
      if (state.result) response.session = state.result;
      activeDebates.delete(debate_id);
    }

    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
  },
);

// ── cancel_debate ───────────────────────────────────────

server.tool(
  'cancel_debate',
  'Cancel a running native-mode debate',
  { debate_id: z.string().describe('Debate ID to cancel') },
  async ({ debate_id }) => {
    const state = activeDebates.get(debate_id);
    if (!state) {
      return { content: [{ type: 'text', text: JSON.stringify({ cancelled: false, error: `Unknown debate_id: ${debate_id}` }) }], isError: true };
    }

    if (state.status !== 'running') {
      return { content: [{ type: 'text', text: JSON.stringify({ cancelled: false, reason: `Debate already ${state.status}` }) }] };
    }

    state.controller.abort();
    return { content: [{ type: 'text', text: JSON.stringify({ cancelled: true }) }] };
  },
);

// ── Start server ────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[debate-mcp] Server started\n');
}

main().catch((err) => {
  process.stderr.write(`[debate-mcp] Fatal: ${err}\n`);
  process.exit(1);
});
