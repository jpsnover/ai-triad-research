import { useEffect, useCallback } from 'react';
import { usePipelineStore } from '../store';

let outputCleanup: (() => void) | null = null;
let errorCleanup: (() => void) | null = null;
let cancelRequested = false;

function extractSummary(stepId: string, log: string): string {
  const lines = log.split('\n').filter(l => l.trim());

  switch (stepId) {
    case 'import': {
      const imported = lines.filter(l => /created|ingested|queued/i.test(l));
      const fileCount = imported.length || lines.filter(l => /Import-AITriadDocument/i.test(l)).length;
      if (fileCount > 0) return `${fileCount} doc${fileCount !== 1 ? 's' : ''} imported`;
      return 'Imported';
    }
    case 'summarize': {
      const processed = lines.filter(l => /summary_status.*current|summarised|processed/i.test(l));
      const skipped = lines.filter(l => /skip|already current/i.test(l));
      const parts: string[] = [];
      if (processed.length) parts.push(`${processed.length} summarized`);
      if (skipped.length) parts.push(`${skipped.length} skipped`);
      return parts.join(', ') || 'Summaries updated';
    }
    case 'conflicts': {
      const found = lines.filter(l => /conflict|contradiction|dispute/i.test(l));
      return found.length > 0 ? `${found.length} conflicts` : 'No new conflicts';
    }
    case 'health': {
      const orphans = lines.find(l => /orphan/i.test(l));
      const unmapped = lines.find(l => /unmapped/i.test(l));
      const parts: string[] = [];
      const orphanMatch = orphans?.match(/(\d+)\s*orphan/i);
      if (orphanMatch) parts.push(`${orphanMatch[1]} orphans`);
      const unmappedMatch = unmapped?.match(/(\d+)\s*unmapped/i);
      if (unmappedMatch) parts.push(`${unmappedMatch[1]} unmapped`);
      return parts.join(', ') || 'Health checked';
    }
    case 'proposals': {
      const proposalCount = lines.filter(l => /NEW|SPLIT|MERGE|RELABEL/i.test(l));
      return proposalCount.length > 0 ? `${proposalCount.length} proposals` : 'Proposals generated';
    }
    case 'review': {
      const approved = lines.filter(l => /approved/i.test(l));
      const rejected = lines.filter(l => /rejected/i.test(l));
      const parts: string[] = [];
      if (approved.length) parts.push(`${approved.length} approved`);
      if (rejected.length) parts.push(`${rejected.length} rejected`);
      return parts.join(', ') || 'Review complete';
    }
    case 'integrity': {
      const issues = lines.filter(l => /error|invalid|missing|broken|orphan/i.test(l) && !/VERBOSE/i.test(l));
      return issues.length > 0 ? `${issues.length} issues` : 'All valid';
    }
    case 'backfill': {
      const backfilled = lines.filter(l => /backfill|created key_point|resolved/i.test(l));
      return backfilled.length > 0 ? `${backfilled.length} backfilled` : 'Backfill complete';
    }
    case 'embeddings': {
      const embedded = lines.find(l => /(\d+)\s*(node|embedding|vector)/i.test(l));
      const match = embedded?.match(/(\d+)\s*(node|embedding|vector)/i);
      return match ? `${match[1]} embeddings` : 'Embeddings updated';
    }
    case 'edges': {
      const edgeCount = lines.filter(l => /edge|relationship|proposed/i.test(l));
      return edgeCount.length > 0 ? `${edgeCount.length} edges` : 'Edges discovered';
    }
    case 'attributes': {
      const nodeCount = lines.filter(l => /enriched|attribute|batch/i.test(l));
      return nodeCount.length > 0 ? `${nodeCount.length} nodes` : 'Attributes extracted';
    }
    case 'git-commit': {
      const filesMatch = log.match(/(\d+)\s*file/i);
      return filesMatch ? `${filesMatch[1]} files committed` : 'Committed';
    }
    case 'git-push':
      return 'Pushed';
    default:
      return 'Done';
  }
}

// Data-repo top-level surfaces each pipeline step writes, for a scoped `git add`
// (data-repo CONTRIBUTING.md §5). Only surfaces verified to exist are listed; a step
// whose write location isn't reliably known maps to `null`, which forces the safe
// full-tree fallback in the main process rather than silently under-staging. `[]` =
// read-only step (contributes no surfaces but doesn't trigger the fallback).
const STEP_SURFACES: Record<string, string[] | null> = {
  import: null,
  summarize: ['summaries'],
  conflicts: ['conflicts'],
  health: [],
  proposals: null,
  review: null,
  integrity: [],
  backfill: null,
  attributes: null,
  lineage: null,
  steelman: null,
  embeddings: null,
  edges: null,
};

// Builds the provenance override handed to the git-commit step (t/1333). `steps` is
// the run's data-producing step set (the main process derives the subject workflow
// name + `Steps:` trailer from it). `touchedDirs` is the union of mapped surfaces; if
// ANY executed step has an unknown surface we return [] so the main process takes the
// surfaced full-tree fallback — never a silent partial stage.
function buildCommitContext(executed: string[], runId: string): Record<string, unknown> {
  const st = usePipelineStore.getState();
  const summaries = executed
    .map(id => st.steps[id]?.summary)
    .filter((x): x is string => !!x && x !== 'Skipped');
  const commitSummary = summaries.length ? summaries.join('; ') : 'automated data pipeline update';

  const surfaceSets = executed.map(id => STEP_SURFACES[id]);
  const anyUnknown = surfaceSets.some(set => set == null);
  const touchedDirs = anyUnknown
    ? []
    : Array.from(new Set(surfaceSets.flat().filter((d): d is string => d != null)));

  return { steps: executed, runId, commitSummary, touchedDirs };
}

export function useRunPipeline() {
  useEffect(() => {
    outputCleanup = window.electronAPI.onStepOutput((text) => {
      const activeId = usePipelineStore.getState().activeStepId;
      if (activeId) {
        usePipelineStore.getState().appendLog(activeId, text);
      }
    });
    errorCleanup = window.electronAPI.onStepError((text) => {
      const activeId = usePipelineStore.getState().activeStepId;
      if (activeId) {
        usePipelineStore.getState().appendErrorLog(activeId, text);
      }
    });
    return () => {
      outputCleanup?.();
      errorCleanup?.();
    };
  }, []);

  const runSingle = useCallback(async (stepId: string, configOverride?: Record<string, unknown>) => {
    const s = usePipelineStore.getState();
    s.clearLog(stepId);
    s.setStepStatus(stepId, 'running');
    s.setActiveStep(stepId);
    s.setExpandedStep(stepId);
    s.markStepStart(stepId);

    try {
      const config = { ...(s.steps[stepId]?.config || {}), ...(configOverride || {}) };
      const result = await window.electronAPI.runStep(stepId, config);
      const endState = usePipelineStore.getState();
      endState.markStepEnd(stepId);

      const log = endState.steps[stepId]?.log || '';
      const summary = extractSummary(stepId, log);
      endState.setStepSummary(stepId, summary);

      if (result.exitCode === 0) {
        endState.setStepStatus(stepId, 'success');
      } else {
        endState.setStepStatus(stepId, 'error');
      }
    } catch (err) {
      const endState = usePipelineStore.getState();
      endState.markStepEnd(stepId);
      endState.appendErrorLog(stepId, `\nException: ${err}\n`);
      endState.setStepStatus(stepId, 'error');
      endState.setStepSummary(stepId, 'Failed');
    }

    usePipelineStore.getState().setActiveStep(null);
  }, []);

  const skipStep = useCallback((stepId: string) => {
    const s = usePipelineStore.getState();
    s.setStepStatus(stepId, 'skipped');
    s.setStepSummary(stepId, 'Skipped');
  }, []);

  const runAll = useCallback(async () => {
    cancelRequested = false;
    const s = usePipelineStore.getState();
    s.setPipelineRunning(true);

    // Commit provenance (t/1333): a stable id for this run + the steps that actually
    // produced data, so the git-commit message can self-describe.
    const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const executed: string[] = [];

    for (const def of s.definitions) {
      if (cancelRequested) break;

      const current = usePipelineStore.getState().steps[def.id];
      if (current?.status === 'skipped') continue;
      if (current?.status === 'success') {
        // Already ran this session; its output is uncommitted, so it still counts
        // toward the commit's surfaces (git-commit/push themselves never do).
        if (def.id !== 'git-commit' && def.id !== 'git-push') executed.push(def.id);
        continue;
      }

      // Auto-expand the current step so the user can watch progress
      usePipelineStore.getState().setExpandedStep(def.id);

      if (def.requiresConfig) {
        const config = current?.config || {};
        const hasConfig = def.id === 'import'
          ? (config.importMode === 'inbox' || (config.files as string[])?.length > 0 || (config.url as string)?.length > 0)
          : def.id === 'git-commit'
            ? !!(config.commitMessage as string)
            : def.id === 'review'
              ? !!(config.proposalPath as string)
              : true;

        if (!hasConfig && def.canSkip) {
          usePipelineStore.getState().setStepStatus(def.id, 'skipped');
          usePipelineStore.getState().setStepSummary(def.id, 'Skipped');
          continue;
        }
        if (!hasConfig) {
          usePipelineStore.getState().setStepStatus(def.id, 'pending');
          usePipelineStore.getState().appendLog(def.id, 'Waiting for configuration — fill in the fields above and click Run Step.\n');
          usePipelineStore.getState().setPipelineRunning(false);
          return;
        }
      }

      // Thread run provenance into the commit step (context-threading only — the
      // message shape lives in the main process, t/1333).
      let override: Record<string, unknown> | undefined;
      if (def.id === 'git-commit') {
        override = buildCommitContext(executed, runId);
        if (!(override.touchedDirs as string[]).length) {
          usePipelineStore.getState().appendLog(def.id,
            'Commit surfaces could not be scoped from this run — staging the full tree (git add -A), ' +
            'recorded as "(unknown — full-tree add)" in the commit body.\n');
        }
      }

      await runSingle(def.id, override);

      const result = usePipelineStore.getState().steps[def.id];
      if (result?.status === 'error') {
        usePipelineStore.getState().setPipelineRunning(false);
        return;
      }
      if (result?.status === 'success' && def.id !== 'git-commit' && def.id !== 'git-push') {
        executed.push(def.id);
      }
    }

    usePipelineStore.getState().setPipelineRunning(false);
  }, [runSingle]);

  const cancel = useCallback(async () => {
    cancelRequested = true;
    await window.electronAPI.cancelStep();
    const activeId = usePipelineStore.getState().activeStepId;
    if (activeId) {
      usePipelineStore.getState().setStepStatus(activeId, 'cancelled');
      usePipelineStore.getState().markStepEnd(activeId);
      usePipelineStore.getState().setStepSummary(activeId, 'Cancelled');
    }
    usePipelineStore.getState().setActiveStep(null);
    usePipelineStore.getState().setPipelineRunning(false);
  }, []);

  return { runSingle, runAll, skipStep, cancel };
}
