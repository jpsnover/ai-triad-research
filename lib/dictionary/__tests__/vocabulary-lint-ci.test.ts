import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DictionaryLoader } from '../loader';
import { lintDictionary, lintNodes, lintText } from '../lint';

const dataRoot = path.resolve(__dirname, '../../../../ai-triad-data');
const dictionaryDir = path.join(dataRoot, 'dictionary');
const taxonomyDir = path.join(dataRoot, 'taxonomy', 'Origin');
const summariesDir = path.join(dataRoot, 'summaries');

function loadTaxonomyNodes(file: string): Array<{ id: string; label?: string; description?: string; graph_attributes?: { characteristic_language?: string[] } }> {
  const raw = JSON.parse(fs.readFileSync(path.join(taxonomyDir, file), 'utf-8'));
  return raw.nodes ?? [];
}

// Labels are short titles where bare terms are intentional — only lint prose fields.
const LINT_OPTS = { constraints: [4] as number[], skipFields: ['label'] };

describe('vocabulary lint: dictionary consistency', () => {
  it('dictionary has zero internal violations (constraints 1,3,7,8)', () => {
    const loader = new DictionaryLoader(dictionaryDir);
    const violations = lintDictionary(loader, undefined, { constraints: [1, 3, 7, 8] });
    expect(violations).toEqual([]);
  });

  it('all used_by_nodes reference valid taxonomy node IDs', () => {
    const loader = new DictionaryLoader(dictionaryDir);
    const allNodeIds = new Set<string>();
    for (const file of ['accelerationist.json', 'safetyist.json', 'skeptic.json', 'situations.json']) {
      const filePath = path.join(taxonomyDir, file);
      if (!fs.existsSync(filePath)) continue;
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      for (const node of raw.nodes ?? []) {
        allNodeIds.add(node.id);
      }
    }
    const violations = lintDictionary(loader, allNodeIds, { constraints: [2] });
    expect(violations).toEqual([]);
  });
});

describe('vocabulary lint: taxonomy nodes (strict)', () => {
  const povFiles = ['accelerationist.json', 'safetyist.json', 'skeptic.json'];

  for (const file of povFiles) {
    it(`${file.replace('.json', '')} prose fields have zero bare-term violations`, () => {
      const filePath = path.join(taxonomyDir, file);
      if (!fs.existsSync(filePath)) return;
      const loader = new DictionaryLoader(dictionaryDir);
      const nodes = loadTaxonomyNodes(file);
      const violations = lintNodes(nodes, loader, LINT_OPTS);
      if (violations.length > 0) {
        const summary = violations.slice(0, 5).map(v => `  ${v.file}: ${v.message}`).join('\n');
        expect.fail(`${violations.length} bare-term violation(s) in ${file}:\n${summary}`);
      }
    });
  }
});

describe('vocabulary lint: taxonomy nodes (informational)', () => {
  it('situations.json bare-term count (not yet reprocessed)', () => {
    const filePath = path.join(taxonomyDir, 'situations.json');
    if (!fs.existsSync(filePath)) return;
    const loader = new DictionaryLoader(dictionaryDir);
    const nodes = loadTaxonomyNodes('situations.json');
    const violations = lintNodes(nodes, loader, LINT_OPTS);
    console.log(`\n  Situations lint: ${nodes.length} nodes, ${violations.length} bare-term violations (informational)`);
    expect(nodes.length).toBeGreaterThan(0);
  });
});

describe('vocabulary lint: summaries (informational)', () => {
  it('reports bare-term count across summaries', () => {
    if (!fs.existsSync(summariesDir)) return;
    const loader = new DictionaryLoader(dictionaryDir);

    const summaryFiles = fs.readdirSync(summariesDir).filter(f => f.endsWith('.json'));

    let totalViolations = 0;
    let filesScanned = 0;
    let filesWithViolations = 0;

    for (const file of summaryFiles) {
      const filePath = path.join(summariesDir, file);

      try {
        const summary = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (!summary.pov_summaries) continue;
        filesScanned++;

        let fileViolations = 0;

        for (const camp of ['accelerationist', 'safetyist', 'skeptic']) {
          const campData = summary.pov_summaries?.[camp];
          if (!campData?.key_points) continue;
          for (const kp of campData.key_points) {
            if (kp.point) {
              const v = lintText(kp.point, loader, { file: `${file}/${camp}`, constraints: [4] });
              fileViolations += v.length;
            }
          }
        }

        if (fileViolations > 0) {
          filesWithViolations++;
          totalViolations += fileViolations;
        }
      } catch { /* skip malformed */ }
    }

    console.log(`\n  Summary lint: ${filesScanned} files scanned, ${filesWithViolations} with bare terms, ${totalViolations} total violations`);
    // Informational only — does not fail. Turn into strict check after reprocessing.
    expect(filesScanned).toBeGreaterThan(0);
  });
});
