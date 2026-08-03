import { err, ok, stableRequirementId } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { extractSpecification } from '../index.js';

import type {
  ExtractSpecificationDeps,
  ModelProviderError,
  SpecificationExtraction,
  SpecificationExtractionPort,
} from '../index.js';
import type { Result } from '@impactgraph/domain';

const clock = { now: (): string => '2026-07-31T10:00:00.000Z' };

const RAW_TEXT = [
  '# Deal visibility',
  'Expired deals must be hidden from search results.',
  'The `DealSearchIndexer` should reindex within 5 minutes.',
  'Add metrics for expired-deal filtering.',
].join('\n');

const providerExtraction: SpecificationExtraction = {
  requirements: [
    {
      statement: 'Expired deals must be hidden from search results.',
      type: 'functional',
      concepts: ['deal', 'search'],
      actors: ['M&A advisor'],
      priority: 'must',
      sourceExcerpt: 'Expired deals must be hidden from search results.',
    },
    {
      statement: 'Reindex within 5 minutes of expiry.',
      type: 'performance',
      concepts: ['DealSearchIndexer'],
      actors: [],
      sourceExcerpt: 'reindex within 5 minutes',
    },
  ],
  actors: ['M&A advisor'],
  constraints: ['No breaking API changes.'],
  openQuestions: [
    {
      question: 'Should already-indexed expired deals be purged or filtered at query time?',
      reason: 'A purge job and a query-time filter produce different architectures.',
      severity: 'blocking',
      affectedRequirementStatements: ['Expired deals must be hidden from search results.'],
    },
  ],
};

const stubExtractor = (
  result: Result<SpecificationExtraction, ModelProviderError>,
): SpecificationExtractionPort => ({
  extract: () => Promise.resolve(result),
});

const request = {
  specificationId: 'spec-1',
  title: 'Deal visibility',
  rawText: RAW_TEXT,
  sourceType: 'markdown' as const,
};

describe('extractSpecification with a provider (Story 5.3)', () => {
  it('builds a versioned spec with stable ids, source ranges, and open questions', async () => {
    const deps: ExtractSpecificationDeps = {
      clock,
      extractor: stubExtractor(ok(providerExtraction)),
    };
    const outcome = await extractSpecification(request, deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const spec = outcome.value.specification;
    expect(outcome.value.extractionMode).toBe('provider');
    expect(spec.version).toBe(1);
    expect(spec.rawText).toBe(RAW_TEXT);

    const first = spec.requirements[0];
    expect(first?.id).toBe(
      stableRequirementId('Expired deals must be hidden from search results.'),
    );
    expect(first?.sourceRange).toEqual({ startOffset: 18, endOffset: 67 });
    expect(first?.status).toBe('draft');

    expect(spec.openQuestions[0]?.severity).toBe('blocking');
    expect(spec.openQuestions[0]?.affectedRequirementIds).toEqual([first?.id]);
    expect(spec.actors.map((actor) => actor.name)).toEqual(['M&A advisor']);
    expect(spec.constraints[0]?.statement).toBe('No breaking API changes.');
  });

  it('re-extraction appends version 2 and keeps unchanged requirement ids stable', async () => {
    const deps: ExtractSpecificationDeps = {
      clock,
      extractor: stubExtractor(ok(providerExtraction)),
    };
    const v1 = await extractSpecification(request, deps);
    if (!v1.ok) {
      throw new Error('v1 failed');
    }
    const v2 = await extractSpecification(
      { ...request, previousVersion: v1.value.specification },
      { clock, extractor: stubExtractor(ok(providerExtraction)) },
    );
    expect(v2.ok).toBe(true);
    if (!v2.ok) {
      return;
    }
    expect(v2.value.specification.version).toBe(2);
    expect(v2.value.specification.requirements.map((r) => r.id)).toEqual(
      v1.value.specification.requirements.map((r) => r.id),
    );
    expect(v1.value.specification.version).toBe(1);
  });

  it('degrades to the deterministic fallback when the provider fails (PRD §8, §34)', async () => {
    const failure: ModelProviderError = {
      name: 'ModelProviderError',
      code: 'provider-unavailable',
      message: 'endpoint down',
    };
    const outcome = await extractSpecification(request, {
      clock,
      extractor: stubExtractor(err(failure)),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.value.extractionMode).toBe('deterministic-fallback');
    expect(outcome.value.providerError?.code).toBe('provider-unavailable');
    expect(outcome.value.specification.requirements.length).toBeGreaterThan(0);
  });
});

describe('deterministic fallback extraction (no provider, Story 5.3)', () => {
  it('splits the spec into typed draft requirements with ranges and priorities', async () => {
    const outcome = await extractSpecification(request, { clock });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const spec = outcome.value.specification;
    expect(outcome.value.extractionMode).toBe('deterministic-fallback');
    expect(spec.requirements.length).toBe(3);

    const hidden = spec.requirements.find((r) => r.statement.includes('must be hidden'));
    expect(hidden?.priority).toBe('must');
    expect(hidden?.sourceRange?.startOffset).toBe(RAW_TEXT.indexOf('Expired deals must'));

    const indexer = spec.requirements.find((r) => r.statement.includes('DealSearchIndexer'));
    expect(indexer?.concepts).toContain('DealSearchIndexer');
    expect(indexer?.priority).toBe('should');

    const metrics = spec.requirements.find((r) => r.statement.includes('metrics'));
    expect(metrics?.type).toBe('observability');
    expect(spec.openQuestions).toEqual([]);
  });

  it('ignores headings, dedupes repeated statements, and skips short fragments', async () => {
    const outcome = await extractSpecification(
      {
        ...request,
        rawText: '# Title\n\n- Users must log in.\n- Users must log in.\n- ok.\n',
      },
      { clock },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.value.specification.requirements.map((r) => r.statement)).toEqual([
      'Users must log in.',
    ]);
  });
});
