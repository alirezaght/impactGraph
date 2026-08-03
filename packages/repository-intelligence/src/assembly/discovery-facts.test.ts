import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scanWorkspace } from '../scanner/scanner.js';

import { buildDiscoveryFacts } from './discovery-facts.js';

import type { IndexingContext } from '@impactgraph/language-adapters';

const context: IndexingContext = {
  repositorySnapshotId: 'snap-discovery',
  analysisRunId: 'run-discovery',
  createdAt: '2026-08-01T10:00:00.000Z',
};

describe('generic discovery facts (Story 2.1, PRD §15.1)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'impactgraph-discovery-'));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'disco', main: './src/index.ts', bin: { disco: 'src/cli.ts' } }),
    );
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.ts'), 'export const x = 1;\n');
    mkdirSync(join(dir, 'tests'));
    writeFileSync(join(dir, 'tests', 'index.test.ts'), 'export {};\n');
    writeFileSync(join(dir, 'vite.config.ts'), 'export default {};\n');
    writeFileSync(join(dir, 'Makefile'), 'all:\n');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const buildFragment = () => {
    const scan = scanWorkspace(dir);
    return buildDiscoveryFacts(scan.packages, scan.files, context);
  };

  it('emits existing source and test roots as directory nodes contained by the package', () => {
    const fragment = buildFragment();
    const src = fragment.nodes.find((n) => n.id === 'directory:src');
    expect(src?.type).toBe('directory');
    expect(src?.category).toBe('repository');
    expect(src?.knowledge.provenance).toBe('static-analysis');
    expect(fragment.nodes.some((n) => n.id === 'directory:tests')).toBe(true);
    // Conventional roots that do not exist are never emitted.
    expect(fragment.nodes.some((n) => n.id === 'directory:lib')).toBe(false);
    expect(fragment.edges.map((e) => e.id)).toContain('contains:directory:src');
    const contains = fragment.edges.find((e) => e.id === 'contains:directory:tests');
    expect(contains?.sourceId).toBe('package:disco');
    expect(contains?.targetId).toBe('directory:tests');
  });

  it('emits CONFIGURES edges for manifest-adjacent build config with configuration provenance', () => {
    const fragment = buildFragment();
    const configures = fragment.edges.filter((e) => e.type === 'CONFIGURES');
    expect(configures.map((e) => e.sourceId).sort()).toEqual([
      'file:Makefile',
      'file:vite.config.ts',
    ]);
    for (const edge of configures) {
      expect(edge.targetId).toBe('package:disco');
      expect(edge.knowledge.provenance).toBe('configuration');
    }
  });

  it('emits EXPOSES edges for entry points that exist, skipping absent ones', () => {
    const fragment = buildFragment();
    const exposes = fragment.edges.filter((e) => e.type === 'EXPOSES');
    // main → src/index.ts exists; bin → src/cli.ts does not — no guess, no edge.
    expect(exposes.map((e) => e.targetId)).toEqual(['file:src/index.ts']);
    expect(exposes[0]?.sourceId).toBe('package:disco');
    expect(exposes[0]?.knowledge.provenance).toBe('configuration');
  });

  it('binds every fact to the snapshot with evidence (§23.1, provenance-model)', () => {
    const fragment = buildFragment();
    expect(fragment.nodes.length).toBeGreaterThan(0);
    expect(fragment.edges.length).toBeGreaterThan(0);
    const evidenceIds = new Set(fragment.evidence.map((record) => record.id));
    for (const record of [...fragment.nodes, ...fragment.edges]) {
      expect(record.knowledge.repositorySnapshotId).toBe('snap-discovery');
      expect(record.knowledge.evidenceIds.length).toBeGreaterThan(0);
      for (const id of record.knowledge.evidenceIds) {
        expect(evidenceIds.has(id)).toBe(true);
      }
    }
  });

  it('scopes roots and build config to the owning package in a workspace layout', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'disco-root', workspaces: ['pkgs/*'] }),
    );
    mkdirSync(join(dir, 'pkgs', 'web', 'src'), { recursive: true });
    writeFileSync(join(dir, 'pkgs', 'web', 'package.json'), JSON.stringify({ name: '@disco/web' }));
    writeFileSync(join(dir, 'pkgs', 'web', 'src', 'main.ts'), 'export {};\n');
    writeFileSync(join(dir, 'pkgs', 'web', 'tsconfig.json'), '{}\n');
    const fragment = buildFragment();
    const contains = fragment.edges.find((e) => e.id === 'contains:directory:pkgs/web/src');
    expect(contains?.sourceId).toBe('package:@disco/web');
    const configures = fragment.edges.find((e) => e.sourceId === 'file:pkgs/web/tsconfig.json');
    expect(configures?.targetId).toBe('package:@disco/web');
  });
});
