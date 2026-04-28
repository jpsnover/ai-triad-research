import fs from 'fs';
import path from 'path';
import type {
  StandardizedTerm,
  ColloquialTerm,
  DictionaryVersion,
  StandardizedTermFilter,
  ColloquialTermFilter,
} from './types';

const EXPECTED_SCHEMA_VERSION = '1.0.0';

export class DictionaryLoader {
  private readonly dictionaryDir: string;
  private version: DictionaryVersion | null = null;
  private standardizedCache: Map<string, StandardizedTerm> | null = null;
  private colloquialCache: Map<string, ColloquialTerm> | null = null;

  constructor(dictionaryDir: string) {
    this.dictionaryDir = dictionaryDir;
  }

  getDictionaryDir(): string {
    return this.dictionaryDir;
  }

  getVersion(): DictionaryVersion {
    if (!this.version) {
      const versionPath = path.join(this.dictionaryDir, 'schema', 'version.json');
      if (!fs.existsSync(versionPath)) {
        throw new Error(
          `Dictionary version file not found at ${versionPath}. ` +
          `Is the dictionary directory initialized?`
        );
      }
      this.version = JSON.parse(fs.readFileSync(versionPath, 'utf-8')) as DictionaryVersion;
      if (this.version.schema_version !== EXPECTED_SCHEMA_VERSION) {
        throw new Error(
          `Dictionary schema version mismatch: expected ${EXPECTED_SCHEMA_VERSION}, ` +
          `got ${this.version.schema_version}. Run the migration script or update the loader.`
        );
      }
    }
    return this.version;
  }

  private loadAllStandardized(): Map<string, StandardizedTerm> {
    if (this.standardizedCache) return this.standardizedCache;
    this.getVersion();
    const dir = path.join(this.dictionaryDir, 'standardized');
    const map = new Map<string, StandardizedTerm>();
    if (!fs.existsSync(dir)) return (this.standardizedCache = map);
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as StandardizedTerm;
      if (raw.$schema_version !== EXPECTED_SCHEMA_VERSION) {
        throw new Error(
          `Schema version mismatch in ${file}: expected ${EXPECTED_SCHEMA_VERSION}, ` +
          `got ${raw.$schema_version}`
        );
      }
      map.set(raw.canonical_form, raw);
    }
    this.standardizedCache = map;
    return map;
  }

  private loadAllColloquial(): Map<string, ColloquialTerm> {
    if (this.colloquialCache) return this.colloquialCache;
    this.getVersion();
    const dir = path.join(this.dictionaryDir, 'colloquial');
    const map = new Map<string, ColloquialTerm>();
    if (!fs.existsSync(dir)) return (this.colloquialCache = map);
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as ColloquialTerm;
      if (raw.$schema_version !== EXPECTED_SCHEMA_VERSION) {
        throw new Error(
          `Schema version mismatch in ${file}: expected ${EXPECTED_SCHEMA_VERSION}, ` +
          `got ${raw.$schema_version}`
        );
      }
      map.set(raw.colloquial_term, raw);
    }
    this.colloquialCache = map;
    return map;
  }

  getStandardized(canonical_form: string): StandardizedTerm | null {
    return this.loadAllStandardized().get(canonical_form) ?? null;
  }

  getColloquial(term: string): ColloquialTerm | null {
    return this.loadAllColloquial().get(term) ?? null;
  }

  listStandardized(filters?: StandardizedTermFilter): StandardizedTerm[] {
    const all = Array.from(this.loadAllStandardized().values());
    if (!filters) return all;
    return all.filter((t) => {
      if (filters.primary_camp_origin && t.primary_camp_origin !== filters.primary_camp_origin) return false;
      if (filters.coinage_status && t.coinage_status !== filters.coinage_status) return false;
      if (filters.contains_term) {
        const needle = filters.contains_term.toLowerCase();
        const haystack = `${t.canonical_form} ${t.display_form} ${t.definition}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }

  listColloquial(filters?: ColloquialTermFilter): ColloquialTerm[] {
    const all = Array.from(this.loadAllColloquial().values());
    if (!filters) return all;
    return all.filter((t) => {
      if (filters.status && t.status !== filters.status) return false;
      if (filters.standardized_target) {
        const target = filters.standardized_target;
        if (!t.resolves_to.some((r) => r.standardized_term === target)) return false;
      }
      return true;
    });
  }

  getCanonicalFormSet(): Set<string> {
    return new Set(this.loadAllStandardized().keys());
  }

  getDisplayFormMap(): Map<string, string> {
    const map = new Map<string, string>();
    for (const [canonical, term] of this.loadAllStandardized()) {
      map.set(canonical, term.display_form);
    }
    return map;
  }

  invalidateCache(): void {
    this.version = null;
    this.standardizedCache = null;
    this.colloquialCache = null;
  }
}

export function createLoader(dictionaryDir: string): DictionaryLoader {
  return new DictionaryLoader(dictionaryDir);
}
