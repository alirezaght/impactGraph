import { describe, expect, it } from 'vitest';

import { assessFreshness } from './index-freshness.js';
import { createRepositorySnapshot } from './repository-snapshot.js';

import type { RepositorySnapshot } from './repository-snapshot.js';

// Item 10: staleness must be an active warning, not a recorded field nobody reads.

const snapshot = (commitSha: string, createdAt: string, dirty = false): RepositorySnapshot => {
  const created = createRepositorySnapshot({
    id: `snap-${commitSha.slice(0, 12)}`,
    repositoryIdentity: 'git@example.com:acme/deal-management.git',
    head: { kind: 'branch', branch: 'main', commitSha },
    dirtyWorkingTree: dirty,
    indexVersion: 1,
    createdAt,
  });
  if (!created.ok) {
    throw new Error(created.error.issues.map((issue) => issue.message).join('; '));
  }
  return created.value;
};

const HEAD = 'a'.repeat(40);
const MOVED = 'b'.repeat(40);
const INDEXED_AT = '2026-08-04T10:00:00.000Z';
const NOW = '2026-08-04T10:30:00.000Z';

describe('assessFreshness', () => {
  it('reports current when HEAD matches and the tree is clean', () => {
    const freshness = assessFreshness({
      indexed: snapshot(HEAD, INDEXED_AT),
      current: { commitSha: HEAD, dirtyWorkingTree: false },
      now: NOW,
    });
    expect(freshness.state).toBe('current');
    expect(freshness.stale).toBe(false);
    expect(freshness.recommendedAction).toBeUndefined();
  });

  it('reports behind-head with both commits named', () => {
    const freshness = assessFreshness({
      indexed: snapshot(HEAD, INDEXED_AT),
      current: { commitSha: MOVED, dirtyWorkingTree: false },
      now: NOW,
    });
    expect(freshness.state).toBe('behind-head');
    expect(freshness.stale).toBe(true);
    expect(freshness.reasons[0]).toContain(HEAD.slice(0, 12));
    expect(freshness.reasons[0]).toContain(MOVED.slice(0, 12));
    expect(freshness.recommendedAction).toContain('impactgraph index');
  });

  it('reports a modified working tree', () => {
    const freshness = assessFreshness({
      indexed: snapshot(HEAD, INDEXED_AT),
      current: { commitSha: HEAD, dirtyWorkingTree: true },
      now: NOW,
    });
    expect(freshness.state).toBe('working-tree-modified');
    expect(freshness.reasons[0]).toContain('uncommitted changes');
  });

  it('reports both reasons when HEAD moved AND the tree is dirty, strongest first', () => {
    const freshness = assessFreshness({
      indexed: snapshot(HEAD, INDEXED_AT),
      current: { commitSha: MOVED, dirtyWorkingTree: true },
      now: NOW,
    });
    expect(freshness.state).toBe('behind-head');
    expect(freshness.reasons).toHaveLength(2);
  });

  it('reports a moved specification version', () => {
    const freshness = assessFreshness({
      indexed: snapshot(HEAD, INDEXED_AT),
      current: { commitSha: HEAD, dirtyWorkingTree: false },
      now: NOW,
      specificationVersion: 2,
      latestSpecificationVersion: 4,
    });
    expect(freshness.state).toBe('specification-moved');
    expect(freshness.reasons[0]).toContain('version 4');
  });

  it('reports an aged index even when HEAD still matches', () => {
    const freshness = assessFreshness({
      indexed: snapshot(HEAD, INDEXED_AT),
      current: { commitSha: HEAD, dirtyWorkingTree: false },
      now: '2026-08-07T10:00:00.000Z',
    });
    expect(freshness.state).toBe('aged');
    expect(freshness.reasons[0]).toContain('72 hours old');
  });

  it('reports not-indexed as stale, since nothing can be concluded', () => {
    const freshness = assessFreshness({ now: NOW });
    expect(freshness.state).toBe('not-indexed');
    expect(freshness.stale).toBe(true);
  });

  it('does not claim freshness it cannot verify when current state is unknown', () => {
    const freshness = assessFreshness({ indexed: snapshot(HEAD, INDEXED_AT), now: NOW });
    expect(freshness.state).toBe('current');
    expect(freshness.currentCommitSha).toBeUndefined();
  });
});
