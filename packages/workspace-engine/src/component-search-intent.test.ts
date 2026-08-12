import { describe, expect, it } from 'vitest';

import {
  inferQueryIntent,
  MAX_HITS_PER_FILE,
  rankByIntent,
} from './component-search-intent.js';

import type { ComponentSearchHit } from './component-search-scoring.js';

const hit = (
  nodeId: string,
  path: string,
  score: number,
  overrides: Partial<ComponentSearchHit> = {},
): ComponentSearchHit => ({
  nodeId,
  name: nodeId,
  category: 'application',
  type: 'symbol',
  path,
  provenance: 'static-analysis',
  matchKind: 'conceptual',
  score,
  matchedOn: ['name'],
  ...overrides,
});

describe('inferQueryIntent', () => {
  it('reads a guard question as validation intent', () => {
    expect(inferQueryIntent('constraint invariant rule enforcement ci check')).toBe('validation');
  });

  it('reads a deployment question as runtime intent', () => {
    expect(inferQueryIntent('how does admin reach the newsletter cloud run service')).toBe(
      'runtime',
    );
  });

  it('defaults to implementation when the query says nothing about purpose', () => {
    expect(inferQueryIntent('subscriber preference rendering')).toBe('implementation');
  });
});

describe('rankByIntent — the test-file flood', () => {
  it('ranks production source above tests when evidence is comparable', () => {
    const ranked = rankByIntent(
      [
        hit('t1', 'packages/engine/src/send.test.ts', 0.55, { type: 'test' }),
        hit('t2', 'packages/engine/src/build.test.ts', 0.55, { type: 'test' }),
        hit('p1', 'packages/engine/src/send.ts', 0.5),
      ],
      'subscriber preference rendering',
    );
    expect(ranked.intent).toBe('implementation');
    expect(ranked.hits[0]?.nodeId).toBe('p1');
  });

  it('does the opposite for a validation query', () => {
    const ranked = rankByIntent(
      [
        hit('p1', 'packages/engine/src/send.ts', 0.6),
        hit('g1', 'ci/scripts/check-service-peer-http.py', 0.5),
      ],
      'which ci check forbids peer http',
    );
    expect(ranked.intent).toBe('validation');
    expect(ranked.hits[0]?.nodeId).toBe('g1');
  });

  it('demotes fixture repositories, which are samples rather than this repository', () => {
    const ranked = rankByIntent(
      [
        hit('f1', 'packages/test-kit/fixtures/ts-basic/prisma/migrations/x.sql', 0.8),
        hit('p1', 'packages/persistence/src/migrations.ts', 0.5),
      ],
      'migration',
    );
    expect(ranked.hits[0]?.nodeId).toBe('p1');
  });
});

describe('rankByIntent — the single-interface flood', () => {
  it('stops one file occupying the whole first page, without discarding anything', () => {
    const fields = Array.from({ length: 11 }, (_, index) =>
      hit(`field-${String(index)}`, 'packages/engine/src/architecture-summary.ts', 0.28, {
        type: 'field',
        category: 'data',
      }),
    );
    const other = hit('other', 'packages/engine/src/boundaries.ts', 0.27);
    const ranked = rankByIntent([...fields, other], 'architecture boundary layer structure');
    expect(ranked.hits.slice(0, MAX_HITS_PER_FILE + 1).map((entry) => entry.nodeId)).toContain(
      'other',
    );
    expect(ranked.hits).toHaveLength(12);
  });
});
