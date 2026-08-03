import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readAliasesConfig,
  readArchitectureConfig,
  readRulesConfig,
  scaffoldProjectKnowledgeFiles,
  writeArchitectureConfig,
  writeRulesConfig,
} from './project-config.js';

describe('project knowledge files (Story 8.1, PRD §16–17, §Z13)', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'impactgraph-config-'));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('scaffolds all three files with valid empty defaults, idempotently', () => {
    const first = scaffoldProjectKnowledgeFiles(rootDir);
    expect(first.ok && first.value).toEqual([
      '.impactgraph/architecture.yml',
      '.impactgraph/aliases.yml',
      '.impactgraph/rules.yml',
    ]);
    const second = scaffoldProjectKnowledgeFiles(rootDir);
    expect(second.ok && second.value).toEqual([]);
    expect(readArchitectureConfig(rootDir).ok).toBe(true);
    expect(readAliasesConfig(rootDir).ok).toBe(true);
    expect(readRulesConfig(rootDir).ok).toBe(true);
  });

  it('round-trips an architecture config through YAML', () => {
    const written = writeArchitectureConfig(rootDir, {
      schemaVersion: 1,
      contexts: [{ name: 'deals', paths: ['src/deals/**'] }],
      components: [{ path: 'src/domain/**', role: 'domain' }],
    });
    expect(written.ok).toBe(true);
    const read = readArchitectureConfig(rootDir);
    expect(read.ok && read.value?.contexts?.[0]?.name).toBe('deals');
    expect(read.ok && read.value?.components?.[0]?.role).toBe('domain');
  });

  it('refuses to write an invalid document — the last valid file survives (§Z13)', () => {
    const valid = writeRulesConfig(rootDir, {
      schemaVersion: 1,
      rules: [
        {
          id: 'schema-needs-migration',
          type: 'accompanying-change',
          whenChanged: 'prisma/schema.prisma',
          requireChanged: 'prisma/migrations/**',
        },
      ],
    });
    expect(valid.ok).toBe(true);
    const before = readFileSync(join(rootDir, '.impactgraph/rules.yml'), 'utf8');

    const invalid = writeRulesConfig(rootDir, {
      schemaVersion: 1,
      rules: [{ id: 'broken', type: 'dependency-direction' }],
    } as never);
    expect(invalid.ok).toBe(false);
    expect(readFileSync(join(rootDir, '.impactgraph/rules.yml'), 'utf8')).toBe(before);
  });

  it('reports a typed validation error for a hand-edited invalid file, never a crash', () => {
    scaffoldProjectKnowledgeFiles(rootDir);
    writeFileSync(
      join(rootDir, '.impactgraph/architecture.yml'),
      'schemaVersion: 1\ncontexts:\n  - name: deals\n', // missing required paths
      'utf8',
    );
    const read = readArchitectureConfig(rootDir);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.error.code).toBe('validation');
      expect(read.error.message).toContain('architecture.yml');
    }
  });

  it('returns undefined for missing files (uninitialized workspace)', () => {
    const read = readRulesConfig(rootDir);
    expect(read.ok && read.value).toBeUndefined();
  });
});
