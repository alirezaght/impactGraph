import { describe, expect, it } from 'vitest';

import {
  candidateMovement,
  graphMovement,
  parseCandidateGolden,
  parseGraphGolden,
} from './movement.js';

// The classifier is tested directly because a movement report that misclassifies is worse than no
// report: it would be read as an acceptance record. The cases below are the ones that would
// otherwise be silently mislabelled — a promotion looking like remove+add, a reversal looking like
// remove+add, a retype looking like unchanged.

const candidates = (...lines: readonly string[]): string =>
  ['impacts:', ...lines, '', 'warnings:', ''].join('\n');

interface CandidateFields {
  readonly name: string;
  readonly likelihood: string;
  readonly confidence: string;
  readonly relationship: string;
  readonly explanation?: string;
}

const candidate = (fields: CandidateFields): string =>
  [
    'req-1',
    fields.name,
    fields.likelihood,
    'domain-model',
    'indirect',
    fields.confidence,
    fields.relationship,
    fields.explanation ?? 'aaaa1111',
    'sig',
  ].join('|');

const graph = (...lines: readonly string[]): string =>
  ['nodes:', '', 'edges:', ...lines, ''].join('\n');

describe('candidate movement', () => {
  const before = parseCandidateGolden(
    candidates(
      candidate({ name: 'A', likelihood: 'possible', confidence: '0.50', relationship: 'CALLS' }),
    ),
  );

  it('reports a tier change as promoted, not as a removal plus an addition', () => {
    const after = parseCandidateGolden(
      candidates(
        candidate({ name: 'A', likelihood: 'likely', confidence: '0.50', relationship: 'CALLS' }),
      ),
    );
    const report = candidateMovement(before, after);

    expect(report.totals).toEqual({ promoted: 1 });
    expect(report.detail['promoted']).toEqual({ 'possible → likely (CALLS)': 1 });
  });

  it('reports a demotion separately from a promotion', () => {
    const from = parseCandidateGolden(
      candidates(
        candidate({ name: 'A', likelihood: 'likely', confidence: '0.50', relationship: 'CALLS' }),
      ),
    );
    const to = parseCandidateGolden(
      candidates(
        candidate({ name: 'A', likelihood: 'possible', confidence: '0.50', relationship: 'CALLS' }),
      ),
    );

    expect(candidateMovement(from, to).totals).toEqual({ demoted: 1 });
  });

  it('reports a retyped relationship at a stable tier', () => {
    const after = parseCandidateGolden(
      candidates(
        candidate({
          name: 'A',
          likelihood: 'possible',
          confidence: '0.50',
          relationship: 'INJECTS',
        }),
      ),
    );

    expect(candidateMovement(before, after).totals).toEqual({ 'relationship-changed': 1 });
  });

  it('does not collapse a confidence change into unchanged', () => {
    const after = parseCandidateGolden(
      candidates(
        candidate({ name: 'A', likelihood: 'possible', confidence: '0.65', relationship: 'CALLS' }),
      ),
    );

    expect(candidateMovement(before, after).totals).toEqual({ 'confidence-changed': 1 });
  });

  it('does not collapse an explanation change into unchanged', () => {
    const after = parseCandidateGolden(
      candidates(
        candidate({
          name: 'A',
          likelihood: 'possible',
          confidence: '0.50',
          relationship: 'CALLS',
          explanation: 'bbbb2222',
        }),
      ),
    );

    expect(candidateMovement(before, after).totals).toEqual({ 'explanation-changed': 1 });
  });

  it('reports genuine additions and removals', () => {
    const after = parseCandidateGolden(
      candidates(
        candidate({ name: 'B', likelihood: 'possible', confidence: '0.50', relationship: 'CALLS' }),
      ),
    );
    const report = candidateMovement(before, after);

    expect(report.totals).toEqual({ added: 1, removed: 1 });
  });

  it('reports an untouched candidate as unchanged', () => {
    expect(candidateMovement(before, before).totals).toEqual({ unchanged: 1 });
  });
});

describe('graph movement', () => {
  it('reports a reversed edge as direction-changed, not remove plus add', () => {
    const before = parseGraphGolden(graph('INJECTS|symbol:a->symbol:b|static-analysis|ev1'));
    const after = parseGraphGolden(graph('INJECTS|symbol:b->symbol:a|static-analysis|ev1'));

    expect(graphMovement(before, after).totals).toEqual({ 'direction-changed': 1 });
  });

  it('reports a retyped edge as relationship-changed', () => {
    const before = parseGraphGolden(graph('USES|symbol:a->symbol:b|framework-convention|ev1'));
    const after = parseGraphGolden(graph('INJECTS|symbol:a->symbol:b|framework-convention|ev1'));
    const report = graphMovement(before, after);

    expect(report.totals).toEqual({ 'relationship-changed': 1 });
    expect(report.detail['relationship-changed']).toEqual({ 'USES → INJECTS': 1 });
  });

  it('reports a provenance change on an otherwise identical edge', () => {
    const before = parseGraphGolden(graph('CALLS|symbol:a->symbol:b|static-analysis|ev1'));
    const after = parseGraphGolden(graph('CALLS|symbol:a->symbol:b|framework-convention|ev1'));

    expect(graphMovement(before, after).totals).toEqual({ 'provenance-changed': 1 });
  });

  it('reports an evidence change that leaves everything else alone', () => {
    const before = parseGraphGolden(graph('CALLS|symbol:a->symbol:b|static-analysis|ev1'));
    const after = parseGraphGolden(graph('CALLS|symbol:a->symbol:b|static-analysis|ev2'));

    expect(graphMovement(before, after).totals).toEqual({ 'evidence-changed': 1 });
  });

  it('reports genuine additions and removals', () => {
    const before = parseGraphGolden(graph('CALLS|symbol:a->symbol:b|static-analysis|ev1'));
    const after = parseGraphGolden(graph('CALLS|symbol:c->symbol:d|static-analysis|ev1'));

    expect(graphMovement(before, after).totals).toEqual({ added: 1, removed: 1 });
  });

  it('refuses to guess when two edges share the same endpoint pair', () => {
    // Both sides have two edges between a and b. Pairing them is a coin flip, so the report says so
    // rather than inventing a direction-changed or relationship-changed it cannot justify.
    const before = parseGraphGolden(
      graph(
        'USES|symbol:a->symbol:b|static-analysis|ev1',
        'CALLS|symbol:b->symbol:a|static-analysis|ev1',
      ),
    );
    const after = parseGraphGolden(
      graph(
        'INJECTS|symbol:a->symbol:b|static-analysis|ev1',
        'NAVIGATES_TO|symbol:b->symbol:a|static-analysis|ev1',
      ),
    );

    expect(graphMovement(before, after).totals).toEqual({ 'unmatched-ambiguous': 2 });
  });

  it('reports an untouched graph as entirely unchanged', () => {
    const rows = parseGraphGolden(
      graph(
        'CALLS|symbol:a->symbol:b|static-analysis|ev1',
        'CONTAINS|file:x->symbol:a|static-analysis|ev2',
      ),
    );

    expect(graphMovement(rows, rows).totals).toEqual({ unchanged: 2 });
  });

  it('ignores node lines when reading edges', () => {
    const text = [
      'nodes:',
      'symbol:a|symbol|repository|A|static-analysis',
      '',
      'edges:',
      'CALLS|symbol:a->symbol:b|static-analysis|ev1',
      '',
    ].join('\n');

    expect(parseGraphGolden(text)).toHaveLength(1);
  });
});
