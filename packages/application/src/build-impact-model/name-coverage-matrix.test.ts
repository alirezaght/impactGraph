import { createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { matchConcepts, nameCoverage, tokensAlign } from './concept-matching.js';

import type { GraphNode, KnowledgeGraph } from '@impactgraph/domain';

// Calibration matrix for name matching. This file measures rather than asserts a threshold: each
// case states what a reader would expect, and the report shows which expectations the current
// rules meet across concept-length buckets. Choosing a number before seeing this curve is how
// MIN_NAME_COVERAGE ended up fitted to two observations.
//
// `verdict` is a human judgment about the pair, not a description of current behaviour:
//   match   — a correct analysis must resolve the concept to this component
//   reject  — resolving it would be a false positive
//   graded  — defensible either way; a single global rule cannot be right for all of these, so
//             these are the cases that argue for ambiguity escalation instead of a yes/no answer

type Verdict = 'match' | 'reject' | 'graded';

interface MatrixCase {
  readonly group: string;
  readonly concept: string;
  readonly nodeName: string;
  readonly verdict: Verdict;
  readonly note?: string;
}

const MATRIX: readonly MatrixCase[] = [
  { group: 'exact token', concept: 'ModelProvider', nodeName: 'ModelProvider', verdict: 'match' },
  { group: 'exact token', concept: 'model provider', nodeName: 'ModelProvider', verdict: 'match' },
  {
    group: 'compound containment',
    concept: 'configureModelProvider',
    nodeName: 'runConfigureModelProvider',
    verdict: 'match',
  },
  {
    group: 'compound containment',
    concept: 'IndexStore',
    nodeName: 'SqliteIndexStore',
    verdict: 'match',
  },
  {
    group: 'prefix substring',
    concept: 'Deal',
    nodeName: 'DealBoard',
    verdict: 'reject',
    note: 'the remainder ("Board") is not an architectural suffix, so the prefix stays a fragment',
  },
  {
    group: 'architectural stem',
    concept: 'Base',
    nodeName: 'BaseService',
    verdict: 'match',
    note: 'ADR-0016: the concept IS the stem once the role suffix is stripped — capped at likely',
  },
  {
    group: 'architectural stem',
    concept: 'Deal',
    nodeName: 'DealRepository',
    verdict: 'match',
    note: 'ADR-0016: stem-covered convention match, name-similarity basis',
  },
  {
    group: 'architectural stem',
    concept: 'deals',
    nodeName: 'DealsController',
    verdict: 'match',
    note: 'the dogfooding item-5 case: spec names the domain word, code adds the role suffix',
  },
  {
    group: 'suffix substring',
    concept: 'Storage',
    nodeName: 'SecretStorage',
    verdict: 'reject',
    note: 'a bare head noun should not claim every compound ending in it',
  },
  {
    group: 'suffix substring',
    concept: 'Dto',
    nodeName: 'DealDto',
    verdict: 'reject',
    note: 'a concept that is only the architectural suffix adds no stem token — still rejected',
  },
  {
    group: 'acronym',
    concept: 'API key',
    nodeName: 'ApiKeySecret',
    verdict: 'match',
    note: 'API/Api differ only by casing convention',
  },
  {
    group: 'abbreviation',
    concept: 'configuration',
    nodeName: 'ConfigRegistry',
    verdict: 'graded',
    note: 'needs a synonym table; no character rule can see config ≈ configuration',
  },
  {
    group: 'inflection',
    concept: 'repositories',
    nodeName: 'RepositoryRegistry',
    verdict: 'graded',
    note: 'needs stemming: repositories → repository',
  },
  {
    group: 'inflection',
    concept: 'providers',
    nodeName: 'ModelProvider',
    verdict: 'graded',
  },
  {
    group: 'word-order variation',
    concept: 'provider model',
    nodeName: 'ModelProvider',
    verdict: 'graded',
    note: 'same tokens, reversed; contiguity requires the order',
  },
  {
    group: 'short token',
    concept: 'AI',
    nodeName: 'MainService',
    verdict: 'reject',
    note: 'no shared token at all',
  },
  {
    group: 'short token',
    concept: 'AI',
    nodeName: 'AiInferenceRegistry',
    verdict: 'graded',
    note: 'a two-character concept is weak evidence however well it aligns',
  },
  {
    group: 'boundary violation',
    concept: 'deal',
    nodeName: 'IdealService',
    verdict: 'reject',
    note: 'substring inside a token, not a token',
  },
  {
    group: 'boundary violation',
    concept: 'index',
    nodeName: 'reindexer',
    verdict: 'reject',
  },
  {
    group: 'hyphen/camel normalisation',
    concept: 'ai-inference',
    nodeName: 'AiInferenceRegistry',
    verdict: 'graded',
    note: 'tokens align but the concept covers under half the name',
  },
  {
    group: 'hyphen/camel normalisation',
    concept: 'provider-config',
    nodeName: 'provider-config.ts',
    verdict: 'match',
  },
  {
    group: 'partial multi-token',
    concept: 'secret storage',
    nodeName: 'SecretProviderStorage',
    verdict: 'graded',
    note: 'both tokens present but not contiguous',
  },
];

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-03T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const graphWith = (nodeName: string): KnowledgeGraph => {
  const node: GraphNode = ((): GraphNode => {
    const result = createGraphNode({
      id: 'symbol:candidate',
      category: 'repository',
      type: 'symbol',
      name: nodeName,
      path: `src/${nodeName}`,
      knowledge,
    });
    if (!result.ok) {
      throw new Error('node invalid');
    }
    return result.value;
  })();
  const graph = createKnowledgeGraph([node], []);
  if (!graph.ok) {
    throw new Error('graph invalid');
  }
  return graph.value;
};

const matches = (entry: MatrixCase): boolean =>
  matchConcepts(graphWith(entry.nodeName), [entry.concept]).matches.length > 0;

const bucketOf = (concept: string): string => {
  const length = concept.replace(/[^A-Za-z0-9]/g, '').length;
  if (length <= 5) {
    return '1: ≤5 chars';
  }
  return length <= 12 ? '2: 6–12 chars' : '3: 13+ chars';
};

describe('name-matching calibration matrix', () => {
  const observed = MATRIX.map((entry) => ({ entry, matched: matches(entry) }));

  it('reports the matrix so the rules can be judged against intent', () => {
    // eslint-disable-next-line no-console
    console.table(
      observed.map(({ entry, matched }) => ({
        group: entry.group,
        concept: entry.concept,
        node: entry.nodeName,
        bucket: bucketOf(entry.concept),
        want: entry.verdict,
        got: matched ? 'match' : 'reject',
        agrees: entry.verdict === 'graded' ? '—' : entry.verdict === (matched ? 'match' : 'reject'),
      })),
    );
    const decided = observed.filter(({ entry }) => entry.verdict !== 'graded');
    const agreeing = decided.filter(
      ({ entry, matched }) => entry.verdict === (matched ? 'match' : 'reject'),
    );
    // eslint-disable-next-line no-console
    console.log(
      `decided cases: ${String(agreeing.length)}/${String(decided.length)} agree; ` +
        `graded cases: ${String(observed.length - decided.length)}`,
    );
    expect(observed).toHaveLength(MATRIX.length);
  });

  it('sweeps the coverage threshold and shows whether one global value can work', () => {
    const thresholds = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];
    const decided = MATRIX.filter((entry) => entry.verdict !== 'graded');
    const rows = thresholds.map((threshold) => {
      const agreeing = decided.filter((entry) => {
        const matched = tokensAlign(entry.concept, entry.nodeName)
          ? nameCoverage(entry.concept, entry.nodeName) >= threshold
          : false;
        return entry.verdict === (matched ? 'match' : 'reject');
      });
      const byBucket = (bucket: string): string => {
        const inBucket = decided.filter((entry) => bucketOf(entry.concept) === bucket);
        const ok = inBucket.filter((entry) => {
          const matched = tokensAlign(entry.concept, entry.nodeName)
            ? nameCoverage(entry.concept, entry.nodeName) >= threshold
            : false;
          return entry.verdict === (matched ? 'match' : 'reject');
        });
        return `${String(ok.length)}/${String(inBucket.length)}`;
      };
      return {
        threshold,
        decidedAgreeing: `${String(agreeing.length)}/${String(decided.length)}`,
        '≤5': byBucket('1: ≤5 chars'),
        '6-12': byBucket('2: 6–12 chars'),
        '13+': byBucket('3: 13+ chars'),
      };
    });
    // eslint-disable-next-line no-console
    console.table(rows);

    // The two cases that decide the question, and they pull in opposite directions.
    const acronym = nameCoverage('API key', 'ApiKeySecret');
    const suffix = nameCoverage('Storage', 'SecretStorage');
    // eslint-disable-next-line no-console
    console.log(
      `must MATCH  API key → ApiKeySecret   coverage ${acronym.toFixed(3)}\n` +
        `must REJECT Storage → SecretStorage  coverage ${suffix.toFixed(3)}`,
    );

    // No global threshold can satisfy both: the pair that must match scores LOWER than the pair
    // that must not. Coverage is not the discriminator these cases need.
    expect(acronym).toBeLessThan(suffix);
  });

  it('never matches across a token boundary, at any concept length', () => {
    for (const { entry, matched } of observed) {
      if (entry.group === 'boundary violation') {
        expect(matched, `${entry.concept} → ${entry.nodeName}`).toBe(false);
      }
    }
  });

  it('always matches an exact or fully-contained multi-token concept', () => {
    for (const { entry, matched } of observed) {
      if (entry.group === 'exact token' || entry.group === 'compound containment') {
        expect(matched, `${entry.concept} → ${entry.nodeName}`).toBe(true);
      }
    }
  });

  // ADR-0016 split this gate in two. Suffix-only concepts stay rejected — a concept must BE the
  // stem, not merely share a token with the name. Stem-covering prefixes now resolve, but only
  // via `name-similarity`, whose basis ceiling caps them at `likely` — never `required`.
  it('never resolves a bare suffix, or a prefix whose remainder is not a role suffix', () => {
    for (const { entry, matched } of observed) {
      if (entry.group === 'prefix substring' || entry.group === 'suffix substring') {
        expect(matched, `${entry.concept} → ${entry.nodeName}`).toBe(false);
      }
    }
  });

  it('resolves a stem-covering concept, and only as name-similarity (ADR-0016)', () => {
    for (const entry of MATRIX) {
      if (entry.group !== 'architectural stem') {
        continue;
      }
      const result = matchConcepts(graphWith(entry.nodeName), [entry.concept]);
      expect(result.matches, `${entry.concept} → ${entry.nodeName}`).toHaveLength(1);
      expect(
        result.matches[0]?.mechanism,
        `${entry.concept} → ${entry.nodeName} must stay under the likely ceiling`,
      ).toBe('name-similarity');
    }
  });
});
