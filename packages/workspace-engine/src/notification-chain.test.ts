import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { searchComponents } from './component-search.js';
import { assessWorkspaceFreshness, lastRunWarningRecords } from './freshness.js';
import { performIndexRun } from './indexing.js';
import { buildImpactPage } from './reports/impact-page.js';
import { buildImpactSummary } from './reports/impact-summary.js';
import { buildAnalysisForSpecification, submitSpecification } from './specifications.js';
import { initializeWorkspace } from './workspace.js';

import type { CliImpactSummary } from '@impactgraph/contracts';
import type { ImpactAnalysis, KnowledgeGraph, Specification } from '@impactgraph/domain';

/**
 * The second observed trial case, end to end (items 4, 5, 8, 9, 11).
 *
 * "An event-driven notification change crosses outbox, Pub/Sub, push route, rendering, tests, and
 * locale JSON." Every one of those hops used to be an unrelated fact, so a specification naming the
 * producer reached the producer. This suite asserts that the chain is now traversable from the
 * specification, that the locale keys are in it, and that the answer stays bounded.
 */

const SPEC = `# NDA signature notification

## Context

The buyer currently receives no notification when a seller requests an NDA signature.

## Requirements

R1: \`NdaService\` must emit a \`notification.nda_signature_request\` event when a signature is requested.
R2: The rendered message must name the seller in its subject line.

## Non-goals

- Reworking \`drainOutbox\`.
`;

describe('the notification chain (items 4, 5, 8)', () => {
  let repoDir: string;
  let summary: CliImpactSummary;
  let spec: Specification;
  let analysis: ImpactAnalysis;
  let graph: KnowledgeGraph;

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-chain-'));
    cpSync(fixtureRepoPath('notification-chain'), repoDir, { recursive: true });
    for (const args of [
      ['init', '-b', 'main'],
      ['config', 'user.email', 'chain@test.dev'],
      ['config', 'user.name', 'Chain Test'],
      ['config', 'commit.gpgsign', 'false'],
      ['add', '.'],
      ['commit', '-m', 'fixture'],
    ]) {
      execFileSync('git', args, { cwd: repoDir });
    }
    initializeWorkspace(repoDir);
    const indexed = await performIndexRun(repoDir);
    expect(indexed.ok).toBe(true);
    writeFileSync(join(repoDir, 'spec.md'), SPEC);
    const submitted = await submitSpecification({
      rootDir: repoDir,
      specName: 'spec.md',
      rawText: SPEC,
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      return;
    }
    const built = await buildAnalysisForSpecification(repoDir, submitted.value.specification);
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    spec = submitted.value.specification;
    analysis = built.value.analysis;
    graph = built.value.graph;
    summary = buildImpactSummary({
      specification: submitted.value.specification,
      analysis: built.value.analysis,
      graph: built.value.graph,
      freshness: await assessWorkspaceFreshness({ rootDir: repoDir }),
      extractionMode: submitted.value.extractionMode,
      indexWarnings: await lastRunWarningRecords(repoDir),
      filters: { topN: 60 },
    });
  }, 120_000);

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  const names = (): readonly string[] => summary.topImpacts.map((impact) => impact.name);

  it('respects the specification structure: two labelled requirements, no invented ones', () => {
    expect(summary.specification.extractionQuality?.strategy).toBe('structured');
    expect(summary.specification.extractionQuality?.structuredRequirementCount).toBe(2);
    expect(summary.coverage.requirementCount).toBe(2);
  });

  it('reaches the outbox record the producer writes', () => {
    expect(names()).toContain('notification.nda_signature_request');
    const record = summary.topImpacts.find(
      (impact) => impact.name === 'notification.nda_signature_request',
    );
    // R1 names the event verbatim, so this is a direct structural anchor, not a chain finding —
    // which is why it is `required`.
    expect(record?.evidenceType).toBe('direct-structural');
    expect(record?.likelihood).toBe('required');
  });

  it('crosses the relay into the Pub/Sub topic, and says the basis was the event chain', () => {
    expect(names()).toContain('notification-events');
    const topic = summary.topImpacts.find((impact) => impact.name === 'notification-events');
    expect(topic?.evidenceType).toBe('async-event');
    // Reached across the chain, so it is NOT presented as an obligation.
    expect(topic?.likelihood).not.toBe('required');
  });

  it('crosses the topic into the consumer side: push endpoint and projection', () => {
    const found = names();
    expect(found).toContain('POST /pubsub/notifications');
    expect(found).toContain('projectNotification');
  });

  it('reaches the locale keys the rendering path uses', () => {
    const keys = names().filter((name) => name.startsWith('nda.signature_request'));
    expect(keys).toContain('nda.signature_request.subject');
    const key = summary.topImpacts.find(
      (impact) => impact.name === 'nda.signature_request.subject',
    );
    // The route crossed a topic AND ended at a locale entry, so BOTH bases hold. The primary is the
    // strongest — the event chain is what made the key reachable at all — and the full set is on the
    // detail page, which is where a reader looking at one finding goes.
    expect(key?.evidenceType).toBe('async-event');
    const page = buildImpactPage({
      specification: spec,
      analysis,
      graph,
      filters: { topN: 200 },
    });
    const detail = page.impacts.find((impact) => impact.name === 'nda.signature_request.subject');
    expect(detail?.evidenceTypes).toContain('configuration-asset');
    expect(detail?.evidenceTypes).toContain('async-event');
    // The chain is long, so the tier is exploratory — reach without false confidence.
    expect(detail?.likelihood).toBe('possible');
    expect(detail?.dependencyPath.length).toBeGreaterThan(4);
  });

  it('predicts the artifact categories the change needs', () => {
    const categories = summary.predictedArtifacts.map((prediction) => prediction.category);
    expect(categories).toContain('new-locale-entry');
    expect(categories).toContain('new-test');
    // Every prediction points at artifacts that EXIST — never at an invented path (item 8).
    for (const prediction of summary.predictedArtifacts) {
      expect(prediction.examplePaths.length).toBeGreaterThan(0);
    }
  });

  it('honours the non-goal instead of turning it into an impact', () => {
    const drain = summary.topImpacts.find((impact) => impact.name === 'drainOutbox');
    expect(drain).toBeUndefined();
    const withExcluded = summary.pagination.appliedFilters.includeExcluded;
    expect(withExcluded).toBe(false);
  });

  it('stays bounded and states its own scope', () => {
    expect(JSON.stringify(summary).length).toBeLessThan(40_000);
    expect(summary.impactQuery.scope).toContain('snapshot');
    expect(summary.impactQuery.limitations.length).toBeGreaterThan(0);
  });
});

describe('conceptual component search on the notification chain (item 4)', () => {
  let repoDir: string;

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-search-'));
    cpSync(fixtureRepoPath('notification-chain'), repoDir, { recursive: true });
    initializeWorkspace(repoDir);
    execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 'chain@test.dev'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'Chain Test'], { cwd: repoDir });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repoDir });
    execFileSync('git', ['add', '.'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repoDir });
    expect((await performIndexRun(repoDir)).ok).toBe(true);
  }, 120_000);

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('answers the conceptual query the trials said returned nothing', async () => {
    const found = await searchComponents(
      repoDir,
      'NDA signature request notification message rendering buyer seller',
      { limit: 30 },
    );
    expect(found.ok).toBe(true);
    if (!found.ok) {
      return;
    }
    const names = found.value.components.map((hit) => hit.name);
    // Not one exact identifier appears in that query, and it still finds the rendering path, the
    // producer, the event and the locale keys.
    expect(names).toContain('renderMessage');
    expect(names.some((name) => name.startsWith('nda.signature_request'))).toBe(true);
    expect(names).toContain('NdaService');
    // Every hit says HOW it was found, so a conceptual lead is distinguishable from an identifier.
    expect(found.value.matchKinds.length).toBeGreaterThan(0);
    expect(found.value.components.every((hit) => hit.matchKind.length > 0 && hit.score > 0)).toBe(
      true,
    );
  });

  it('still answers an exact identifier query as an exact match', async () => {
    const found = await searchComponents(repoDir, 'MessageRenderer');
    expect(found.ok).toBe(true);
    if (!found.ok) {
      return;
    }
    // `MessageRenderer` is not a symbol in this fixture — the file is `message-renderer.ts`. The
    // point of the assertion is the grade: a normalized-name or conceptual hit, never `exact`.
    expect(found.value.components.every((hit) => hit.matchKind !== 'exact')).toBe(true);
    const exact = await searchComponents(repoDir, 'renderMessage');
    expect(exact.ok && exact.value.components[0]?.matchKind).toBe('exact');
  });

  it('distinguishes an unsupported query from an empty result (item 11)', async () => {
    const unsupported = await searchComponents(repoDir, '#!');
    expect(unsupported.ok).toBe(true);
    if (!unsupported.ok) {
      return;
    }
    expect(unsupported.value.outcome.status).toBe('failed');
    expect(unsupported.value.outcome.reason).toContain('no searchable term');

    const absent = await searchComponents(repoDir, 'quantum ledger reconciliation');
    expect(absent.ok).toBe(true);
    if (!absent.ok) {
      return;
    }
    expect(absent.value.outcome.status).toBe('completed-empty');
    expect(absent.value.outcome.scope).toContain('snapshot');
    expect(absent.value.outcome.limitations.join(' ')).toContain('not registered in the workspace');
  });
});
