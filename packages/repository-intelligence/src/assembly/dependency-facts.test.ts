import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scanWorkspace } from '../scanner/scanner.js';

import { buildDependencyFacts } from './dependency-facts.js';

import type { IndexingContext } from '@impactgraph/language-adapters';

const context: IndexingContext = {
  repositorySnapshotId: 'snap-deps',
  analysisRunId: 'run-deps',
  createdAt: '2026-08-03T10:00:00.000Z',
};

describe('declared dependency facts (PRD §15.1)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'impactgraph-deps-'));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
    );
    mkdirSync(join(dir, 'packages', 'store'), { recursive: true });
    writeFileSync(
      join(dir, 'packages', 'store', 'package.json'),
      JSON.stringify({
        name: '@app/store',
        dependencies: { 'better-sqlite3': '^11.0.0' },
        devDependencies: { vitest: '^3.0.0', '@app/kit': 'workspace:*' },
      }),
    );
    writeFileSync(join(dir, 'packages', 'store', 'index.ts'), 'export const x = 1;\n');
    mkdirSync(join(dir, 'packages', 'kit'), { recursive: true });
    writeFileSync(
      join(dir, 'packages', 'kit', 'package.json'),
      JSON.stringify({ name: '@app/kit' }),
    );
    writeFileSync(join(dir, 'packages', 'kit', 'index.ts'), 'export const y = 2;\n');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const buildFragment = () => {
    const scan = scanWorkspace(dir);
    return buildDependencyFacts(scan.packages, context);
  };

  it('makes an external dependency addressable by the name a specification would use', () => {
    const fragment = buildFragment();
    const sqlite = fragment.nodes.find((node) => node.id === 'dependency:better-sqlite3');

    expect(sqlite?.name).toBe('better-sqlite3');
    expect(sqlite?.category).toBe('integration');
    expect(sqlite?.type).toBe('third-party-service');
    expect(sqlite?.knowledge.provenance).toBe('configuration');
  });

  it('links the declaring package to the dependency it declares', () => {
    const fragment = buildFragment();
    const edge = fragment.edges.find(
      (candidate) => candidate.id === 'depends-on:package:@app/store->dependency:better-sqlite3',
    );

    expect(edge?.type).toBe('DEPENDS_ON');
    expect(edge?.sourceId).toBe('package:@app/store');
    expect(edge?.targetId).toBe('dependency:better-sqlite3');
    expect(edge?.knowledge.provenance).toBe('configuration');
  });

  it('cites the manifest key that declared the dependency as evidence', () => {
    const fragment = buildFragment();
    const evidence = fragment.evidence.find((record) => record.id.includes('better-sqlite3'));

    expect(evidence?.kind).toBe('config-entry');
    expect(evidence?.source).toMatchObject({
      kind: 'config',
      filePath: 'packages/store/package.json',
      configKey: 'dependencies.better-sqlite3',
    });
  });

  it('points a workspace-internal dependency at the existing package node, not a new one', () => {
    const fragment = buildFragment();

    expect(fragment.nodes.some((node) => node.id === 'dependency:@app/kit')).toBe(false);
    expect(fragment.edges.map((edge) => edge.targetId)).toContain('package:@app/kit');
  });

  it('records dev dependencies too, since packaging and tooling live there', () => {
    const fragment = buildFragment();

    expect(fragment.nodes.some((node) => node.id === 'dependency:vitest')).toBe(true);
  });

  it('emits each dependency once even when several packages declare it', () => {
    writeFileSync(
      join(dir, 'packages', 'kit', 'package.json'),
      JSON.stringify({ name: '@app/kit', dependencies: { 'better-sqlite3': '^11.0.0' } }),
    );
    const fragment = buildFragment();
    const nodes = fragment.nodes.filter((node) => node.id === 'dependency:better-sqlite3');

    expect(nodes).toHaveLength(1);
    expect(
      fragment.edges.filter((edge) => edge.targetId === 'dependency:better-sqlite3'),
    ).toHaveLength(2);
  });
});
